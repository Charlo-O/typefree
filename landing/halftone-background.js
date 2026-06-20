(function () {
  const canvases = Array.from(document.querySelectorAll("[data-halftone]"));
  if (!canvases.length) return;

  const reduceMotion = false;
  const palette = [
    [80, 208, 230],
    [42, 112, 168],
    [156, 220, 238],
    [236, 185, 246],
    [184, 206, 244],
  ];

  const configs = {
    hero: {
      dotGap: 7,
      maxRadius: 4.15,
      alpha: 0.94,
      speed: 1.16,
      centerClear: 0.48,
      waves: true,
      blobs: [
        { x: 0.02, y: 0.34, rx: 0.19, ry: 0.27, color: 1, weight: 1.78, px: 0.07, py: 0.09, phase: 0.3 },
        { x: 0.2, y: 0.09, rx: 0.16, ry: 0.16, color: 0, weight: 1.22, px: 0.07, py: 0.08, phase: 1.7 },
        { x: 0.37, y: -0.03, rx: 0.16, ry: 0.17, color: 2, weight: 1.04, px: 0.06, py: 0.08, phase: 4.1 },
        { x: 0.48, y: 0.46, rx: 0.21, ry: 0.15, color: 0, weight: 1.18, px: 0.11, py: 0.05, phase: 3.2 },
        { x: 0.64, y: 0.56, rx: 0.18, ry: 0.22, color: 1, weight: 1.44, px: 0.08, py: 0.09, phase: 4.6 },
        { x: 0.86, y: 0.3, rx: 0.21, ry: 0.2, color: 3, weight: 1.04, px: 0.08, py: 0.07, phase: 2.6 },
        { x: 0.93, y: 0.72, rx: 0.18, ry: 0.2, color: 1, weight: 1.48, px: 0.07, py: 0.08, phase: 5.2 },
        { x: 0.17, y: 0.83, rx: 0.22, ry: 0.16, color: 0, weight: 1.18, px: 0.08, py: 0.05, phase: 3.9 },
      ],
    },
    cta: {
      dotGap: 7,
      maxRadius: 3.85,
      alpha: 0.88,
      speed: 1.2,
      centerClear: 0.28,
      waves: true,
      blobs: [
        { x: 0.14, y: 0.5, rx: 0.2, ry: 0.3, color: 1, weight: 1.2, px: 0.16, py: 0.08, phase: 0.4 },
        { x: 0.35, y: 0.28, rx: 0.18, ry: 0.2, color: 0, weight: 1, px: 0.1, py: 0.12, phase: 1.4 },
        { x: 0.58, y: 0.5, rx: 0.2, ry: 0.24, color: 3, weight: 0.9, px: 0.14, py: 0.1, phase: 3.1 },
        { x: 0.82, y: 0.6, rx: 0.18, ry: 0.22, color: 0, weight: 1.1, px: 0.1, py: 0.08, phase: 4.3 },
      ],
    },
  };

  const smoothstep = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  function makeRenderer(canvas) {
    const ctx = canvas.getContext("2d", { alpha: true });
    const type = canvas.dataset.halftone || "hero";
    const config = configs[type] || configs.hero;
    const state = { width: 0, height: 0, dpr: 1, last: 0 };

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (state.width === width && state.height === height && state.dpr === dpr) return;
      state.width = width;
      state.height = height;
      state.dpr = dpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(time) {
      resize();
      const width = state.width;
      const height = state.height;
      const gap = config.dotGap;
      const t = time * 0.00042 * config.speed;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = type === "cta" ? "#fffaff" : "rgba(255, 250, 255, 0.26)";
      ctx.fillRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * (type === "hero" ? 0.38 : 0.48);
      const clearRx = width * config.centerClear * 0.25;
      const clearRy = height * config.centerClear * 0.22;
      for (let y = -gap; y <= height + gap; y += gap) {
        for (let x = -gap; x <= width + gap; x += gap) {
          let value = 0;
          let r = 0;
          let g = 0;
          let b = 0;
          let colorWeight = 0;

          for (const blob of config.blobs) {
            const bx =
              (blob.x + Math.sin(t * 1.6 + blob.phase) * blob.px + Math.sin(t * 3.1 + blob.phase) * blob.px * 0.28) *
              width;
            const by =
              (blob.y + Math.cos(t * 1.35 + blob.phase) * blob.py + Math.sin(t * 2.2 + blob.phase) * blob.py * 0.22) *
              height;
            const dx = (x - bx) / (blob.rx * width);
            const dy = (y - by) / (blob.ry * height);
            const influence = Math.exp(-(dx * dx + dy * dy) * 2.8) * blob.weight;
            const color = palette[blob.color];
            value += influence;
            r += color[0] * influence;
            g += color[1] * influence;
            b += color[2] * influence;
            colorWeight += influence;
          }

          if (config.waves) {
            const waveY1 = height * (0.45 + Math.sin(x * 0.0078 + t * 8.4) * 0.07);
            const waveY2 = height * (0.63 + Math.sin(x * 0.0068 - t * 7.2) * 0.082);
            const waveY3 = height * (0.27 + Math.sin(x * 0.0092 + t * 6.8) * 0.045);
            const band1 = Math.exp(-Math.pow((y - waveY1) / (height * 0.048), 2));
            const band2 = Math.exp(-Math.pow((y - waveY2) / (height * 0.052), 2));
            const band3 = Math.exp(-Math.pow((y - waveY3) / (height * 0.042), 2));
            const wave =
              (band1 * 0.72 + band2 * 0.52 + band3 * 0.32) * (0.72 + Math.sin(t * 12 + x * 0.024) * 0.24);
            value += wave;
            r += palette[0][0] * wave;
            g += palette[0][1] * wave;
            b += palette[0][2] * wave;
            colorWeight += wave;
          }

          const centerDx = (x - cx) / Math.max(1, clearRx);
          const centerDy = (y - cy) / Math.max(1, clearRy);
          const centerFade = smoothstep(0.32, 1.12, centerDx * centerDx + centerDy * centerDy);
          const strength = smoothstep(0.045, 1.02, value) * centerFade;
          if (strength <= 0.025 || colorWeight <= 0) continue;

          const pulse = 0.86 + Math.sin(t * 12 + x * 0.025 + y * 0.018) * 0.16;
          const radius = config.maxRadius * Math.min(1, strength * pulse);
          const alpha = Math.min(0.96, config.alpha * strength * (0.8 + value * 0.2));
          ctx.fillStyle = `rgba(${Math.round(r / colorWeight)}, ${Math.round(g / colorWeight)}, ${Math.round(
            b / colorWeight
          )}, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const gradient = ctx.createLinearGradient(0, height * 0.68, 0, height);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0.86)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    function tick(now) {
      if (!reduceMotion && now - state.last > 28) {
        draw(now);
        state.last = now;
      }
      if (!reduceMotion) requestAnimationFrame(tick);
    }

    resize();
    draw(1600);
    if (!reduceMotion) requestAnimationFrame(tick);
    return { resize, draw };
  }

  const renderers = canvases.map(makeRenderer);
  window.addEventListener("resize", () => {
    for (const renderer of renderers) renderer.resize();
  });
})();
