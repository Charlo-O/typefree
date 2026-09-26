import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { AudioLines, Check, X } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { VStack } from "@astryxdesign/core/VStack";
import { useToast } from "../../../components/ui/toast-context";
import { useClipboardListener } from "../../clipboardCenter/hooks/useClipboardListener";
import { useHotkey } from "../../hotkeys/hooks/useHotkey";
import { useI18n } from "../../../i18n";
import { platform } from "../../../shared/platform";
import type { PlatformListenerCleanup } from "../../../shared/platform";
import { useAudioRecording } from "../hooks/useAudioRecording";
import RecordingWaveform from "./RecordingWaveform";
import { useWindowDrag } from "./useWindowDrag";

type MicState = "idle" | "hover" | "recording" | "processing";
type CapsuleActionVariant = "cancel" | "confirm";
type SurfaceElement = HTMLElement;
type DragStartPosition = { x: number; y: number };

type SoundWaveIconProps = {
  size?: number;
};

type PushingTranscriptProps = {
  text: string;
};

type CapsuleActionProps = {
  variant: CapsuleActionVariant;
  label: string;
  onClick?: () => unknown;
};

type MicButtonProps = {
  className: string;
  tooltip: string;
};

function cleanupPlatformListener(listener: PlatformListenerCleanup): void {
  if (!listener) return;
  void Promise.resolve(listener)
    .then((unlisten) => unlisten?.())
    .catch(() => {
      // ignore cleanup failures
    });
}

// Sound Wave Icon Component (for idle/hover states)
const SoundWaveIcon = ({ size = 16 }: SoundWaveIconProps) => {
  return <AudioLines aria-hidden="true" size={size} strokeWidth={2.4} />;
};

const PushingTranscript = ({ text }: PushingTranscriptProps) => (
  <Text
    as="span"
    type="label"
    color="inherit"
    textWrap="nowrap"
    maxLines={1}
    className="min-w-0 flex-1 justify-end overflow-hidden text-white"
  >
    {text}
  </Text>
);

const CapsuleAction = ({ variant, label, onClick }: CapsuleActionProps) => (
  <Button
    type="button"
    label={label}
    size="sm"
    isIconOnly
    variant={variant === "confirm" ? "primary" : "ghost"}
    icon={
      variant === "confirm" ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />
    }
    onMouseDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.();
    }}
    className="relative z-20 h-6 w-6 shrink-0 rounded-full"
  ></Button>
);

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef<HTMLElement | null>(null);
  const buttonRef = useRef<SurfaceElement | null>(null);
  const { toast } = useToast();
  const { t } = useI18n();
  useClipboardListener();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();
  const [dragStartPos, setDragStartPos] = useState<DragStartPosition | null>(null);
  const [hasDragged, setHasDragged] = useState(false);

  const setSurfaceRef = useCallback((element: SurfaceElement | null) => {
    buttonRef.current = element;
  }, []);

  const setWindowInteractivity = useCallback((shouldCapture: boolean) => {
    void platform.window.setMainWindowInteractivity(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    const unsubscribeFallback = platform.hotkeys.onFallbackUsed((data) => {
      toast({
        title: "Hotkey Changed",
        description: data.message,
        duration: 8000,
      });
    });

    const unsubscribeFailed = platform.hotkeys.onRegistrationFailed(() => {
      toast({
        title: "Hotkey Unavailable",
        description: `Could not register hotkey. Please set a different hotkey in Settings.`,
        duration: 10000,
      });
    });

    return () => {
      cleanupPlatformListener(unsubscribeFallback);
      cleanupPlatformListener(unsubscribeFailed);
    };
  }, [toast]);

  useEffect(() => {
    if (isCommandMenuOpen) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, setWindowInteractivity]);

  const handleDictationToggle = useCallback(() => {
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
      void platform.window.hide();
    }
  }, [isRecording, isProcessing, isCommandMenuOpen]);

  const handleClose = () => {
    void platform.window.hide();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (
        commandMenuRef.current &&
        event.target instanceof Node &&
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
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
  const getMicState = (): MicState => {
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (isHovered && !isRecording && !isProcessing) return "hover";
    return "idle";
  };

  const micState = getMicState();
  const processingLabel = "优化中";
  const displayTranscript = String(liveTranscript || "").trim();

  const getMicButtonProps = (): MicButtonProps => {
    const baseClasses =
      "rounded-full flex items-center justify-center relative overflow-hidden border ring-1 ring-white/10";

    switch (micState) {
      case "idle":
        return {
          className: `${baseClasses} h-9 w-9 border-white/10 bg-neutral-900/60 backdrop-blur-md cursor-pointer transition-all duration-300`,
          tooltip: t("app.pressHotkeyToSpeak", { hotkey }),
        };
      case "hover":
        return {
          className: `${baseClasses} h-9 w-9 border-white/30 bg-neutral-800/80 backdrop-blur-md cursor-pointer scale-105 transition-all duration-300`,
          tooltip: t("app.pressHotkeyToSpeak", { hotkey }),
        };
      case "recording":
        return {
          className: `${baseClasses} h-8 border-white/10 bg-neutral-950/95 px-1.5 text-white backdrop-blur-md transition-all duration-200`,
          tooltip: displayTranscript ? "" : t("app.recording"),
        };
      case "processing":
        return {
          className: `${baseClasses} h-8 border-white/10 bg-neutral-700/90 px-5 text-white/70 backdrop-blur-md cursor-not-allowed transition-all duration-200`,
          tooltip: processingLabel,
        };
      default:
        return {
          className: `${baseClasses} h-9 w-9 border-white/10 bg-neutral-900/60 cursor-pointer`,
          tooltip: "Click to speak",
        };
    }
  };

  const micProps = getMicButtonProps();
  const shouldShowPanel = isRecording || isProcessing || isCommandMenuOpen;
  const surfaceWidth =
    micState === "recording" ? recordingPeakWidth : micState === "processing" ? 92 : 36;
  const surfaceClassName = [
    micProps.className,
    "transition-[width,transform,background-color] duration-200",
    micState === "processing"
      ? "cursor-not-allowed"
      : isDragging
        ? "cursor-grabbing"
        : "cursor-pointer",
  ].join(" ");

  const handleSurfaceMouseDown = (e: MouseEvent<HTMLElement>) => {
    setIsCommandMenuOpen(false);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    setHasDragged(false);
    handleMouseDown(e);
  };

  const handleSurfaceMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (dragStartPos && !hasDragged) {
      const distance = Math.sqrt(
        Math.pow(e.clientX - dragStartPos.x, 2) + Math.pow(e.clientY - dragStartPos.y, 2)
      );
      if (distance > 5) {
        setHasDragged(true);
      }
    }
  };

  const handleSurfaceMouseUp = (e: MouseEvent<HTMLElement>) => {
    handleMouseUp();
    setDragStartPos(null);
  };

  const handleSurfaceClick = (e: MouseEvent<HTMLElement>) => {
    if (!hasDragged) {
      setIsCommandMenuOpen(false);
      toggleListening();
    }
    e.preventDefault();
  };

  const handleSurfaceContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    if (!hasDragged) {
      setWindowInteractivity(true);
      setIsCommandMenuOpen((prev) => !prev);
    }
  };

  const sharedSurfaceProps = {
    onMouseDown: handleSurfaceMouseDown,
    onMouseMove: handleSurfaceMouseMove,
    onMouseUp: handleSurfaceMouseUp,
    onClick: handleSurfaceClick,
    onContextMenu: handleSurfaceContextMenu,
    onFocus: () => setIsHovered(true),
    onBlur: () => setIsHovered(false),
  };

  if (!shouldShowPanel) {
    return <VStack height="100%" width="100%" />;
  }

  return (
    <VStack height="100%" width="100%" vAlign="end" hAlign="center" paddingBlockEnd={4}>
      <HStack
        width="100%"
        hAlign="center"
        vAlign="center"
        gap={2}
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
        <Tooltip content={micProps.tooltip} isEnabled={Boolean(micProps.tooltip)}>
          {micState === "recording" ? (
            <HStack
              {...sharedSurfaceProps}
              ref={setSurfaceRef}
              role="group"
              aria-label={t("app.recording")}
              width={surfaceWidth}
              height={32}
              hAlign="center"
              vAlign="center"
              gap={1}
              className={`${surfaceClassName} rounded-full px-1.5 text-white backdrop-blur-md`}
            >
              <CapsuleAction
                variant="cancel"
                label={t("app.cancelRecording")}
                onClick={cancelRecording}
              />
              <StackItem size="fill" className="flex min-w-0 items-center justify-center px-1">
                {displayTranscript ? (
                  <PushingTranscript text={displayTranscript} />
                ) : (
                  <RecordingWaveform />
                )}
              </StackItem>
              <CapsuleAction
                variant="confirm"
                label={t("app.stopListening")}
                onClick={toggleListening}
              />
            </HStack>
          ) : micState === "processing" ? (
            <Button
              {...sharedSurfaceProps}
              ref={setSurfaceRef}
              type="button"
              label={processingLabel}
              variant="secondary"
              width={surfaceWidth}
              isDisabled
              role="status"
              aria-live="polite"
              className={`${surfaceClassName} h-8 rounded-full text-white/70`}
            />
          ) : (
            <Button
              {...sharedSurfaceProps}
              ref={setSurfaceRef}
              type="button"
              label={t("app.pressHotkeyToSpeak", { hotkey })}
              tooltip={micProps.tooltip}
              variant="ghost"
              size="md"
              isIconOnly
              icon={<SoundWaveIcon size={micState === "idle" ? 16 : 18} />}
              className={`${surfaceClassName} rounded-full ${micState === "hover" ? "scale-105" : ""}`}
            />
          )}
        </Tooltip>
        {isCommandMenuOpen && (
          <VStack
            ref={commandMenuRef}
            width={176}
            gap={1}
            padding={1}
            role="menu"
            className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg border border-white/10 bg-neutral-900/95 text-white backdrop-blur-sm"
            onMouseEnter={() => {
              setWindowInteractivity(true);
            }}
            onMouseLeave={() => {
              if (!isHovered) {
                setWindowInteractivity(false);
              }
            }}
          >
            <Button
              label={isRecording ? t("app.stopListening") : t("app.startListening")}
              variant="ghost"
              width="100%"
              className="justify-start text-left text-sm font-medium"
              onClick={() => {
                toggleListening();
              }}
            >
              {isRecording ? t("app.stopListening") : t("app.startListening")}
            </Button>
            <Button
              label={t("app.hideForNow")}
              variant="ghost"
              width="100%"
              className="justify-start text-left text-sm"
              onClick={() => {
                setIsCommandMenuOpen(false);
                setWindowInteractivity(false);
                handleClose();
              }}
            >
              {t("app.hideForNow")}
            </Button>
          </VStack>
        )}
      </HStack>
    </VStack>
  );
}
