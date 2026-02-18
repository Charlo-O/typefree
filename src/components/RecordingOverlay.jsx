import React, { useEffect, useMemo, useRef, useState } from "react";
import { LoadingDots } from "./ui/LoadingDots";
import { playCompleteSound, playErrorSound, playStartSound, playStopSound } from "../helpers/soundFeedback";

// Reuse the same "mic" animations as the original main window (App.jsx),
// but rendered in a compact, non-interactive overlay layout.
const SoundWaveIcon = ({ size = 14 }) => {
  return (
    <div className="flex items-center justify-center gap-1">
      <div className="bg-white rounded-full" style={{ width: size * 0.25, height: size * 0.6 }} />
      <div className="bg-white rounded-full" style={{ width: size * 0.25, height: size }} />
      <div className="bg-white rounded-full" style={{ width: size * 0.25, height: size * 0.6 }} />
    </div>
  );
};

const VoiceWaveIndicator = ({ isListening }) => {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`w-0.5 bg-white rounded-full transition-all duration-150 ${
            isListening ? "animate-pulse h-4" : "h-2"
          }`}
          style={{
            animationDelay: isListening ? `${i * 0.1}s` : "0s",
            animationDuration: isListening ? `${0.6 + i * 0.1}s` : "0s",
          }}
        />
      ))}
    </div>
  );
};

// A minimal, non-interactive recording indicator window (Handy-style).
// The backend controls visibility via `show-overlay` / `hide-overlay` events.
export default function RecordingOverlay() {
  const [state, setState] = useState("idle"); // idle | recording | transcribing | processing
  const [visible, setVisible] = useState(false);
  const lastRecordingRef = useRef(false);

  useEffect(() => {
    let unlistenShow = null;
    let unlistenHide = null;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenShow = await listen("show-overlay", (event) => {
          const next = String(event?.payload || "idle");
          console.debug("[overlay-ui] show-overlay", next);
          setState(next);
          setVisible(true);
        });
        unlistenHide = await listen("hide-overlay", () => {
          console.debug("[overlay-ui] hide-overlay");
          setVisible(false);
        });
        console.debug("[overlay-ui] listeners ready");
      } catch {
        // If Tauri event API isn't available, keep overlay hidden.
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

  // Sound effects: keep behavior identical to the original main window flow.
  // Use backend dictation events rather than `show-overlay`, because the overlay event is re-emitted
  // for reliability which would double-play sounds.
  useEffect(() => {
    let unlistenRecording = null;
    let unlistenResult = null;
    let unlistenError = null;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        unlistenRecording = await listen("backend-dictation-recording", (event) => {
          const next = Boolean(event?.payload);
          const prev = lastRecordingRef.current;
          lastRecordingRef.current = next;

          if (next && !prev) {
            playStartSound();
          } else if (!next && prev) {
            playStopSound();
          }
        });

        unlistenResult = await listen("backend-dictation-result", () => {
          playCompleteSound();
        });

        unlistenError = await listen("backend-dictation-error", () => {
          playErrorSound();
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      try {
        unlistenRecording?.();
        unlistenResult?.();
        unlistenError?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const label = useMemo(() => {
    switch (state) {
      case "recording":
        return "Recording";
      case "transcribing":
        return "Transcribing";
      case "processing":
        return "Pasting";
      default:
        return "Ready";
    }
  }, [state]);

  const micState = useMemo(() => {
    if (state === "recording") return "recording";
    if (state === "transcribing" || state === "processing") return "processing";
    return "idle";
  }, [state]);

  return (
    <div
      className={[
        "w-full h-full select-none",
        "flex items-center justify-center",
        // Let the backend hide the window after the fade-out completes.
        "transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
      style={{ backgroundColor: "transparent" }}
    >
      <div
        className={[
          "h-9 px-3 rounded-full",
          "bg-neutral-900/75 backdrop-blur-md",
          "border border-white/10",
          "flex items-center gap-2",
          "text-white",
        ].join(" ")}
        style={{ WebkitAppRegion: "no-drag" }}
      >
        <div
          className={[
            "rounded-full w-7 h-7 flex items-center justify-center relative overflow-hidden",
            "border border-white/60",
            micState === "processing" ? "bg-neutral-800" : "bg-neutral-950",
          ].join(" ")}
          style={{
            transition:
              "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
          }}
        >
          {micState === "idle" ? (
            <SoundWaveIcon size={12} />
          ) : micState === "recording" ? (
            <LoadingDots />
          ) : (
            <VoiceWaveIndicator isListening={true} />
          )}

          {micState === "recording" && (
            <div className="absolute inset-0 rounded-full border border-white/60 animate-pulse" />
          )}
          {micState === "processing" && (
            <div className="absolute inset-0 rounded-full border border-white/30 opacity-60" />
          )}
        </div>
        <span className="text-xs font-medium tracking-wide">{label}</span>
      </div>
    </div>
  );
}
