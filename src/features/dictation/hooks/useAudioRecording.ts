import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import AudioManager from "../audio/audioManager";
import platform from "../../../shared/platform";
import type {
  BackendDictationSessionPayload,
  DictationPhase,
  ForegroundApplication,
  PlatformListenerCleanup,
} from "../../../shared/platform";
import {
  canTransitionDictationSession,
  createDictationSessionId,
  createInitialDictationSession,
  isDictationProcessingPhase,
  isDictationRecordingPhase,
  reduceDictationSession,
} from "../state/dictationSessionMachine";
import {
  createDictationCompletionGuard,
  runDictationCompletionPipeline,
} from "../pipeline/completionPipeline";
import type {
  CompletionPipelineStep,
  DictationCompletionGuard,
} from "../pipeline/completionPipeline";
import {
  createDictationTimelineSession,
  readDictationTimelineSession,
  recordDictationPipelineSteps,
  recordDictationTimelineEvent,
} from "../timeline/sessionTimeline";
import type {
  DictationTimelineEventInput,
  DictationTimelineSession,
} from "../timeline/sessionTimeline";
import type { TranscriptionPipelineStep } from "../pipeline/transcriptionPipeline";
import type { AudioManagerConstructor, AudioManagerFacade } from "../audio/audioManagerTypes";
import { loadVocabularySettings, syncVocabularySettingsToBackend } from "../../../utils/vocabulary";
import {
  createPrivacySkipReason,
  isForegroundApplicationBlacklisted,
  readPrivacySettings,
} from "../../privacy/privacySettings";
import { playStartSound, playStopSound } from "../audio/soundFeedback";

const ACTIVE_AUDIO_MANAGER_TOKEN_KEY = "__typefreeActiveAudioManagerToken";

type ToastPayload = {
  title?: string;
  description?: string;
  variant?: string;
  duration?: number;
};

type ToastFn = (payload: ToastPayload) => void;

type UseAudioRecordingOptions = {
  onToggle?: () => void;
};

type ListenerCleanup =
  | { kind: "fn"; fn: () => void }
  | { kind: "promise"; promise: Promise<() => void> };

type PipelineStage = "postprocessing" | "completion";
type TimelinePipelineStep = TranscriptionPipelineStep | CompletionPipelineStep;

export type UseAudioRecordingResult = {
  isRecording: boolean;
  isProcessing: boolean;
  transcript: string;
  liveTranscript: string;
  audioLevel: number;
  dictationPhase: DictationPhase;
  sessionId: string | null;
  dictationTimeline: DictationTimelineSession | null;
  startRecording: () => Promise<boolean>;
  stopRecording: () => boolean | Promise<boolean>;
  cancelRecording: () => boolean | Promise<boolean>;
  toggleListening: () => void;
};

const AudioManagerCtor = AudioManager as unknown as AudioManagerConstructor;

const setActiveToken = (token: string): void => {
  try {
    (window as unknown as Record<string, string | undefined>)[ACTIVE_AUDIO_MANAGER_TOKEN_KEY] =
      token;
  } catch {
    // ignore
  }
};

const isActiveToken = (token: string): boolean => {
  try {
    return (
      (window as unknown as Record<string, string | undefined>)[ACTIVE_AUDIO_MANAGER_TOKEN_KEY] ===
      token
    );
  } catch {
    return true;
  }
};

const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
};

const playRecordingStartSound = (recordingFeedbackRef: MutableRefObject<boolean>): void => {
  if (recordingFeedbackRef.current) return;
  recordingFeedbackRef.current = true;
  playStartSound();
};

const playRecordingStopSound = (recordingFeedbackRef: MutableRefObject<boolean>): void => {
  if (!recordingFeedbackRef.current) return;
  recordingFeedbackRef.current = false;
  playStopSound();
};

export const useAudioRecording = (
  toast?: ToastFn,
  options: UseAudioRecordingOptions = {}
): UseAudioRecordingResult => {
  const [transcript, setTranscript] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [dictationTimeline, setDictationTimeline] = useState<DictationTimelineSession | null>(null);
  const [dictationSession, dispatchDictationSession] = useReducer(
    reduceDictationSession,
    undefined,
    createInitialDictationSession
  );
  const isRecording = isDictationRecordingPhase(dictationSession.phase);
  const isProcessing = isDictationProcessingPhase(dictationSession.phase);
  const audioManagerRef = useRef<AudioManagerFacade | null>(null);
  const recordingFeedbackRef = useRef(false);
  const completionGuardRef = useRef<DictationCompletionGuard>(createDictationCompletionGuard());
  const stopRequestedRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const foregroundApplicationRef = useRef<ForegroundApplication | null>(null);
  const { onToggle } = options;
  const toastRef = useRef<ToastFn | undefined>(toast);
  const onToggleRef = useRef<UseAudioRecordingOptions["onToggle"]>(onToggle);
  const dictationSessionRef = useRef(dictationSession);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    dictationSessionRef.current = dictationSession;
  }, [dictationSession]);

  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  const beginSession = useCallback((source = "renderer"): string => {
    const sessionId = createDictationSessionId(source);
    currentSessionIdRef.current = sessionId;
    dispatchDictationSession({ type: "start", sessionId });
    setDictationTimeline(createDictationTimelineSession(sessionId, source));
    return sessionId;
  }, []);

  const getCurrentSessionId = useCallback(
    (source = "renderer"): string => {
      if (!currentSessionIdRef.current) {
        return beginSession(source);
      }
      return currentSessionIdRef.current;
    },
    [beginSession]
  );

  const recordTimelineEvent = useCallback(
    (sessionId: string, event: DictationTimelineEventInput) => {
      const timeline = recordDictationTimelineEvent(sessionId, event);
      if (timeline) {
        setDictationTimeline(timeline);
      }
    },
    []
  );

  const recordPipelineSteps = useCallback(
    (
      sessionId: string,
      stage: PipelineStage,
      steps: TimelinePipelineStep[] | null | undefined,
      meta: Record<string, unknown> = {}
    ) => {
      const timeline = recordDictationPipelineSteps(sessionId, stage, steps, meta);
      if (timeline) {
        setDictationTimeline(timeline);
      }
    },
    []
  );

  const prepareBackendSessionFeedback = useCallback(
    (payload: BackendDictationSessionPayload): string | null => {
      const sessionId = String(payload?.sessionId || "");
      if (!sessionId) {
        return null;
      }

      const currentSession = dictationSessionRef.current;
      const hasActiveDifferentSession =
        currentSession.sessionId &&
        currentSession.sessionId !== sessionId &&
        !["idle", "completed", "failed"].includes(currentSession.phase);

      if (hasActiveDifferentSession) {
        return null;
      }

      currentSessionIdRef.current = sessionId;
      dispatchDictationSession({ type: "start", sessionId });
      if (!readDictationTimelineSession(sessionId)) {
        setDictationTimeline(createDictationTimelineSession(sessionId, "backend"));
      }
      return sessionId;
    },
    []
  );

  const syncForegroundApplicationVocabulary = useCallback(
    async (sessionId: string, source = "renderer"): Promise<ForegroundApplication | null> => {
      const refreshVocabularyCache = async (applicationId: string | null) => {
        try {
          await loadVocabularySettings();
          recordTimelineEvent(sessionId, {
            kind: "backend",
            label: "vocabulary.cache-refreshed",
            status: "completed",
            source,
            meta: {
              applicationId,
            },
          });
        } catch (cacheError) {
          recordTimelineEvent(sessionId, {
            kind: "backend",
            label: "vocabulary.cache-refresh-failed",
            status: "failed",
            source,
            detail: errorMessage(cacheError, "Unknown vocabulary cache refresh error"),
            meta: {
              applicationId,
            },
          });
        }
      };

      try {
        if (typeof platform.app?.syncForegroundApplicationVocabulary !== "function") {
          return null;
        }
        const foregroundApplication = await platform.app.syncForegroundApplicationVocabulary();
        foregroundApplicationRef.current = foregroundApplication;
        await refreshVocabularyCache(foregroundApplication?.id || null);
        if (foregroundApplication?.id) {
          recordTimelineEvent(sessionId, {
            kind: "backend",
            label: "foreground-application.synced",
            status: "completed",
            source,
            meta: {
              applicationId: foregroundApplication.id,
              applicationName: foregroundApplication.name || "",
              platform: foregroundApplication.platform || "",
            },
          });
        }
        return foregroundApplication;
      } catch (error) {
        foregroundApplicationRef.current = null;
        await refreshVocabularyCache(null);
        recordTimelineEvent(sessionId, {
          kind: "backend",
          label: "foreground-application.sync-failed",
          status: "failed",
          source,
          detail: errorMessage(error, "Unknown foreground app sync error"),
        });
        return null;
      }
    },
    [recordTimelineEvent]
  );

  const getHistoryPrivacyOptions = useCallback(() => {
    const privacySettings = readPrivacySettings();
    const application = foregroundApplicationRef.current;
    const skipHistory =
      privacySettings.pauseHistoryInBlacklistedApps &&
      isForegroundApplicationBlacklisted(application, privacySettings.applicationBlacklist);

    return {
      skipHistory,
      historySkipReason: skipHistory ? createPrivacySkipReason(application) : undefined,
    };
  }, []);

  useEffect(() => {
    audioManagerRef.current = new AudioManagerCtor(platform);
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setActiveToken(token);

    // macOS hotkey dictation can run in the backend while the renderer is throttled (fullscreen apps).
    // Keep a minimal copy of the relevant settings in the Tauri backend so it knows which provider/model
    // to use when triggered by the global shortcut.
    try {
      const isMac = /\bMac\b|\bDarwin\b/i.test(navigator.platform || navigator.userAgent || "");
      if (isMac) {
        const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";
        const model = localStorage.getItem("cloudTranscriptionModel") || "";
        const preferredLanguage = localStorage.getItem("preferredLanguage") || "auto";
        const activationMode = localStorage.getItem("activationMode") || "tap";
        const transcriptionPrompt = localStorage.getItem("transcriptionPrompt") || "";
        const muteSystemAudioWhileRecording =
          localStorage.getItem("muteSystemAudioWhileRecording") !== "false";

        void platform.settings.set("cloudTranscriptionProvider", provider);
        void platform.settings.set("cloudTranscriptionModel", model);
        void platform.settings.set("preferredLanguage", preferredLanguage);
        void platform.settings.set("activationMode", activationMode);
        void platform.settings.set("transcriptionPrompt", transcriptionPrompt);
        void platform.settings.set("muteSystemAudioWhileRecording", muteSystemAudioWhileRecording);
        void syncVocabularySettingsToBackend();
      }
    } catch {
      // ignore
    }

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing }) => {
        if (!isActiveToken(token)) return;
        if (isRecording || isProcessing) {
          void platform.window.show();
        }
        if (isRecording) {
          const sessionId = getCurrentSessionId("renderer");
          dispatchDictationSession({ type: "recording", sessionId });
          recordTimelineEvent(sessionId, {
            kind: "state",
            label: "recording.started",
            status: "started",
            phase: "recording",
            source: "renderer",
          });
          completionGuardRef.current = createDictationCompletionGuard();
          stopRequestedRef.current = false;
          setLiveTranscript("");
        }
        if (!isRecording && isProcessing) {
          const sessionId = getCurrentSessionId("renderer");
          dispatchDictationSession({ type: "transcribing", sessionId });
          recordTimelineEvent(sessionId, {
            kind: "state",
            label: "transcribing.started",
            status: "started",
            phase: "transcribing",
            source: "renderer",
          });
          stopRequestedRef.current = true;
          playRecordingStopSound(recordingFeedbackRef);
        }
        if (!isRecording) {
          setAudioLevel(0);
        }
      },
      onError: (error) => {
        if (!isActiveToken(token)) return;
        const sessionId = getCurrentSessionId("renderer");
        const message = error?.description || error?.title || String(error || "Unknown error");
        dispatchDictationSession({
          type: "failed",
          sessionId,
          error: message,
        });
        recordTimelineEvent(sessionId, {
          kind: "error",
          label: "renderer.error",
          status: "failed",
          phase: "failed",
          source: "renderer",
          detail: message,
        });
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
          const sessionId = getCurrentSessionId("renderer");
          recordTimelineEvent(sessionId, {
            kind: "transcription",
            label: "transcription.completed",
            status: "completed",
            source: result.source,
            durationMs: result.timings?.transcriptionProcessingDurationMs,
            meta: {
              outputTextLength: String(result.text || "").trim().length,
              reasoningProcessingDurationMs: result.timings?.reasoningProcessingDurationMs ?? null,
              processingMode: result.processingMode ?? null,
              usedReasoning: !!result.usedReasoning,
              fallbackReason: result.fallbackReason ?? null,
            },
          });
          dispatchDictationSession({ type: "postprocessing", sessionId });
          recordTimelineEvent(sessionId, {
            kind: "state",
            label: "postprocessing.completed",
            status: "completed",
            phase: "postprocessing",
            source: "renderer",
            meta: {
              stepCount: result.postProcessingSteps?.length ?? 0,
              processingMode: result.processingMode ?? null,
            },
          });
          recordPipelineSteps(sessionId, "postprocessing", result.postProcessingSteps, {
            source: result.source,
            processingMode: result.processingMode ?? null,
          });
          const completionResult = await runDictationCompletionPipeline({
            result,
            sessionId,
            guard: completionGuardRef.current,
            stopRequested: stopRequestedRef.current,
            ...getHistoryPrivacyOptions(),
            dispatchSession: dispatchDictationSession,
            setTranscript,
            setLiveTranscript,
            setAudioLevel,
            hideWindow: () => platform.window.hide(),
            pasteText: (text) => audioManagerRef.current?.safePaste(text) ?? Promise.resolve(false),
            saveTranscription: (text, options) =>
              audioManagerRef.current?.saveTranscription(text, options) ?? Promise.resolve(false),
          });
          recordPipelineSteps(sessionId, "completion", completionResult.steps, {
            source: result.source,
            status: completionResult.status,
          });
          if (completionResult.status === "failed") {
            recordTimelineEvent(sessionId, {
              kind: "error",
              label: "session.failed",
              status: "failed",
              phase: "failed",
              source: "renderer",
              detail: completionResult.error || "Completion pipeline failed",
              meta: {
                completionStatus: completionResult.status,
                outputTextLength: completionResult.normalizedText.length,
              },
            });
          } else {
            recordTimelineEvent(sessionId, {
              kind: "state",
              label: "session.completed",
              status: completionResult.status === "duplicate" ? "skipped" : "completed",
              phase: "completed",
              source: "renderer",
              meta: {
                completionStatus: completionResult.status,
                outputTextLength: completionResult.normalizedText.length,
              },
            });
          }
        } else {
          const sessionId = getCurrentSessionId("renderer");
          const message = result?.error || "Transcription failed";
          dispatchDictationSession({
            type: "failed",
            sessionId,
            error: message,
          });
          recordTimelineEvent(sessionId, {
            kind: "error",
            label: "transcription.failed",
            status: "failed",
            phase: "failed",
            source: result?.source || "renderer",
            detail: message,
          });
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
      getSessionId: getCurrentSessionId,
    });

    // Set up hotkey listener for tap-to-talk mode
    const handleToggle = async () => {
      if (!isActiveToken(token)) return;
      const manager = audioManagerRef.current;
      if (!manager) return;
      const currentState = manager.getState();

      if (!currentState.isRecording && !currentState.isProcessing && !currentState.isStarting) {
        // 开始录音：显示窗口 + 播放开始音
        const sessionId = beginSession("renderer");
        await syncForegroundApplicationVocabulary(sessionId, "renderer");
        stopRequestedRef.current = false;
        setLiveTranscript("");
        setAudioLevel(0);
        playRecordingStartSound(recordingFeedbackRef);
        manager.startRecording();
      } else if (currentState.isRecording || currentState.isStarting) {
        // 停止录音：播放停止音
        stopRequestedRef.current = true;
        manager.requestStop?.() || manager.stopRecording();
      } else if (currentState.isProcessing) {
        stopRequestedRef.current = true;
      }
    };

    // Set up listener for push-to-talk start
    const handleStart = async () => {
      if (!isActiveToken(token)) return;
      const manager = audioManagerRef.current;
      if (!manager) return;
      const currentState = manager.getState();
      if (!currentState.isRecording && !currentState.isProcessing && !currentState.isStarting) {
        // 开始录音：显示窗口 + 播放开始音
        const sessionId = beginSession("renderer");
        await syncForegroundApplicationVocabulary(sessionId, "renderer");
        stopRequestedRef.current = false;
        setLiveTranscript("");
        setAudioLevel(0);
        playRecordingStartSound(recordingFeedbackRef);
        manager.startRecording();
      }
    };

    // Set up listener for push-to-talk stop
    const handleStop = () => {
      if (!isActiveToken(token)) return;
      const manager = audioManagerRef.current;
      if (!manager) return;
      stopRequestedRef.current = true;
      const currentState = manager.getState();
      if (currentState.isRecording || currentState.isStarting) {
        // 停止录音：播放停止音
        manager.requestStop?.() || manager.stopRecording();
      }
    };

    // Tauri event listeners return Promise<unlisten>; legacy compatibility listeners may be sync.
    const toCleanup = (maybeUnlisten: PlatformListenerCleanup): ListenerCleanup | null => {
      if (!maybeUnlisten) return null;
      if (typeof maybeUnlisten === "function") {
        return { kind: "fn", fn: maybeUnlisten };
      }
      if (typeof (maybeUnlisten as Promise<() => void>).then === "function") {
        return { kind: "promise", promise: maybeUnlisten as Promise<() => void> };
      }
      return null;
    };

    const disposeToggle = toCleanup(
      platform.events.onToggleDictation(() => {
        const sessionId = currentSessionIdRef.current;
        if (sessionId) {
          recordTimelineEvent(sessionId, {
            kind: "input",
            label: "hotkey.toggle",
            status: "completed",
            source: "renderer",
          });
        }
        void handleToggle();
        onToggleRef.current?.();
      })
    );

    const disposeStart = toCleanup(
      platform.events.onStartDictation(() => {
        const sessionId = currentSessionIdRef.current;
        if (sessionId) {
          recordTimelineEvent(sessionId, {
            kind: "input",
            label: "hotkey.start",
            status: "completed",
            source: "renderer",
          });
        }
        void handleStart();
        onToggleRef.current?.();
      })
    );

    const disposeStop = toCleanup(
      platform.events.onStopDictation(() => {
        const sessionId = getCurrentSessionId("renderer");
        recordTimelineEvent(sessionId, {
          kind: "input",
          label: "hotkey.stop",
          status: "completed",
          source: "renderer",
        });
        handleStop();
        onToggleRef.current?.();
      })
    );

    const disposeBackendState = toCleanup(
      platform.events.onBackendDictationState((payload) => {
        if (!isActiveToken(token) || !payload?.sessionId) return;
        const event = {
          type: "backend-state",
          sessionId: payload.sessionId,
          phase: payload.phase,
          text: payload.text || "",
          error: payload.error || "",
        } as const;
        if (!canTransitionDictationSession(dictationSessionRef.current, event)) {
          return;
        }

        currentSessionIdRef.current = payload.sessionId;
        if (!readDictationTimelineSession(payload.sessionId)) {
          setDictationTimeline(createDictationTimelineSession(payload.sessionId, "backend"));
        }
        dispatchDictationSession(event);
        recordTimelineEvent(payload.sessionId, {
          kind: payload.phase === "failed" ? "error" : "backend",
          label: `backend.${payload.phase}`,
          status:
            payload.phase === "failed"
              ? "failed"
              : payload.phase === "completed"
                ? "completed"
                : payload.phase === "recording" || payload.phase === "transcribing"
                  ? "started"
                  : "info",
          phase: payload.phase,
          source: "backend",
          detail: payload.error || undefined,
          meta: {
            isRecording: !!payload.isRecording,
            isProcessing: !!payload.isProcessing,
            outputTextLength: String(payload.text || "").trim().length,
            processingMode: payload.processingMode ?? null,
            usedReasoning: payload.usedReasoning ?? null,
            fallbackReason: payload.fallbackReason ?? null,
          },
        });
        if (payload.timelineEvents?.length) {
          for (const timelineEvent of payload.timelineEvents) {
            recordTimelineEvent(payload.sessionId, {
              ...timelineEvent,
              source: timelineEvent.source || "backend",
            });
          }
        }
        if (payload.postProcessingSteps?.length) {
          recordPipelineSteps(
            payload.sessionId,
            "postprocessing",
            payload.postProcessingSteps as TranscriptionPipelineStep[],
            {
              source: "backend",
              processingMode: payload.processingMode ?? null,
              usedReasoning: payload.usedReasoning ?? null,
              fallbackReason: payload.fallbackReason ?? null,
              timings: payload.postProcessingTimings ?? null,
            }
          );
        }
        if (payload.phase === "recording") {
          setLiveTranscript("");
          setAudioLevel(0);
        }
        if (payload.phase === "completed") {
          const text = String(payload.text || "");
          setTranscript(text);
          setLiveTranscript(text);
          setAudioLevel(0);
        }
        if (payload.phase === "failed") {
          recordingFeedbackRef.current = false;
          setAudioLevel(0);
          toastRef.current?.({
            title: "Dictation Error",
            description: payload.error || "Unknown error",
            variant: "destructive",
          });
        }
      })
    );

    const disposeBackendStartFeedback = toCleanup(
      platform.events.onBackendDictationStartFeedback((payload) => {
        if (!isActiveToken(token)) return;
        const sessionId = prepareBackendSessionFeedback(payload);
        if (!sessionId) return;
        recordTimelineEvent(sessionId, {
          kind: "backend",
          label: "backend.start-feedback",
          status: "completed",
          source: "backend",
        });
        playRecordingStartSound(recordingFeedbackRef);
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

    const disposeNoAudio = toCleanup(platform.events.onNoAudioDetected(handleNoAudioDetected));

    // Cleanup
    return () => {
      // Ensure we actually unlisten even if the listener registration was async.
      const runCleanup = async (cleanup: ListenerCleanup | null): Promise<void> => {
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
      runCleanup(disposeBackendState);
      runCleanup(disposeBackendStartFeedback);
      runCleanup(disposeNoAudio);
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [
    beginSession,
    getCurrentSessionId,
    prepareBackendSessionFeedback,
    recordPipelineSteps,
    recordTimelineEvent,
    syncForegroundApplicationVocabulary,
    getHistoryPrivacyOptions,
  ]);

  const startRecording = async () => {
    if (audioManagerRef.current) {
      const sessionId = beginSession("renderer");
      recordTimelineEvent(sessionId, {
        kind: "input",
        label: "recording.start-requested",
        status: "started",
        source: "renderer",
      });
      await syncForegroundApplicationVocabulary(sessionId, "renderer");
      stopRequestedRef.current = false;
      return await audioManagerRef.current.startRecording();
    }
    return false;
  };

  const stopRecording = () => {
    if (audioManagerRef.current) {
      const sessionId = getCurrentSessionId("renderer");
      recordTimelineEvent(sessionId, {
        kind: "input",
        label: "recording.stop-requested",
        status: "completed",
        source: "renderer",
      });
      stopRequestedRef.current = true;
      return audioManagerRef.current.stopRecording();
    }
    return false;
  };

  const cancelRecording = () => {
    if (audioManagerRef.current) {
      stopRequestedRef.current = false;
      const sessionId = getCurrentSessionId("renderer");
      dispatchDictationSession({ type: "cancelled", sessionId });
      recordTimelineEvent(sessionId, {
        kind: "input",
        label: "recording.cancelled",
        status: "cancelled",
        phase: "idle",
        source: "renderer",
      });
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
      setLiveTranscript("");
      setAudioLevel(0);
      playRecordingStartSound(recordingFeedbackRef);
      startRecording();
    } else if (currentState.isRecording || currentState.isStarting) {
      // 停止录音：播放停止音
      stopRequestedRef.current = true;
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
    dictationPhase: dictationSession.phase,
    sessionId: dictationSession.sessionId,
    dictationTimeline,
    startRecording,
    stopRecording,
    cancelRecording,
    toggleListening,
  };
};
