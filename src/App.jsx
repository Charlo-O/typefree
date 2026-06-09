import React, { useState, useEffect, useRef } from "react";
import "./index.css";
import { X } from "lucide-react";
import { useToast } from "./components/ui/Toast";
import { LoadingDots } from "./components/ui/LoadingDots";
import { useHotkey } from "./hooks/useHotkey";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useClipboardListener } from "./hooks/useClipboardListener";
import { useI18n } from "./i18n";

// Sound Wave Icon Component (for idle/hover states)
const SoundWaveIcon = ({ size = 16 }) => {
  return (
    <div className="flex items-center justify-center gap-1">
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
      <div className={`bg-white rounded-full`} style={{ width: size * 0.25, height: size }}></div>
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
    </div>
  );
};

// Voice Wave Animation Component (for processing state)
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

const RecordingLiveDot = ({ level = 0 }) => {
  const safeLevel = Math.max(0.04, Math.min(1, level));
  const pulseSize = 12 + safeLevel * 12;

  return (
    <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
      <span
        className="absolute rounded-full bg-red-400/20 transition-[height,width,opacity] duration-100"
        style={{ width: pulseSize, height: pulseSize, opacity: 0.28 + safeLevel * 0.28 }}
      />
      <span className="absolute h-4 w-4 animate-pulse rounded-full border border-red-300/25" />
      <span className="relative h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.45)]" />
    </span>
  );
};

// Enhanced Tooltip Component
const Tooltip = ({ children, content, emoji }) => {
  const [isVisible, setIsVisible] = useState(false);

  if (!content) {
    return children;
  }

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
        {children}
      </div>
      {isVisible && (
        <div
          className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-1 py-1 text-white bg-gradient-to-r from-neutral-800 to-neutral-700 rounded-md whitespace-nowrap z-10 transition-opacity duration-150"
          style={{ fontSize: "9.7px" }}
        >
          {emoji && <span className="mr-1">{emoji}</span>}
          {content}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-neutral-800"></div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef(null);
  const buttonRef = useRef(null);
  const { toast } = useToast();
  const { t } = useI18n();
  useClipboardListener();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();
  const [dragStartPos, setDragStartPos] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: "Hotkey Changed",
        description: data.message,
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((data) => {
      toast({
        title: "Hotkey Unavailable",
        description: `Could not register hotkey. Please set a different hotkey in Settings.`,
        duration: 10000,
      });
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
    };
  }, [toast]);

  useEffect(() => {
    if (isCommandMenuOpen) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, setWindowInteractivity]);

  const handleDictationToggle = React.useCallback(() => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const { isRecording, isProcessing, liveTranscript, audioLevel, toggleListening, cancelRecording } =
    useAudioRecording(toast, {
      onToggle: handleDictationToggle,
    });
  const [recordingPeakWidth, setRecordingPeakWidth] = useState(36);

  useEffect(() => {
    if (!isRecording) {
      setRecordingPeakWidth(36);
      return;
    }

    const textLength = Array.from(liveTranscript || "").length;
    const needed = textLength > 0 ? Math.min(232, Math.max(84, 62 + textLength * 12)) : 36;
    setRecordingPeakWidth((current) => {
      if (needed > current) return needed;
      if (current - needed > 36) return needed;
      return current;
    });
  }, [isRecording, liveTranscript]);

  useEffect(() => {
    if (!isRecording && !isProcessing && !isCommandMenuOpen) {
      window.electronAPI?.hideWindow?.();
    }
  }, [isRecording, isProcessing, isCommandMenuOpen]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen]);

  // Determine current mic state
  const getMicState = () => {
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (isHovered && !isRecording && !isProcessing) return "hover";
    return "idle";
  };

  const micState = getMicState();

  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full h-9 flex items-center justify-center relative overflow-hidden border-2 cursor-pointer";

    switch (micState) {
      case "idle":
        return {
          className: `${baseClasses} w-9 border-white/70 bg-black/50 cursor-pointer`,
          tooltip: t("app.pressHotkeyToSpeak", { hotkey }),
        };
      case "hover":
        return {
          className: `${baseClasses} w-9 border-white/70 bg-black/50 cursor-pointer`,
          tooltip: t("app.pressHotkeyToSpeak", { hotkey }),
        };
      case "recording":
        return {
          className: `${baseClasses} border-white/15 bg-neutral-950/95 text-white shadow-lg shadow-black/20 backdrop-blur-sm`,
          tooltip: liveTranscript ? "" : t("app.recording"),
        };
      case "processing":
        return {
          className: `${baseClasses} w-9 border-white/30 bg-neutral-800 cursor-not-allowed`,
          tooltip: t("app.processing"),
        };
      default:
        return {
          className: `${baseClasses} w-9 border-white/70 bg-black/50 cursor-pointer`,
          style: { transform: "scale(0.8)" },
          tooltip: "Click to speak",
        };
    }
  };

  const micProps = getMicButtonProps();

  return (
    <div className="h-screen w-screen">
      <div className="flex h-full w-full items-end justify-center pb-4">
        <div
          className="relative flex items-center justify-center gap-2"
          onMouseEnter={() => {
            setIsHovered(true);
            setWindowInteractivity(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            if (!isCommandMenuOpen) {
              setWindowInteractivity(false);
            }
          }}
        >
          {isRecording && liveTranscript && isHovered && (
            <div className="absolute bottom-full left-1/2 mb-2 w-60 -translate-x-1/2 rounded-md border border-white/10 bg-neutral-950/90 px-3 py-2 text-left text-xs font-medium leading-relaxed text-white shadow-lg shadow-black/25 backdrop-blur-sm">
              {liveTranscript}
            </div>
          )}
          {isRecording && isHovered && (
            <Tooltip content={t("app.cancelRecording")}>
              <button
                aria-label={t("app.cancelRecording")}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelRecording();
                }}
                className="h-6 w-6 rounded-full border border-white/20 bg-neutral-800/90 shadow-lg backdrop-blur-sm transition-all duration-150 hover:border-white/30 hover:bg-neutral-700 flex items-center justify-center"
              >
                <X size={10} strokeWidth={2.5} color="white" />
              </button>
            </Tooltip>
          )}
          <Tooltip content={micProps.tooltip}>
            <button
              ref={buttonRef}
              onMouseDown={(e) => {
                setIsCommandMenuOpen(false);
                setDragStartPos({ x: e.clientX, y: e.clientY });
                setHasDragged(false);
                handleMouseDown(e);
              }}
              onMouseMove={(e) => {
                if (dragStartPos && !hasDragged) {
                  const distance = Math.sqrt(
                    Math.pow(e.clientX - dragStartPos.x, 2) +
                      Math.pow(e.clientY - dragStartPos.y, 2)
                  );
                  if (distance > 5) {
                    // 5px threshold for drag
                    setHasDragged(true);
                  }
                }
              }}
              onMouseUp={(e) => {
                handleMouseUp(e);
                setDragStartPos(null);
              }}
              onClick={(e) => {
                if (!hasDragged) {
                  setIsCommandMenuOpen(false);
                  toggleListening();
                }
                e.preventDefault();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!hasDragged) {
                  setWindowInteractivity(true);
                  setIsCommandMenuOpen((prev) => !prev);
                }
              }}
              onFocus={() => setIsHovered(true)}
              onBlur={() => setIsHovered(false)}
              className={micProps.className}
              style={{
                ...micProps.style,
                width: micState === "recording" ? `${recordingPeakWidth}px` : undefined,
                cursor:
                  micState === "processing"
                    ? "not-allowed !important"
                    : isDragging
                      ? "grabbing !important"
                      : "pointer !important",
                transition:
                  "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
              }}
            >
              {/* Background effects */}
              <div
                className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent transition-opacity duration-150"
                style={{ opacity: micState === "hover" ? 0.8 : 0 }}
              ></div>
              <div
                className="absolute inset-0 transition-colors duration-150"
                style={{
                  backgroundColor: micState === "hover" ? "rgba(0,0,0,0.1)" : "transparent",
                }}
              ></div>

              {/* Dynamic content based on state */}
              {micState === "idle" || micState === "hover" ? (
                <SoundWaveIcon size={micState === "idle" ? 11 : 12} />
              ) : micState === "recording" ? (
                <div className="relative z-10 flex w-full min-w-0 items-center gap-2 px-2.5">
                  <RecordingLiveDot level={audioLevel} />
                  {liveTranscript ? (
                    <span className="min-w-0 flex-1 truncate text-right text-xs font-medium leading-none tracking-normal text-white">
                      {liveTranscript}
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 justify-center">
                      <LoadingDots />
                    </span>
                  )}
                </div>
              ) : micState === "processing" ? (
                <VoiceWaveIndicator isListening={true} />
              ) : null}

              {/* State indicator ring for recording */}
              {micState === "recording" && (
                <div className="absolute inset-0 rounded-full border-2 border-white/60 animate-pulse"></div>
              )}

              {/* State indicator ring for processing */}
              {micState === "processing" && (
                <div className="absolute inset-0 rounded-full border-2 border-white/30 opacity-60"></div>
              )}
            </button>
          </Tooltip>
          {isCommandMenuOpen && (
            <div
              ref={commandMenuRef}
              className="absolute bottom-full left-1/2 mb-2 w-44 -translate-x-1/2 rounded-lg border border-white/10 bg-neutral-900/95 text-white shadow-lg backdrop-blur-sm"
              onMouseEnter={() => {
                setWindowInteractivity(true);
              }}
              onMouseLeave={() => {
                if (!isHovered) {
                  setWindowInteractivity(false);
                }
              }}
            >
              <button
                className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                onClick={() => {
                  toggleListening();
                }}
              >
                {isRecording ? t("app.stopListening") : t("app.startListening")}
              </button>
              <div className="h-px bg-white/10" />
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                onClick={() => {
                  setIsCommandMenuOpen(false);
                  setWindowInteractivity(false);
                  handleClose();
                }}
              >
                {t("app.hideForNow")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
