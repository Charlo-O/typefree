/**
 * Canvas renderer for the particle dictation card: a voice-reactive mound drawn either as
 * ASCII glyphs or as a dot matrix, ambient sparks rising off its peak, and particle streams
 * that fly from the mound into newly transcribed words.
 *
 * Everything is drawn in CSS pixels on a DPR-scaled 2D canvas; the engine owns its own rAF loop
 * so React only pushes inputs (level, phase, bursts) and never re-renders per frame.
 */

export type MoundVariant = "ascii" | "dots";
export type MoundPhase = "recording" | "thinking";
export type MoundTheme = "light" | "dark";

export interface MoundRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Flight {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  start: number;
  duration: number;
  size: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
}

// Light -> dense. Dense glyphs land in the bright core of the mound, light ones on its slopes.
const ASCII_RAMP = ".`,:;-~=+?|/()1jlxczvunrtYXUCJLQ0OZmwqpdbkhao*#MW&8%B$@";
// Ink is the colour of the mound, sparks and streams: near-black on the white card, white on
// the black card. The glow behind the mound is subtler on white, where it reads as a haze.
const THEME_INK: Record<MoundTheme, { rgb: string; glowMax: number; glowBase: number }> = {
  light: { rgb: "24, 24, 27", glowMax: 0.08, glowBase: 0.025 },
  dark: { rgb: "255, 255, 255", glowMax: 0.16, glowBase: 0.05 },
};
const ASCII_CELL_W = 5.6;
const ASCII_CELL_H = 9;
const DOT_PITCH = 5;
const GLYPH_TICK_MS = 80;
const MAX_FLIGHTS = 160;
const MAX_SPARKS = 90;

function hash3(a: number, b: number, c: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

function smoothNoise(x: number, t: number): number {
  return (
    Math.sin(x * 1.7 + t * 2.3) * 0.5 +
    Math.sin(x * 3.1 - t * 3.7) * 0.3 +
    Math.sin(x * 5.3 + t * 5.9) * 0.2
  );
}

function gaussian(x: number, center: number, sigma: number): number {
  const d = (x - center) / sigma;
  return Math.exp(-0.5 * d * d);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export class MoundEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private variant: MoundVariant;
  private theme: MoundTheme = "light";
  private phase: MoundPhase = "recording";
  private width = 0;
  private height = 0;
  private targetLevel = 0;
  private level = 0;
  private thinkingMix = 0;
  private flights: Flight[] = [];
  private sparks: Spark[] = [];
  private sparkDebt = 0;
  private raf = 0;
  private lastTs = 0;
  private readonly origin = performance.now();
  private readonly reducedMotion = prefersReducedMotion();

  constructor(canvas: HTMLCanvasElement, variant: MoundVariant) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.variant = variant;
  }

  setVariant(variant: MoundVariant): void {
    this.variant = variant;
  }

  setTheme(theme: MoundTheme): void {
    this.theme = theme;
  }

  private get ink(): string {
    return `rgb(${THEME_INK[this.theme].rgb})`;
  }

  setPhase(phase: MoundPhase): void {
    this.phase = phase;
  }

  /** Raw 0..1 microphone level; the engine applies its own attack/release smoothing. */
  setLevel(level: number): void {
    this.targetLevel = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  }

  resize(width: number, height: number): void {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Stream `count` particles from the mound peak into `target` (card-relative CSS px). */
  burst(target: MoundRect, count: number): void {
    if (this.reducedMotion || this.width === 0) return;
    const now = this.now();
    const n = Math.min(count, MAX_FLIGHTS - this.flights.length);
    for (let i = 0; i < n; i += 1) {
      const x0 = this.samplePeakX();
      const y0 = this.baselineY() - this.columnHeight(x0, now) - 2;
      const x1 = target.x + Math.random() * Math.max(4, target.width);
      const y1 = target.y + target.height * (0.3 + Math.random() * 0.45);
      // Rise first, then curl toward the word so the stream lands roughly horizontally.
      const cx = x0 + (x1 - x0) * (0.12 + Math.random() * 0.12);
      const cy = y1 + (y0 - y1) * (0.05 + Math.random() * 0.15);
      this.flights.push({
        x0,
        y0,
        cx,
        cy,
        x1,
        y1,
        start: now + (i / Math.max(1, n)) * 0.38 + Math.random() * 0.05,
        duration: 0.5 + Math.random() * 0.35,
        size: 1.4 + Math.random() * 1.2,
      });
    }
    // A burst means the speaker just produced words: kick the mound a little.
    this.level = Math.min(1, this.level + 0.08);
  }

  start(): void {
    if (this.raf) return;
    this.lastTs = 0;
    const loop = (ts: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 1 / 60;
      this.lastTs = ts;
      this.step(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  reset(): void {
    this.flights = [];
    this.sparks = [];
    this.level = 0;
    this.targetLevel = 0;
    this.thinkingMix = 0;
  }

  private now(): number {
    return (performance.now() - this.origin) / 1000;
  }

  private baselineY(): number {
    return this.height - 6;
  }

  private moundCenterX(t: number): number {
    return this.width * 0.47 + Math.sin(t * 0.7) * this.width * 0.025;
  }

  /** Normalised mound shape (0..~1) at x: a main peak, a broad shoulder, and a wandering bump. */
  private shape(x: number, t: number): number {
    const w = this.width;
    const c = this.moundCenterX(t);
    const main = gaussian(x, c, w * 0.075);
    const shoulder = 0.55 * gaussian(x, c + Math.sin(t * 0.45 + 1) * w * 0.07, w * 0.13);
    const bump =
      0.35 *
      (0.5 + 0.5 * Math.sin(t * 2.3)) *
      gaussian(x, c - w * 0.09 + Math.sin(t * 1.1) * w * 0.03, w * 0.05);
    return Math.min(1.25, (main + shoulder + bump) / 1.2);
  }

  /** Mound height in px at x for the current smoothed level. */
  private columnHeight(x: number, t: number): number {
    const maxHeight = this.height * 0.6;
    const jitter = 1 + 0.2 * smoothNoise(x * 0.06, t);
    const thinkingScale = 1 - this.thinkingMix * 0.85;
    return Math.max(0, this.level * thinkingScale * maxHeight * this.shape(x, t) * jitter);
  }

  private samplePeakX(): number {
    const t = this.now();
    // Box-Muller around the main peak.
    const u = Math.max(1e-6, Math.random());
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    return this.moundCenterX(t) + g * this.width * 0.045;
  }

  private step(dt: number): void {
    const thinking = this.phase === "thinking";
    // Fast attack, slow release, with a small breathing floor so the mound never vanishes.
    const floor = thinking ? 0.06 : 0.07 + 0.03 * Math.sin(this.now() * 2.1);
    const target = Math.max(floor, thinking ? 0.12 : this.targetLevel);
    const rate = target > this.level ? 14 : 3.2;
    this.level += (target - this.level) * Math.min(1, rate * dt);
    this.thinkingMix += ((thinking ? 1 : 0) - this.thinkingMix) * Math.min(1, 3 * dt);

    const t = this.now();
    if (!this.reducedMotion && !thinking) {
      this.sparkDebt += dt * Math.max(0, this.level - 0.12) * 40;
      while (this.sparkDebt >= 1 && this.sparks.length < MAX_SPARKS) {
        this.sparkDebt -= 1;
        const x = this.samplePeakX();
        this.sparks.push({
          x,
          y: this.baselineY() - this.columnHeight(x, t) - 2,
          vx: (Math.random() - 0.5) * 16,
          vy: -(18 + Math.random() * 40) * (0.5 + this.level),
          born: t,
          life: 0.45 + Math.random() * 0.6,
          size: 1.3 + Math.random() * 1.1,
        });
      }
      if (this.sparkDebt > 1) this.sparkDebt = 1;
    }

    for (const spark of this.sparks) {
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vy *= 0.985;
    }
    this.sparks = this.sparks.filter((spark) => t - spark.born < spark.life);
    this.flights = this.flights.filter((flight) => t - flight.start < flight.duration);
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || this.width === 0) return;
    const t = this.now();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "source-over";

    this.drawGlow(ctx, t);
    if (this.variant === "ascii") this.drawAscii(ctx, t);
    else this.drawDots(ctx, t);
    this.drawSparks(ctx, t);
    this.drawFlights(ctx, t);
    ctx.globalAlpha = 1;
  }

  private drawGlow(ctx: CanvasRenderingContext2D, t: number): void {
    const cx = this.moundCenterX(t);
    const peak = this.columnHeight(cx, t);
    if (peak < 4) return;
    const cy = this.baselineY() - peak * 0.35;
    const radius = Math.max(24, peak * 1.6);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const { rgb, glowMax, glowBase } = THEME_INK[this.theme];
    const alpha = Math.min(glowMax, glowBase + this.level * glowMax * 0.9);
    gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  /** Per-cell brightness for a column of height `h` at row `row` with cell height `cellH`. */
  private cellIntensity(h: number, row: number, cellH: number, centerness: number): number {
    const fill = Math.min(1, Math.max(0, (h - row * cellH) / cellH));
    if (fill <= 0) return 0;
    const depth = h > 0 ? (row * cellH) / h : 1;
    return fill * (1 - 0.5 * depth) * (0.4 + 0.6 * centerness);
  }

  private baselineMask(x: number): number {
    const w = this.width;
    return smoothstep(w * 0.08, w * 0.2, x) * (1 - smoothstep(w * 0.78, w * 0.9, x));
  }

  private scanBoost(x: number, t: number): number {
    if (this.thinkingMix < 0.05) return 0;
    const span = this.width * 0.8;
    const scanX = this.width * 0.1 + ((t * 150) % span);
    return this.thinkingMix * 0.55 * gaussian(x, scanX, 26);
  }

  private drawAscii(ctx: CanvasRenderingContext2D, t: number): void {
    const cols = Math.floor(this.width / ASCII_CELL_W);
    const baseY = this.baselineY() - ASCII_CELL_H / 2 + 2;
    const tick = Math.floor((t * 1000) / GLYPH_TICK_MS);
    const maxIndex = ASCII_RAMP.length - 1;
    ctx.font = "600 8.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.ink;

    for (let col = 0; col < cols; col += 1) {
      const x = (col + 0.5) * ASCII_CELL_W;
      const h = this.columnHeight(x, t);
      const centerness = Math.min(1, this.shape(x, t));
      const baseMask = this.baselineMask(x);
      const scan = this.scanBoost(x, t);
      const rows = Math.ceil(h / ASCII_CELL_H);

      for (let row = 0; row < Math.max(1, rows); row += 1) {
        let v = this.cellIntensity(h, row, ASCII_CELL_H, centerness);
        if (row === 0) v = Math.max(v, baseMask * (0.22 + scan));
        if (v <= 0.02) continue;
        const r = hash3(col, row, tick);
        // Slopes sparkle: some upper cells drop out so the silhouette stays ragged.
        if (row > 0 && r < 0.12 * (1 - centerness)) continue;
        const glyph = Math.round(Math.min(1, Math.max(0, v + (r - 0.5) * 0.3)) * maxIndex);
        ctx.globalAlpha = Math.min(1, 0.18 + v * 0.95);
        ctx.fillText(ASCII_RAMP[glyph], x, baseY - row * ASCII_CELL_H);
      }
    }
  }

  private drawDots(ctx: CanvasRenderingContext2D, t: number): void {
    const cols = Math.floor(this.width / DOT_PITCH);
    const baseY = this.baselineY();
    const tick = Math.floor((t * 1000) / GLYPH_TICK_MS);
    ctx.fillStyle = this.ink;

    for (let col = 0; col < cols; col += 1) {
      const x = (col + 0.5) * DOT_PITCH;
      const h = this.columnHeight(x, t);
      const centerness = Math.min(1, this.shape(x, t));
      const baseMask = this.baselineMask(x);
      const scan = this.scanBoost(x, t);
      const rows = Math.ceil(h / DOT_PITCH);

      for (let row = 0; row < Math.max(1, rows); row += 1) {
        let v = this.cellIntensity(h, row, DOT_PITCH, centerness);
        if (row === 0) v = Math.max(v, baseMask * (0.3 + scan));
        if (v <= 0.03) continue;
        const r = hash3(col, row, tick);
        if (row > 0 && r < 0.18 * (1 - centerness)) continue;
        const intensity = Math.min(1, Math.max(0, v + (r - 0.5) * 0.25));
        const size = 0.8 + intensity * 1.9;
        const y = baseY - row * DOT_PITCH;
        if (intensity > 0.62) {
          ctx.globalAlpha = 0.12 * intensity;
          const glow = size * 2.6;
          ctx.fillRect(x - glow / 2, y - glow / 2, glow, glow);
        }
        ctx.globalAlpha = Math.min(1, 0.22 + intensity * 0.85);
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }

  private drawSparks(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.fillStyle = this.ink;
    for (const spark of this.sparks) {
      const age = (t - spark.born) / spark.life;
      ctx.globalAlpha = Math.max(0, 1 - age) * 0.9;
      ctx.fillRect(spark.x - spark.size / 2, spark.y - spark.size / 2, spark.size, spark.size);
    }
  }

  private flightPoint(flight: Flight, p: number): [number, number] {
    const e = easeInOutCubic(Math.min(1, Math.max(0, p)));
    const a = 1 - e;
    return [
      a * a * flight.x0 + 2 * a * e * flight.cx + e * e * flight.x1,
      a * a * flight.y0 + 2 * a * e * flight.cy + e * e * flight.y1,
    ];
  }

  private drawFlights(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.fillStyle = this.ink;
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = 1;
    for (const flight of this.flights) {
      const p = (t - flight.start) / flight.duration;
      if (p < 0) continue;
      const [x, y] = this.flightPoint(flight, p);
      const [tx, ty] = this.flightPoint(flight, p - 0.09);
      const fade = p > 0.82 ? Math.max(0, 1 - (p - 0.82) / 0.18) : 1;

      ctx.globalAlpha = 0.32 * fade;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();

      const size = flight.size * (0.6 + 0.4 * fade);
      ctx.globalAlpha = 0.95 * fade;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
}
