import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { playErrorSound, playStartSound, playStopSound } from "../audio/soundFeedback";
import { platform } from "../../../shared/platform";
import type { PlatformListenerCleanup, RecordingOverlayState } from "../../../shared/platform";
import RecordingWaveform from "./RecordingWaveform";

type GlyphVariant = "cancel" | "confirm";

type OverlayStyle = CSSProperties & {
  WebkitAppRegion: "no-drag";
};

function cleanupPlatformListener(listener: PlatformListenerCleanup): void {
  if (!listener) return;
  void Promise.resolve(listener)
    .then((unlisten) => unlisten?.())
    .catch(() => {
      // ignore cleanup failures
    });
}

const SoundWaveIcon = ({ size = 14 }: { size?: number }) => (
  <div className="flex items-center justify-center gap-1">
    <div className="rounded-full bg-white" style={{ width: size * 0.25, height: size * 0.6 }} />
    <div className="rounded-full bg-white" style={{ width: size * 0.25, height: size }} />
    <div className="rounded-full bg-white" style={{ width: size * 0.25, height: size * 0.6 }} />
  </div>
);

const GlyphCircle = ({ variant }: { variant: GlyphVariant }) => (
  <span
    className={[
      "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
      variant === "confirm"
        ? "border border-white/80 bg-white text-neutral-950"
        : "border border-white/20 bg-neutral-800/95 text-white/90",
    ].join(" ")}
  >
    {variant === "confirm" ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}
  </span>
);

function PushingText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span
      className="flex min-w-0 flex-1 justify-end overflow-hidden text-xs font-medium leading-none text-white/95"
      style={{
        WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 16px, #000 100%)",
        maskImage: "linear-gradient(90deg, transparent 0, #000 16px, #000 100%)",
      }}
    >
      <span className="max-w-none shrink-0 whitespace-nowrap">{text}</span>
    </span>
  );
}

function labelForState(state: RecordingOverlayState): string {
  if (state === "processing") return "优化中";
  if (state === "transcribing") return "转写中";
  if (state === "recording") return "录音中";
  return "Ready";
}

export default function RecordingOverlay() {
  const [state, setState] = useState<RecordingOverlayState>("idle");
  const [visible, setVisible] = useState(false);
  const [liveText, setLiveText] = useState("");
  const lastRecordingRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unlistenShow = platform.events.onShowOverlay((next) => {
      setState(next);
      if (next === "recording") {
        setLiveText("");
      }
      setVisible(true);
    });
    const unlistenHide = platform.events.onHideOverlay(() => {
      activeSessionIdRef.current = null;
      setLiveText("");
      setVisible(false);
    });

    return () => {
      cleanupPlatformListener(unlistenShow);
      cleanupPlatformListener(unlistenHide);
    };
  }, []);

  useEffect(() => {
    const unlistenStartFeedback = platform.events.onBackendDictationStartFeedback((payload) => {
      activeSessionIdRef.current = payload.sessionId || null;
      setLiveText("");
      playStartSound();
    });
    const unlistenBackendState = platform.events.onBackendDictationState((payload) => {
      if (payload.sessionId) {
        activeSessionIdRef.current = payload.sessionId;
      }
      if (payload.phase === "recording") {
        setLiveText("");
      }
      if (payload.phase === "completed" || payload.phase === "failed") {
        activeSessionIdRef.current = null;
      }
    });
    const unlistenRecording = platform.events.onBackendDictationRecording((next) => {
      const prev = lastRecordingRef.current;
      lastRecordingRef.current = next;
      if (!next && prev) playStopSound();
    });
    const unlistenError = platform.events.onBackendDictationError(() => {
      playErrorSound();
    });
    const unlistenTranscript = platform.transcription.onTranscriptEvent((payload) => {
      const sessionId = String(payload.sessionId || "");
      if (!sessionId || sessionId !== activeSessionIdRef.current) {
        return;
      }
      const text = String(payload.text || "").trim();
      if (text) setLiveText(text);
    });

    return () => {
      cleanupPlatformListener(unlistenStartFeedback);
      cleanupPlatformListener(unlistenBackendState);
      cleanupPlatformListener(unlistenRecording);
      cleanupPlatformListener(unlistenError);
      cleanupPlatformListener(unlistenTranscript);
    };
  }, []);

  const label = useMemo(() => labelForState(state), [state]);
  const displayText = state === "recording" ? liveText : "";
  const textLength = Array.from(displayText || "").length;
  const capsuleWidth =
    state === "recording"
      ? Math.min(360, Math.max(124, 78 + textLength * 8))
      : state === "processing" || state === "transcribing"
        ? 92
        : 86;
  const capsuleStyle: OverlayStyle = {
    width: capsuleWidth,
    WebkitAppRegion: "no-drag",
    transition: "width 180ms ease, opacity 250ms ease",
  };

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
          "relative h-8 overflow-hidden rounded-full border border-white/10 backdrop-blur-md",
          state === "processing" || state === "transcribing"
            ? "bg-neutral-700/90 px-5 text-white/70"
            : "bg-neutral-950/95 px-1.5 text-white",
          "flex items-center justify-center gap-1.5",
        ].join(" ")}
        style={capsuleStyle}
        role={state === "processing" || state === "transcribing" ? "status" : "group"}
        aria-live={state === "processing" || state === "transcribing" ? "polite" : undefined}
        aria-label={label}
      >
        {state === "recording" ? (
          <>
            <GlyphCircle variant="cancel" />
            <span className="relative z-10 flex min-w-0 flex-1 items-center justify-center px-1">
              {displayText ? <PushingText text={displayText} /> : <RecordingWaveform />}
            </span>
            <GlyphCircle variant="confirm" />
          </>
        ) : state === "processing" || state === "transcribing" ? (
          <span className="relative z-10 text-xs font-semibold leading-none text-white/60">
            {state === "processing" ? "优化中" : "转写中"}
          </span>
        ) : (
          <SoundWaveIcon size={12} />
        )}
      </div>
    </div>
  );
}
