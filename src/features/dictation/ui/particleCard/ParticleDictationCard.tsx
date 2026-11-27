import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { MoundEngine, type MoundPhase, type MoundTheme, type MoundVariant } from "./moundEngine";

export interface ParticleDictationCardProps {
  variant: MoundVariant;
  /** White card with dark particles, or black card with white particles. */
  theme: MoundTheme;
  phase: MoundPhase;
  visible: boolean;
  text: string;
  /** Latest 0..1 microphone level, or null when unavailable (the mound then just breathes). */
  levelRef: MutableRefObject<number | null>;
  /** `performance.now()` timestamp of when recording started, for the elapsed timer. */
  recordingStartedAt: number | null;
  listeningLabel: string;
  thinkingLabel: string;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function commonPrefixLength(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

interface FreshSplit {
  text: string;
  stable: string;
  fresh: string;
  freshKey: number;
}

/**
 * Splits the transcript into the part already shown and the newly arrived tail. Uses the
 * "derive state during render" pattern so it stays correct under StrictMode double renders.
 */
function useFreshSplit(text: string): FreshSplit {
  const [split, setSplit] = useState<FreshSplit>({ text: "", stable: "", fresh: "", freshKey: 0 });
  if (split.text !== text) {
    const previous = Array.from(split.text);
    const next = Array.from(text);
    const prefix = commonPrefixLength(previous, next);
    const nextSplit: FreshSplit = {
      text,
      stable: next.slice(0, prefix).join(""),
      fresh: next.slice(prefix).join(""),
      freshKey: split.freshKey + (prefix < next.length ? 1 : 0),
    };
    setSplit(nextSplit);
    return nextSplit;
  }
  return split;
}

function useElapsed(startedAt: number | null, running: boolean): string {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  return formatElapsed(startedAt == null ? 0 : now - startedAt);
}

export default function ParticleDictationCard({
  variant,
  theme,
  phase,
  visible,
  text,
  levelRef,
  recordingStartedAt,
  listeningLabel,
  thinkingLabel,
}: ParticleDictationCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const freshRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<MoundEngine | null>(null);
  const recording = phase === "recording";
  const elapsed = useElapsed(recordingStartedAt, visible && recording);
  const { stable, fresh, freshKey } = useFreshSplit(text);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return undefined;
    const engine = new MoundEngine(canvas, variant);
    engineRef.current = engine;
    const resize = () => engine.resize(card.clientWidth, card.clientHeight);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(card);
    return () => {
      observer.disconnect();
      engine.stop();
      engineRef.current = null;
    };
    // The engine is created once; variant/phase are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setVariant(variant);
  }, [variant]);

  useEffect(() => {
    engineRef.current?.setPhase(phase);
  }, [phase]);

  useEffect(() => {
    engineRef.current?.setTheme(theme);
  }, [theme]);

  // Run the render loop only while visible, and feed it the polled mic level each frame.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return undefined;
    if (!visible) {
      const id = window.setTimeout(() => {
        engine.stop();
        engine.reset();
      }, 320);
      return () => window.clearTimeout(id);
    }
    engine.start();
    let raf = 0;
    const pump = () => {
      engine.setLevel(levelRef.current ?? 0);
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, [visible, levelRef]);

  // Fly particles from the mound into each newly arrived span of text.
  useLayoutEffect(() => {
    const engine = engineRef.current;
    const span = freshRef.current;
    const card = cardRef.current;
    if (!engine || !span || !card || !fresh.trim()) return;
    const cardRect = card.getBoundingClientRect();
    const rects = Array.from(span.getClientRects());
    if (rects.length === 0) return;
    const perRect = Math.max(
      6,
      Math.round(Math.min(42, 10 + Array.from(fresh).length * 3) / rects.length)
    );
    // Client rects include any ancestor transform (e.g. the enter scale); the canvas draws in
    // the card's own CSS pixels, so map back into that space.
    const scale = card.offsetWidth > 0 ? cardRect.width / card.offsetWidth : 1;
    for (const rect of rects) {
      engine.burst(
        {
          x: (rect.left - cardRect.left) / scale,
          y: (rect.top - cardRect.top) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
        },
        perRect
      );
    }
  }, [freshKey, fresh]);

  return (
    <div
      ref={cardRef}
      className={[
        "particle-card",
        theme === "dark" ? "particle-card--dark" : "",
        visible ? "particle-card--visible" : "",
      ].join(" ")}
      role={recording ? "group" : "status"}
      aria-live={recording ? undefined : "polite"}
      aria-label={recording ? listeningLabel : thinkingLabel}
    >
      <canvas ref={canvasRef} className="particle-card__canvas" aria-hidden="true" />

      <div className="particle-card__text">
        <p className="particle-card__lines">
          {text ? (
            <>
              <span>{stable}</span>
              {fresh ? (
                <span ref={freshRef} key={freshKey} className="particle-card__fresh">
                  {fresh}
                </span>
              ) : null}
            </>
          ) : (
            <span className="particle-card__placeholder">
              {recording ? listeningLabel : thinkingLabel}
            </span>
          )}
        </p>
      </div>

      <div className="particle-card__status">
        <span
          className={[
            "particle-card__status-dot",
            recording ? "particle-card__status-dot--live" : "particle-card__status-dot--thinking",
          ].join(" ")}
        />
        <span>{recording ? elapsed : thinkingLabel}</span>
      </div>

      <div className="particle-card__button" aria-hidden="true">
        {recording ? (
          <span className="particle-card__stop" />
        ) : (
          <span className="particle-card__dots">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
    </div>
  );
}
