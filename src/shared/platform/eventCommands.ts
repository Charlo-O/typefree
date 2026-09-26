import { hasTauriRuntime } from "./commandCore";
import type {
  BackendDictationStatePayload,
  BackendTimelineEvent,
  BackendDictationSessionPayload,
  ClipboardUpdatePayload,
  DictationPhase,
  DictationHotkeyPayload,
  HistoryPrunedPayload,
  OpenAIRealtimeTranscriptPayload,
  PlatformUnlisten,
  RecordingOverlayState,
  TranscriptEventPayload,
  TranscriptionItem,
  VolcengineStreamingTranscriptPayload,
  TranscriptEventMode,
} from "./types";

export type {
  BackendDictationStatePayload,
  BackendTimelineEvent,
  BackendDictationSessionPayload,
  DictationPhase,
  OpenAIRealtimeTranscriptPayload,
  RecordingOverlayState,
  TranscriptEventPayload,
  VolcengineStreamingTranscriptPayload,
} from "./types";

export const TRANSCRIPT_EVENT_NAME = "transcript-event";
export const VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME = "volcengine-streaming-transcript";
export const OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME = "openai-realtime-transcript";

export function createTranscriptEventFilter<T extends TranscriptEventPayload>(
  provider: string,
  mode: TranscriptEventMode,
  callback: (payload: T) => void
): (payload: TranscriptEventPayload) => void {
  return (payload) => {
    if (payload.provider === provider && payload.mode === mode) {
      callback(payload as T);
    }
  };
}

function normalizeRecordingOverlayState(value: unknown): RecordingOverlayState {
  const state = String(value || "idle").toLowerCase();
  if (state === "recording" || state === "transcribing" || state === "processing") {
    return state;
  }
  return "idle";
}

function normalizeDictationHotkeyPayload(value: unknown): DictationHotkeyPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const mode = (value as { processingMode?: unknown }).processingMode;
  return typeof mode === "string" && mode.trim() ? { processingMode: mode.trim() } : undefined;
}

export async function onToggleDictation(
  callback: (payload?: DictationHotkeyPayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("toggle-dictation", (event) =>
      callback(normalizeDictationHotkeyPayload(event.payload))
    );
  } catch (error) {
    console.warn("onToggleDictation failed:", error);
    return () => {};
  }
}

export async function onStartDictation(
  callback: (payload?: DictationHotkeyPayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("start-dictation", (event) =>
      callback(normalizeDictationHotkeyPayload(event.payload))
    );
  } catch (error) {
    console.warn("onStartDictation failed:", error);
    return () => {};
  }
}

export async function onStopDictation(
  callback: (payload?: DictationHotkeyPayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("stop-dictation", (event) =>
      callback(normalizeDictationHotkeyPayload(event.payload))
    );
  } catch (error) {
    console.warn("onStopDictation failed:", error);
    return () => {};
  }
}

export async function onShowOverlay(
  callback: (state: RecordingOverlayState) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("show-overlay", (event) => {
      callback(normalizeRecordingOverlayState(event.payload));
    });
  } catch (error) {
    console.warn("onShowOverlay failed:", error);
    return () => {};
  }
}

export async function onHideOverlay(callback: () => void): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("hide-overlay", () => callback());
  } catch (error) {
    console.warn("onHideOverlay failed:", error);
    return () => {};
  }
}

export async function onOpenClipboardPanel(callback: () => void): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("open-clipboard-panel", () => callback());
  } catch (error) {
    console.warn("onOpenClipboardPanel failed:", error);
    return () => {};
  }
}

export async function onOpenControlPanel(callback: () => void): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("open-control-panel", () => callback());
  } catch (error) {
    console.warn("onOpenControlPanel failed:", error);
    return () => {};
  }
}

export async function onClipboardUpdate(
  callback: (payload: ClipboardUpdatePayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("clipboard-update", (event) => {
      callback(event.payload as ClipboardUpdatePayload);
    });
  } catch (error) {
    console.warn("onClipboardUpdate failed:", error);
    return () => {};
  }
}

export async function onTranscriptEvent(
  callback: (payload: TranscriptEventPayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(TRANSCRIPT_EVENT_NAME, (event) => {
      callback(event.payload as TranscriptEventPayload);
    });
  } catch (error) {
    console.warn("onTranscriptEvent failed:", error);
    return () => {};
  }
}

export async function onVolcengineStreamingTranscript(
  callback: (payload: VolcengineStreamingTranscriptPayload) => void
): Promise<PlatformUnlisten> {
  return onTranscriptEvent(
    createTranscriptEventFilter<VolcengineStreamingTranscriptPayload>(
      "volcengine",
      "streaming",
      callback
    )
  );
}

export async function onOpenAIRealtimeTranscript(
  callback: (payload: OpenAIRealtimeTranscriptPayload) => void
): Promise<PlatformUnlisten> {
  return onTranscriptEvent(
    createTranscriptEventFilter<OpenAIRealtimeTranscriptPayload>("openai", "realtime", callback)
  );
}

export async function onTranscriptionAdded(
  callback: (transcription: TranscriptionItem) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("transcription-added", (event) => {
      callback(event.payload as TranscriptionItem);
    });
  } catch (error) {
    console.warn("onTranscriptionAdded failed:", error);
    return () => {};
  }
}

export async function onTranscriptionDeleted(
  callback: (data: { id: number }) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("transcription-deleted", (event) => {
      callback(event.payload as { id: number });
    });
  } catch (error) {
    console.warn("onTranscriptionDeleted failed:", error);
    return () => {};
  }
}

export async function onTranscriptionsCleared(callback: () => void): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("transcriptions-cleared", () => callback());
  } catch (error) {
    console.warn("onTranscriptionsCleared failed:", error);
    return () => {};
  }
}

export async function onTranscriptionsPruned(
  callback: (payload: HistoryPrunedPayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("transcriptions-pruned", (event) => {
      callback(event.payload as HistoryPrunedPayload);
    });
  } catch (error) {
    console.warn("onTranscriptionsPruned failed:", error);
    return () => {};
  }
}

export async function onBackendDictationState(
  callback: (payload: BackendDictationStatePayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-state", (event) => {
      const payload = (event as any).payload || {};
      const postProcessingSteps = Array.isArray(payload.postProcessingSteps)
        ? payload.postProcessingSteps.map((step: any) => ({
            name: String(step?.name || ""),
            status: String(step?.status || ""),
            detail: step?.detail == null ? undefined : String(step.detail),
            durationMs:
              step?.durationMs == null || Number.isNaN(Number(step.durationMs))
                ? undefined
                : Number(step.durationMs),
          }))
        : undefined;
      const timelineEvents = Array.isArray(payload.timelineEvents)
        ? payload.timelineEvents.map((event: any) => ({
            kind: String(event?.kind || "backend") as BackendTimelineEvent["kind"],
            label: String(event?.label || "backend.event"),
            status:
              event?.status == null
                ? undefined
                : (String(event.status) as BackendTimelineEvent["status"]),
            phase:
              event?.phase == null
                ? undefined
                : (String(event.phase) as BackendTimelineEvent["phase"]),
            source: event?.source == null ? undefined : String(event.source),
            durationMs:
              event?.durationMs == null || Number.isNaN(Number(event.durationMs))
                ? undefined
                : Number(event.durationMs),
            detail: event?.detail == null ? undefined : String(event.detail),
            meta:
              event?.meta && typeof event.meta === "object" && !Array.isArray(event.meta)
                ? (event.meta as Record<string, unknown>)
                : undefined,
          }))
        : undefined;
      callback({
        sessionId: String(payload.sessionId || ""),
        phase: String(payload.phase || "idle") as DictationPhase,
        isRecording: Boolean(payload.isRecording),
        isProcessing: Boolean(payload.isProcessing),
        text: payload.text == null ? null : String(payload.text),
        error: payload.error == null ? null : String(payload.error),
        timelineEvents,
        postProcessingSteps,
        postProcessingTimings:
          payload.postProcessingTimings && typeof payload.postProcessingTimings === "object"
            ? {
                vocabularyDurationMs:
                  payload.postProcessingTimings.vocabularyDurationMs == null
                    ? undefined
                    : Number(payload.postProcessingTimings.vocabularyDurationMs),
                promptBuildDurationMs:
                  payload.postProcessingTimings.promptBuildDurationMs == null
                    ? undefined
                    : Number(payload.postProcessingTimings.promptBuildDurationMs),
                reasoningDurationMs:
                  payload.postProcessingTimings.reasoningDurationMs == null
                    ? undefined
                    : Number(payload.postProcessingTimings.reasoningDurationMs),
              }
            : null,
        processingMode: payload.processingMode == null ? null : String(payload.processingMode),
        usedReasoning: payload.usedReasoning == null ? null : Boolean(payload.usedReasoning),
        fallbackReason: payload.fallbackReason == null ? null : String(payload.fallbackReason),
      });
    });
  } catch (error) {
    console.warn("onBackendDictationState failed:", error);
    return () => {};
  }
}

export async function onBackendDictationStartFeedback(
  callback: (payload: BackendDictationSessionPayload) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-start-feedback", (event) => {
      const payload = (event as any).payload || {};
      callback({
        sessionId: String(payload.sessionId || ""),
      });
    });
  } catch (error) {
    console.warn("onBackendDictationStartFeedback failed:", error);
    return () => {};
  }
}

export async function onBackendDictationRecording(
  callback: (isRecording: boolean) => void
): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-recording", (event) => {
      callback(Boolean(event.payload));
    });
  } catch (error) {
    console.warn("onBackendDictationRecording failed:", error);
    return () => {};
  }
}

export async function onBackendDictationError(callback: () => void): Promise<PlatformUnlisten> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-error", () => callback());
  } catch (error) {
    console.warn("onBackendDictationError failed:", error);
    return () => {};
  }
}
