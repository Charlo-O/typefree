import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, X } from "lucide-react";
import { HStack } from "@astryxdesign/core/HStack";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { playErrorSound, playStartSound, playStopSound } from "../audio/soundFeedback";
import { platform } from "../../../shared/platform";
import type { PlatformListenerCleanup, RecordingOverlayState } from "../../../shared/platform";
import RecordingWaveform from "./RecordingWaveform";

type GlyphVariant = "cancel" | "confirm";

function cleanupPlatformListener(listener: PlatformListenerCleanup): void {
  if (!listener) return;
  void Promise.resolve(listener)
    .then((unlisten) => unlisten?.())
    .catch(() => {
      // ignore cleanup failures
    });
}

const SoundWaveIcon = ({ size = 14 }: { size?: number }) => (
  <AudioLines aria-hidden="true" size={size} strokeWidth={2.4} />
);

const GlyphCircle = ({ variant }: { variant: GlyphVariant }) => (
  <HStack
    aria-hidden="true"
    hAlign="center"
    vAlign="center"
    className={[
      "relative z-10 h-6 w-6 shrink-0 rounded-full",
      variant === "confirm"
        ? "border border-white/80 bg-white text-neutral-950"
        : "border border-white/20 bg-neutral-800/95 text-white/90",
    ].join(" ")}
  >
    {variant === "confirm" ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}
  </HStack>
);

function PushingText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Text
      as="span"
      type="label"
      color="inherit"
      textWrap="nowrap"
      maxLines={1}
      className="min-w-0 flex-1 justify-end overflow-hidden text-white/95"
    >
      {text}
    </Text>
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
  const capsuleStyle = {
    WebkitAppRegion: "no-drag" as const,
    transition: "width 180ms ease, opacity 250ms ease",
  };

  return (
    <VStack
      height="100%"
      width="100%"
      hAlign="center"
      vAlign="center"
      className={[
        "select-none transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <HStack
        width={capsuleWidth}
        height={32}
        hAlign="center"
        vAlign="center"
        gap={1}
        className={[
          "relative overflow-hidden rounded-full border border-white/10 backdrop-blur-md",
          state === "processing" || state === "transcribing"
            ? "bg-neutral-700/90 px-5 text-white/70"
            : "bg-neutral-950/95 px-1.5 text-white",
          "transition-[width,opacity] duration-200",
        ].join(" ")}
        style={capsuleStyle}
        role={state === "processing" || state === "transcribing" ? "status" : "group"}
        aria-live={state === "processing" || state === "transcribing" ? "polite" : undefined}
        aria-label={label}
      >
        {state === "recording" ? (
          <>
            <GlyphCircle variant="cancel" />
            <StackItem
              size="fill"
              className="relative z-10 flex min-w-0 items-center justify-center px-1"
            >
              {displayText ? <PushingText text={displayText} /> : <RecordingWaveform />}
            </StackItem>
            <GlyphCircle variant="confirm" />
          </>
        ) : state === "processing" || state === "transcribing" ? (
          <Text type="label" color="disabled" className="relative z-10">
            {state === "processing" ? "优化中" : "转写中"}
          </Text>
        ) : (
          <SoundWaveIcon size={12} />
        )}
      </HStack>
    </VStack>
  );
}
