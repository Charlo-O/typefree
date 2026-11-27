import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import { Check, X } from "lucide-react";
import { playErrorSound, playStartSound, playStopSound } from "../audio/soundFeedback";
import { platform } from "../../../shared/platform";
import type { PlatformListenerCleanup, RecordingOverlayState } from "../../../shared/platform";
import RecordingWaveform from "./RecordingWaveform";
import ParticleDictationCard from "./particleCard/ParticleDictationCard";
import { useI18n } from "../../../i18n";
import {
  normalizeRecordingOverlayCardTheme,
  normalizeRecordingOverlayVisualStyle,
  type RecordingOverlayCardTheme,
  type RecordingOverlayVisualStyle,
} from "../../settings/schema/settingsSchema";

const OVERLAY_STYLE_STORAGE_KEY = "recordingOverlayVisualStyle";
const OVERLAY_THEME_STORAGE_KEY = "recordingOverlayCardTheme";
const LEVEL_POLL_MS = 40;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface OverlayAppearance {
  style: RecordingOverlayVisualStyle;
  theme: RecordingOverlayCardTheme;
}

function readOverlayAppearance(): OverlayAppearance {
  return {
    style: normalizeRecordingOverlayVisualStyle(readStored(OVERLAY_STYLE_STORAGE_KEY)),
    theme: normalizeRecordingOverlayCardTheme(readStored(OVERLAY_THEME_STORAGE_KEY)),
  };
}

/**
 * The overlay is a separate webview: it re-reads the style whenever it is shown and follows
 * cross-window `storage` events so a settings change applies on the next dictation.
 */
function useOverlayAppearance(): [OverlayAppearance, () => void] {
  const [appearance, setAppearance] = useState<OverlayAppearance>(readOverlayAppearance);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === OVERLAY_STYLE_STORAGE_KEY ||
        event.key === OVERLAY_THEME_STORAGE_KEY
      ) {
        setAppearance(readOverlayAppearance());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [appearance, () => setAppearance(readOverlayAppearance())];
}

/** Polls the native recorder meter while recording; leaves `null` when metering is unavailable. */
function useNativeLevel(active: boolean): MutableRefObject<number | null> {
  const levelRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      levelRef.current = null;
      return undefined;
    }
    let cancelled = false;
    let inFlight = false;
    const id = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void platform.recording
        .getNativeLevel()
        .then((level) => {
          if (!cancelled) levelRef.current = level;
        })
        .finally(() => {
          inFlight = false;
        });
    }, LEVEL_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);
  return levelRef;
}

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
  const { t } = useI18n();
  const [state, setState] = useState<RecordingOverlayState>("idle");
  const [visible, setVisible] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [{ style: overlayStyle, theme: cardTheme }, refreshOverlayStyle] = useOverlayAppearance();
  const lastRecordingRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const stateRef = useRef<RecordingOverlayState>("idle");
  const usesCard = overlayStyle !== "classic";
  const levelRef = useNativeLevel(usesCard && visible && state === "recording");

  useEffect(() => {
    const unlistenShow = platform.events.onShowOverlay((next) => {
      refreshOverlayStyle();
      // The backend re-emits show-overlay shortly after the first emit; only a real transition
      // into recording resets the transcript and the timer.
      if (next === "recording" && stateRef.current !== "recording") {
        setLiveText("");
        setRecordingStartedAt(performance.now());
      }
      stateRef.current = next;
      setState(next);
      setVisible(true);
    });
    const unlistenHide = platform.events.onHideOverlay(() => {
      activeSessionIdRef.current = null;
      stateRef.current = "idle";
      setVisible(false);
      // Keep the text through the fade-out; clear it once the panel is gone.
      window.setTimeout(() => {
        if (stateRef.current === "idle") setLiveText("");
      }, 320);
    });

    return () => {
      cleanupPlatformListener(unlistenShow);
      cleanupPlatformListener(unlistenHide);
    };
    // refreshOverlayStyle only re-reads localStorage; listeners are registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (usesCard) {
    return (
      <div
        className="flex h-full w-full select-none items-end justify-center pb-3"
        style={{ backgroundColor: "transparent" }}
      >
        <ParticleDictationCard
          variant={overlayStyle === "particle-dots" ? "dots" : "ascii"}
          theme={cardTheme}
          phase={state === "recording" ? "recording" : "thinking"}
          visible={visible && state !== "idle"}
          text={liveText}
          levelRef={levelRef}
          recordingStartedAt={recordingStartedAt}
          listeningLabel={t("settings.overlayVisualStyle.listening")}
          thinkingLabel={t("settings.overlayVisualStyle.thinking")}
        />
      </div>
    );
  }

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
