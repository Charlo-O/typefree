import React, { useState, useEffect, useRef } from "react";
import "./index.css";
import { Check, X } from "lucide-react";
import { useToast } from "./components/ui/Toast";
import { useHotkey } from "./hooks/useHotkey";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useClipboardListener } from "./hooks/useClipboardListener";
import { useI18n } from "./i18n";
import RecordingWaveform from "./components/RecordingWaveform";

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

const PushingTranscript = ({ text }) => (
  <span
    className="flex min-w-0 flex-1 justify-end overflow-hidden text-xs font-medium leading-none tracking-normal text-white"
    style={{
      WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 14px, #000 100%)",
      maskImage: "linear-gradient(90deg, transparent 0, #000 14px, #000 100%)",
    }}
  >
    <span className="max-w-none shrink-0 whitespace-nowrap">{text}</span>
  </span>
);

const CapsuleAction = ({ variant, label, onClick }) => (
  <button
    type="button"
    aria-label={label}
    onMouseDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.();
    }}
    className={[
      "relative z-20 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150",
      variant === "confirm"
        ? "border border-white/80 bg-white text-neutral-950 hover:bg-white/90"
        : "border border-white/20 bg-neutral-800/95 text-white/90 hover:bg-neutral-700",
    ].join(" ")}
  >
    {variant === "confirm" ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}
  </button>
);

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

  const { isRecording, isProcessing, liveTranscript, toggleListening, cancelRecording } =
    useAudioRecording(toast, {
      onToggle: handleDictationToggle,
    });
  const [recordingPeakWidth, setRecordingPeakWidth] = useState(124);

  useEffect(() => {
    if (!isRecording) {
      setRecordingPeakWidth(124);
      return;
    }

    const textLength = Array.from(String(liveTranscript || "").trim()).length;
    const needed = textLength > 0 ? Math.min(224, Math.max(124, 78 + textLength * 10)) : 124;
    setRecordingPeakWidth((current) => {
      if (needed > current) return needed;
      if (current - needed > 32) return needed;
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
  const processingLabel = "优化中";
  const displayTranscript = String(liveTranscript || "").trim();

  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full flex items-center justify-center relative overflow-hidden border ring-1 ring-white/10";

    switch (micState) {
      case "idle":
        return {
          className: `${baseClasses} h-9 w-9 border-white/10 bg-neutral-900/60 backdrop-blur-md shadow-lg shadow-black/30 cursor-pointer transition-all duration-300`,
          tooltip: t("app.pressHotkeyToSpeak", { hotkey }),
        };
      case "hover":
        return {
          className: `${baseClasses} h-9 w-9 border-white/30 bg-neutral-800/80 backdrop-blur-md shadow-xl shadow-black/40 cursor-pointer scale-105 transition-all duration-300`,
          tooltip: t("app.pressHotkeyToSpeak", { hotkey }),
        };
      case "recording":
        return {
          className: `${baseClasses} h-8 border-white/10 bg-neutral-950/95 px-1.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md transition-all duration-200`,
          tooltip: displayTranscript ? "" : t("app.recording"),
        };
      case "processing":
        return {
          className: `${baseClasses} h-8 border-white/10 bg-neutral-700/90 px-5 text-white/70 shadow-[0_8px_22px_rgba(0,0,0,0.28)] backdrop-blur-md cursor-not-allowed transition-all duration-200`,
          tooltip: processingLabel,
        };
      default:
        return {
          className: `${baseClasses} h-9 w-9 border-white/10 bg-neutral-900/60 cursor-pointer`,
          style: { transform: "scale(0.8)" },
          tooltip: "Click to speak",
        };
    }
  };

  const micProps = getMicButtonProps();
  const surfaceStyle = {
    ...micProps.style,
    width:
      micState === "recording"
        ? `${recordingPeakWidth}px`
        : micState === "processing"
          ? "92px"
          : undefined,
    cursor: micState === "processing" ? "not-allowed" : isDragging ? "grabbing" : "pointer",
    transition:
      "width 0.22s ease, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
  };

  const handleSurfaceMouseDown = (e) => {
    setIsCommandMenuOpen(false);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    setHasDragged(false);
    handleMouseDown(e);
  };

  const handleSurfaceMouseMove = (e) => {
    if (dragStartPos && !hasDragged) {
      const distance = Math.sqrt(
        Math.pow(e.clientX - dragStartPos.x, 2) + Math.pow(e.clientY - dragStartPos.y, 2)
      );
      if (distance > 5) {
        setHasDragged(true);
      }
    }
  };

  const handleSurfaceMouseUp = (e) => {
    handleMouseUp(e);
    setDragStartPos(null);
  };

  const handleSurfaceClick = (e) => {
    if (!hasDragged) {
      setIsCommandMenuOpen(false);
      toggleListening();
    }
    e.preventDefault();
  };

  const handleSurfaceContextMenu = (e) => {
    e.preventDefault();
    if (!hasDragged) {
      setWindowInteractivity(true);
      setIsCommandMenuOpen((prev) => !prev);
    }
  };

  const sharedSurfaceProps = {
    ref: buttonRef,
    onMouseDown: handleSurfaceMouseDown,
    onMouseMove: handleSurfaceMouseMove,
    onMouseUp: handleSurfaceMouseUp,
    onClick: handleSurfaceClick,
    onContextMenu: handleSurfaceContextMenu,
    onFocus: () => setIsHovered(true),
    onBlur: () => setIsHovered(false),
    className: micProps.className,
    style: surfaceStyle,
  };

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
          <Tooltip content={micProps.tooltip}>
            {micState === "recording" ? (
              <div {...sharedSurfaceProps} role="group" aria-label={t("app.recording")}>
                <CapsuleAction
                  variant="cancel"
                  label={t("app.cancelRecording")}
                  onClick={cancelRecording}
                />
                <span className="relative z-10 flex min-w-0 flex-1 items-center justify-center px-1">
                  {displayTranscript ? (
                    <PushingTranscript text={displayTranscript} />
                  ) : (
                    <RecordingWaveform />
                  )}
                </span>
                <CapsuleAction
                  variant="confirm"
                  label={t("app.stopListening")}
                  onClick={toggleListening}
                />
              </div>
            ) : micState === "processing" ? (
              <div {...sharedSurfaceProps} role="status" aria-live="polite">
                <span className="relative z-10 text-xs font-semibold leading-none text-white/60">
                  {processingLabel}
                </span>
              </div>
            ) : (
              <button type="button" {...sharedSurfaceProps}>
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
                <SoundWaveIcon size={micState === "idle" ? 11 : 12} />
              </button>
            )}
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
