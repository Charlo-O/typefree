import React, { useEffect, useMemo, useRef, useState } from "react";
import { LoadingDots } from "./ui/LoadingDots";
import { playErrorSound, playStartSound, playStopSound } from "../helpers/soundFeedback";

const VISUAL_STYLES = new Set(["classic", "dual", "timeline"]);

const SoundWaveIcon = ({ size = 14 }) => (
  <div className="flex items-center justify-center gap-1">
    <div className="rounded-full bg-white" style={{ width: size * 0.25, height: size * 0.6 }} />
    <div className="rounded-full bg-white" style={{ width: size * 0.25, height: size }} />
    <div className="rounded-full bg-white" style={{ width: size * 0.25, height: size * 0.6 }} />
  </div>
);

function readVisualStyle() {
  try {
    const stored = localStorage.getItem("recordingOverlayVisualStyle") || "timeline";
    return VISUAL_STYLES.has(stored) ? stored : "timeline";
  } catch {
    return "timeline";
  }
}

function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  h ^= h >> 16;
  return Math.abs(h % 10000) / 10000;
}

function drawClassic(ctx, width, height, time) {
  const center = height / 2;
  const level = 0.45 + Math.sin(time * 2.1) * 0.18 + Math.sin(time * 4.7) * 0.08;
  ctx.lineCap = "round";

  for (let wave = 0; wave < 2; wave += 1) {
    ctx.beginPath();
    const period = wave === 0 ? 78 : 54;
    const speed = wave === 0 ? 2.4 : 1.7;
    const phase = wave === 0 ? 0 : 1.25;
    for (let x = 0; x <= width; x += 2) {
      const nx = x / width;
      const envelope = 0.12 + Math.pow(nx, 1.4) * 0.82;
      const y =
        center +
        Math.sin((x / period) * Math.PI * 2 + time * speed + phase) *
          envelope *
          height *
          0.22 *
          level;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const gradient = ctx.createLinearGradient(0, center, width, center);
    gradient.addColorStop(0, "rgba(198, 204, 255, 0.18)");
    gradient.addColorStop(1, "rgba(110, 150, 255, 0.82)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

function drawDual(ctx, width, height, time) {
  const center = height / 2;
  const amp = height * (0.15 + (0.5 + Math.sin(time * 2.2) * 0.5) * 0.22);

  for (let col = 0; col < width / 2; col += 1) {
    const x = col * 2;
    const nx = x / width;
    const s1 = center + Math.sin((x / 74) * Math.PI * 2 + time * 2.0) * amp * nx;
    const s2 = center + Math.sin((x / 52) * Math.PI * 2 + time * 1.4 + 1.3) * amp * nx;
    const count = 10;

    for (let j = 0; j < count; j += 1) {
      const spine = hash(col, j + 13) > 0.5 ? s1 : s2;
      const scatter = (hash(col, j) - 0.5) * 2;
      const y = spine + scatter * Math.abs(scatter) * height * (0.1 + nx * 0.22);
      const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(time * (3 + hash(j, col) * 8) + j));
      ctx.fillStyle = `rgba(${Math.round(190 - nx * 70)}, ${Math.round(
        205 - nx * 40
      )}, 255, ${0.12 + twinkle * 0.36})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawTimeline(ctx, width, height, levels, time) {
  const center = height / 2;
  const colCount = Math.floor(width / 2);

  for (let col = 0; col < colCount; col += 1) {
    const x = col * 2;
    const nx = x / width;
    const level = levels[Math.min(levels.length - 1, Math.floor(nx * (levels.length - 1)))] || 0;
    const band = height * (0.04 + Math.pow(level, 0.85) * 0.42);

    for (let j = 0; j < 10; j += 1) {
      const scatter = (hash(col, j) - 0.5) * 2;
      const y = center + scatter * Math.abs(scatter) * band;
      const twinkle = 0.35 + 0.65 * Math.max(0, Math.sin(time * (4 + hash(j, col) * 9) + j));
      ctx.fillStyle = `rgba(${Math.round(190 - nx * 75)}, ${Math.round(
        205 - nx * 42
      )}, 255, ${0.08 + twinkle * (0.12 + level * 0.4)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function OverlayVisualizer({ active }) {
  const canvasRef = useRef(null);
  const levelsRef = useRef(Array.from({ length: 180 }, () => 0));
  const lastShiftRef = useRef(0);
  const [style, setStyle] = useState(readVisualStyle);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === "recordingOverlayVisualStyle") {
        setStyle(readVisualStyle());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    let frame = 0;
    let animationId = 0;

    const render = (now) => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 220;
      const height = canvas.clientHeight || 30;
      if (
        canvas.width !== Math.floor(width * ratio) ||
        canvas.height !== Math.floor(height * ratio)
      ) {
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const time = now / 1000;

      if (style === "classic") {
        drawClassic(ctx, width, height, time);
      } else if (style === "dual") {
        drawDual(ctx, width, height, time);
      } else {
        if (!lastShiftRef.current || now - lastShiftRef.current > 24) {
          lastShiftRef.current = now;
          const level = 0.2 + Math.abs(Math.sin(time * 2.5)) * 0.35 + Math.random() * 0.24;
          levelsRef.current = [...levelsRef.current.slice(1), Math.min(1, level)];
        }
        drawTimeline(ctx, width, height, levelsRef.current, time);
      }

      frame += 1;
      if (frame > 0) animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [active, style]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-y-1 left-9 right-3 opacity-95"
      aria-hidden="true"
    />
  );
}

function RecordingDot() {
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="absolute h-5 w-5 rounded-full border border-red-300/60 animate-ping" />
      <span className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.8)]" />
    </span>
  );
}

function PushingText({ text }) {
  if (!text) return null;
  return (
    <span
      className="min-w-0 flex-1 overflow-hidden text-xs font-medium leading-none text-white/95"
      style={{
        WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 16px, #000 100%)",
        maskImage: "linear-gradient(90deg, transparent 0, #000 16px, #000 100%)",
      }}
    >
      <span
        className="block w-max max-w-none whitespace-nowrap text-right"
        style={{ marginLeft: "auto" }}
      >
        {text}
      </span>
    </span>
  );
}

function processingLabelForMode() {
  try {
    const mode = localStorage.getItem("processingModeId") || "voice-polish";
    if (mode === "translate-en") return "Translating";
    if (mode === "prompt-optimize") return "Optimizing";
    if (mode === "direct") return "Finalizing";
    return "Polishing";
  } catch {
    return "Processing";
  }
}

export default function RecordingOverlay() {
  const [state, setState] = useState("idle");
  const [visible, setVisible] = useState(false);
  const [resultText, setResultText] = useState("");
  const [liveText, setLiveText] = useState("");
  const lastRecordingRef = useRef(false);

  useEffect(() => {
    let unlistenShow = null;
    let unlistenHide = null;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenShow = await listen("show-overlay", (event) => {
          const next = String(event?.payload || "idle").toLowerCase();
          setState(next);
          if (next === "recording") {
            setResultText("");
            setLiveText("");
          }
          setVisible(true);
        });
        unlistenHide = await listen("hide-overlay", () => {
          setVisible(false);
        });
      } catch {
        console.warn("[overlay-ui] failed to register Tauri event listeners");
      }
    })();

    return () => {
      try {
        unlistenShow?.();
        unlistenHide?.();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    let unlistenRecording = null;
    let unlistenError = null;
    let unlistenResult = null;
    let unlistenStreaming = null;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        unlistenRecording = await listen("backend-dictation-recording", (event) => {
          const next = Boolean(event?.payload);
          const prev = lastRecordingRef.current;
          lastRecordingRef.current = next;
          if (next && !prev) playStartSound();
          else if (!next && prev) playStopSound();
        });

        unlistenError = await listen("backend-dictation-error", () => {
          playErrorSound();
        });

        unlistenResult = await listen("backend-dictation-result", (event) => {
          setResultText(String(event?.payload || ""));
        });

        unlistenStreaming = await listen("volcengine-streaming-transcript", (event) => {
          const text = String(event?.payload?.text || "").trim();
          if (text) setLiveText(text);
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      try {
        unlistenRecording?.();
        unlistenError?.();
        unlistenResult?.();
        unlistenStreaming?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const label = useMemo(() => {
    if (state === "recording") return "Recording";
    if (state === "transcribing") return "Transcribing";
    if (state === "processing") return processingLabelForMode();
    return "Ready";
  }, [state]);

  const displayText = state === "recording" ? liveText : resultText || liveText;
  const textLength = Array.from(displayText || "").length;
  const capsuleWidth =
    state === "recording" || state === "processing"
      ? Math.min(400, Math.max(138, 84 + textLength * 8))
      : state === "transcribing"
        ? 180
        : 128;
  const visualActive = visible && (state === "recording" || state === "transcribing");

  return (
    <div
      className={[
        "flex h-full w-full select-none items-center justify-center",
        "transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
      style={{ backgroundColor: "transparent" }}
    >
      <div
        className={[
          "relative h-[44px] overflow-hidden rounded-full px-3",
          "border border-white/10 bg-neutral-950/80 text-white shadow-2xl shadow-black/30 backdrop-blur-md",
          "flex items-center gap-2",
        ].join(" ")}
        style={{
          width: capsuleWidth,
          WebkitAppRegion: "no-drag",
          transition: "width 180ms ease, opacity 250ms ease",
        }}
      >
        <OverlayVisualizer active={visualActive} />
        <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/30 bg-neutral-950/80">
          {state === "recording" ? (
            <RecordingDot />
          ) : state === "transcribing" || state === "processing" ? (
            <LoadingDots />
          ) : (
            <SoundWaveIcon size={12} />
          )}
        </span>
        <span className="relative z-10 shrink-0 text-xs font-medium text-white/85">{label}</span>
        <span className="relative z-10 flex min-w-0 flex-1 justify-end">
          <PushingText text={displayText} />
        </span>
      </div>
    </div>
  );
}
