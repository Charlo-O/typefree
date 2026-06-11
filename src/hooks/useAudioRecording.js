import { useState, useEffect, useRef } from "react";
import AudioManager from "../helpers/audioManager";
import { playStartSound, playStopSound } from "../helpers/soundFeedback";

const ACTIVE_AUDIO_MANAGER_TOKEN_KEY = "__typefreeActiveAudioManagerToken";

const setActiveToken = (token) => {
  try {
    window[ACTIVE_AUDIO_MANAGER_TOKEN_KEY] = token;
  } catch {
    // ignore
  }
};

const isActiveToken = (token) => {
  try {
    return window[ACTIVE_AUDIO_MANAGER_TOKEN_KEY] === token;
  } catch {
    return true;
  }
};

const playRecordingStartSound = (recordingFeedbackRef) => {
  if (recordingFeedbackRef.current) return;
  recordingFeedbackRef.current = true;
  playStartSound();
};

const playRecordingStopSound = (recordingFeedbackRef) => {
  if (!recordingFeedbackRef.current) return;
  recordingFeedbackRef.current = false;
  playStopSound();
};

const createCompletionGuard = () => ({
  insertedText: "",
  lastText: "",
  lastAt: 0,
  savedTexts: new Set(),
});

export const useAudioRecording = (toast, options = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const audioManagerRef = useRef(null);
  const recordingFeedbackRef = useRef(false);
  const completionGuardRef = useRef(createCompletionGuard());
  const stopRequestedRef = useRef(false);
  const { onToggle } = options;
  const toastRef = useRef(toast);
  const onToggleRef = useRef(onToggle);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    audioManagerRef.current = new AudioManager();
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setActiveToken(token);

    // macOS hotkey dictation can run in the backend while the renderer is throttled (fullscreen apps).
    // Keep a minimal copy of the relevant settings in the Tauri backend so it knows which provider/model
    // to use when triggered by the global shortcut.
    try {
      const isMac = /\bMac\b|\bDarwin\b/i.test(navigator.platform || navigator.userAgent || "");
      if (isMac && window.electronAPI?.setSetting) {
        const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";
        const model = localStorage.getItem("cloudTranscriptionModel") || "";
        const preferredLanguage = localStorage.getItem("preferredLanguage") || "auto";
        const activationMode = localStorage.getItem("activationMode") || "tap";
        const transcriptionPrompt = localStorage.getItem("transcriptionPrompt") || "";

        void window.electronAPI.setSetting("cloudTranscriptionProvider", provider);
        void window.electronAPI.setSetting("cloudTranscriptionModel", model);
        void window.electronAPI.setSetting("preferredLanguage", preferredLanguage);
        void window.electronAPI.setSetting("activationMode", activationMode);
        void window.electronAPI.setSetting("transcriptionPrompt", transcriptionPrompt);
      }
    } catch {
      // ignore
    }

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing }) => {
        if (!isActiveToken(token)) return;
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
        if (isRecording) {
          completionGuardRef.current = createCompletionGuard();
          stopRequestedRef.current = false;
          setLiveTranscript("");
        }
        if (!isRecording && isProcessing) {
          stopRequestedRef.current = true;
        }
        if (!isRecording) {
          setAudioLevel(0);
        }
      },
      onError: (error) => {
        if (!isActiveToken(token)) return;
        recordingFeedbackRef.current = false;
        setLiveTranscript("");
        setAudioLevel(0);
        toastRef.current?.({
          title: error.title,
          description: error.description,
          variant: "destructive",
        });
      },
      onTranscriptionComplete: async (result) => {
        if (!isActiveToken(token)) return;
        if (result.success) {
          const text = String(result.text || "");
          const normalizedText = text.trim();
          if (!normalizedText) return;

          const guard = completionGuardRef.current;
          const now = Date.now();
          if (guard.lastText === normalizedText && now - guard.lastAt < 10000) {
            console.warn("[Transcription] Duplicate completion ignored", {
              source: result.source,
              length: normalizedText.length,
            });
            return;
          }

          guard.lastText = normalizedText;
          guard.lastAt = now;

          setTranscript(text);
          setLiveTranscript(text);
          setAudioLevel(0);
          console.log("[Transcription] Complete, text:", text.substring(0, 50));

          if (!result.skipPaste) {
            if (!stopRequestedRef.current) {
              console.warn("[Transcription] Final insertion skipped until explicit stop", {
                source: result.source,
                length: normalizedText.length,
              });
            } else {
              try {
                const alreadyInserted = guard.insertedText;
                if (!alreadyInserted) {
                  await window.electronAPI?.hideWindow?.();
                  await new Promise((resolve) => setTimeout(resolve, 180));
                  const pasted = await audioManagerRef.current.safePaste(text);
                  if (pasted) guard.insertedText = normalizedText;
                } else {
                  console.warn("[Transcription] Additional completion skipped after final insert", {
                    source: result.source,
                    insertedLength: alreadyInserted.length,
                    nextLength: normalizedText.length,
                  });
                }
              } catch (err) {
                console.error("[Transcription] Failed to insert text:", err);
              }
            }
          } else if (!guard.insertedText || normalizedText.length >= guard.insertedText.length) {
            guard.insertedText = normalizedText;
          }

          // 2. Save to clipboard history (instead of auto-paste)
          try {
            if (guard.savedTexts.has(normalizedText)) {
              return;
            }
            guard.savedTexts.add(normalizedText);
            const HISTORY_KEY = "clipboard.history";
            const MAX_KEY = "clipboard.maxItems";
            const maxItems = Number.parseInt(localStorage.getItem(MAX_KEY) || "50", 10) || 50;
            const existing = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
            const newItem = {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              type: "text",
              content: text,
              tsMs: Date.now(),
            };
            const next = [newItem, ...existing].slice(0, maxItems);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
            console.log("[Transcription] Saved to clipboard history");
          } catch (err) {
            console.error("[Transcription] Failed to save to clipboard history:", err);
          }

          // 3. Save transcription to DB
          audioManagerRef.current.saveTranscription(text);
        }
      },
      onLiveTranscript: (result) => {
        if (!isActiveToken(token)) return;
        setLiveTranscript(String(result?.text || ""));
      },
      onAudioLevel: (level) => {
        if (!isActiveToken(token)) return;
        setAudioLevel(Math.max(0, Math.min(1, Number(level) || 0)));
      },
    });

    // Set up hotkey listener for tap-to-talk mode
    const handleToggle = () => {
      if (!isActiveToken(token)) return;
      const currentState = audioManagerRef.current.getState();

      if (!currentState.isRecording && !currentState.isProcessing && !currentState.isStarting) {
        // 开始录音：显示窗口 + 播放开始音
        stopRequestedRef.current = false;
        window.electronAPI?.showWindow?.();
        setLiveTranscript("");
        setAudioLevel(0);
        playRecordingStartSound(recordingFeedbackRef);
        audioManagerRef.current.startRecording();
      } else if (currentState.isRecording || currentState.isStarting) {
        // 停止录音：播放停止音
        stopRequestedRef.current = true;
        playRecordingStopSound(recordingFeedbackRef);
        audioManagerRef.current.requestStop?.() || audioManagerRef.current.stopRecording();
      } else if (currentState.isProcessing) {
        stopRequestedRef.current = true;
      }
    };

    // Set up listener for push-to-talk start
    const handleStart = () => {
      if (!isActiveToken(token)) return;
      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording && !currentState.isProcessing && !currentState.isStarting) {
        // 开始录音：显示窗口 + 播放开始音
        stopRequestedRef.current = false;
        window.electronAPI?.showWindow?.();
        setLiveTranscript("");
        setAudioLevel(0);
        playRecordingStartSound(recordingFeedbackRef);
        audioManagerRef.current.startRecording();
      }
    };

    // Set up listener for push-to-talk stop
    const handleStop = () => {
      if (!isActiveToken(token)) return;
      stopRequestedRef.current = true;
      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording || currentState.isStarting) {
        // 停止录音：播放停止音
        playRecordingStopSound(recordingFeedbackRef);
        audioManagerRef.current.requestStop?.() || audioManagerRef.current.stopRecording();
      }
    };

    // In Tauri, event listeners typically return a Promise<unlisten>.
    // In Electron, they commonly return an unlisten function directly.
    const toCleanup = (maybeUnlisten) => {
      if (!maybeUnlisten) return null;
      if (typeof maybeUnlisten === "function") {
        return { kind: "fn", fn: maybeUnlisten };
      }
      if (typeof maybeUnlisten.then === "function") {
        return { kind: "promise", promise: maybeUnlisten };
      }
      return null;
    };

    const disposeToggle = toCleanup(
      window.electronAPI?.onToggleDictation?.(() => {
        handleToggle();
        onToggleRef.current?.();
      })
    );

    const disposeStart = toCleanup(
      window.electronAPI?.onStartDictation?.(() => {
        handleStart();
        onToggleRef.current?.();
      })
    );

    const disposeStop = toCleanup(
      window.electronAPI?.onStopDictation?.(() => {
        handleStop();
        onToggleRef.current?.();
      })
    );

    const disposeBackendShowWindow = toCleanup(
      window.electronAPI?.onBackendDictationShowWindow?.(() => {
        if (!isActiveToken(token)) return;
        window.electronAPI?.showWindow?.();
      })
    );

    const disposeBackendError = toCleanup(
      window.electronAPI?.onBackendDictationError?.((message) => {
        if (!isActiveToken(token)) return;
        toastRef.current?.({
          title: "Dictation Error",
          description: String(message || "Unknown error"),
          variant: "destructive",
        });
      })
    );

    const disposeBackendRecording = toCleanup(
      window.electronAPI?.onBackendDictationRecording?.((value) => {
        if (!isActiveToken(token)) return;
        const next = !!value;
        setIsRecording(next);
        if (next) {
          setLiveTranscript("");
          setAudioLevel(0);
          playRecordingStartSound(recordingFeedbackRef);
        } else {
          setAudioLevel(0);
          playRecordingStopSound(recordingFeedbackRef);
        }
      })
    );

    const disposeBackendProcessing = toCleanup(
      window.electronAPI?.onBackendDictationProcessing?.((value) => {
        if (!isActiveToken(token)) return;
        setIsProcessing(!!value);
      })
    );

    const disposeBackendResult = toCleanup(
      window.electronAPI?.onBackendDictationResult?.((text) => {
        if (!isActiveToken(token)) return;
        setTranscript(String(text || ""));
        setLiveTranscript(String(text || ""));
        setAudioLevel(0);
      })
    );

    const handleNoAudioDetected = () => {
      if (!isActiveToken(token)) return;
      toastRef.current?.({
        title: "No Audio Detected",
        description: "The recording contained no detectable audio. Please try again.",
        variant: "default",
      });
    };

    const disposeNoAudio = window.electronAPI.onNoAudioDetected?.(handleNoAudioDetected);

    // Cleanup
    return () => {
      // Ensure we actually unlisten even if the listener registration was async.
      const runCleanup = async (cleanup) => {
        if (!cleanup) return;
        try {
          if (cleanup.kind === "fn") {
            cleanup.fn?.();
            return;
          }
          const fn = await cleanup.promise;
          fn?.();
        } catch {
          // ignore
        }
      };

      // Fire-and-forget async cleanup; ensures UnlistenFn is obtained then called.
      runCleanup(disposeToggle);
      runCleanup(disposeStart);
      runCleanup(disposeStop);
      runCleanup(disposeBackendShowWindow);
      runCleanup(disposeBackendError);
      runCleanup(disposeBackendRecording);
      runCleanup(disposeBackendProcessing);
      runCleanup(disposeBackendResult);
      disposeNoAudio?.();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, []);

  const startRecording = async () => {
    if (audioManagerRef.current) {
      stopRequestedRef.current = false;
      return await audioManagerRef.current.startRecording();
    }
    return false;
  };

  const stopRecording = () => {
    if (audioManagerRef.current) {
      stopRequestedRef.current = true;
      return audioManagerRef.current.stopRecording();
    }
    return false;
  };

  const cancelRecording = () => {
    if (audioManagerRef.current) {
      stopRequestedRef.current = false;
      setLiveTranscript("");
      setAudioLevel(0);
      return audioManagerRef.current.cancelRecording();
    }
    return false;
  };

  const toggleListening = () => {
    const currentState = audioManagerRef.current?.getState?.() ?? {
      isRecording,
      isProcessing,
      isStarting: false,
    };

    if (!currentState.isRecording && !currentState.isProcessing && !currentState.isStarting) {
      // 开始录音：显示窗口 + 播放开始音
      stopRequestedRef.current = false;
      window.electronAPI?.showWindow?.();
      setLiveTranscript("");
      setAudioLevel(0);
      playRecordingStartSound(recordingFeedbackRef);
      startRecording();
    } else if (currentState.isRecording || currentState.isStarting) {
      // 停止录音：播放停止音
      stopRequestedRef.current = true;
      playRecordingStopSound(recordingFeedbackRef);
      audioManagerRef.current?.requestStop?.() || stopRecording();
    } else if (currentState.isProcessing) {
      stopRequestedRef.current = true;
    }
  };

  return {
    isRecording,
    isProcessing,
    transcript,
    liveTranscript,
    audioLevel,
    startRecording,
    stopRecording,
    cancelRecording,
    toggleListening,
  };
};
