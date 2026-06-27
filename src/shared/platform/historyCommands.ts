import {
  getErrorMessage,
  hasTauriRuntime,
  type ClearTranscriptionsResult,
  type CommandResult,
  unavailableInTauriBuild,
} from "./commandCore";
import type {
  BackendTimelineEvent,
  HistorySaveResult,
  PersistedDictationTimelineSession,
  SaveTranscriptionOptions,
  TranscriptionItem,
  TranscriptionOutput,
  TranscriptionSession,
} from "./types";

export async function saveTranscription(
  text: string,
  processed?: string,
  method?: string,
  agentName?: string,
  options: SaveTranscriptionOptions = {}
): Promise<HistorySaveResult> {
  if (!hasTauriRuntime()) {
    return {
      success: false,
      reason: "unavailable",
      error: unavailableInTauriBuild("Transcription history"),
    };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const id = await invoke<number>("db_save_transcription_record", {
      request: {
        text: options.rawText ?? text,
        processed: options.processedText ?? processed,
        method: options.method ?? method,
        agentName: options.agentName ?? agentName,
        sessionId: options.sessionId,
        provider: options.provider,
        model: options.model,
        language: options.language,
        status: options.status,
        error: options.error,
        outputs: options.outputs,
      },
    });
    if (id > 0) {
      return { success: true, id };
    }
    return {
      success: false,
      skipped: true,
      reason: "privacy",
      message: "Transcription history skipped by privacy settings",
    };
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn("saveTranscription failed:", message);
    return { success: false, reason: "command-error", error: message };
  }
}

export async function getTranscriptions(limit?: number): Promise<TranscriptionItem[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_get_transcriptions", { limit });
  } catch (error) {
    console.warn("getTranscriptions failed:", getErrorMessage(error));
    return [];
  }
}

export async function searchTranscriptions(
  query: string,
  limit?: number
): Promise<TranscriptionItem[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_search_transcriptions", { query, limit });
  } catch (error) {
    console.warn("searchTranscriptions failed:", getErrorMessage(error));
    return [];
  }
}

export async function getTranscriptionOutputs(
  transcriptionId: number
): Promise<TranscriptionOutput[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_get_transcription_outputs", { transcriptionId });
  } catch (error) {
    console.warn("getTranscriptionOutputs failed:", getErrorMessage(error));
    return [];
  }
}

export async function getTranscriptionSession(
  sessionId: string
): Promise<TranscriptionSession | null> {
  if (!hasTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_get_transcription_session", { sessionId });
  } catch (error) {
    console.warn("getTranscriptionSession failed:", getErrorMessage(error));
    return null;
  }
}

export async function saveDictationTimelineEvents(
  sessionId: string,
  source = "renderer",
  events: BackendTimelineEvent[] = []
): Promise<CommandResult> {
  if (!sessionId || events.length === 0) {
    return { success: true };
  }

  if (!hasTauriRuntime()) {
    return {
      success: false,
      error: unavailableInTauriBuild("Dictation timeline"),
    };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<number>("db_save_dictation_timeline_events", {
      sessionId,
      source,
      events,
    });
    return { success: true };
  } catch (error) {
    console.warn("saveDictationTimelineEvents failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getDictationTimelineSessions(
  limit?: number
): Promise<PersistedDictationTimelineSession[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_get_dictation_timeline_sessions", { limit });
  } catch (error) {
    console.warn("getDictationTimelineSessions failed:", getErrorMessage(error));
    return [];
  }
}

export async function deleteTranscription(id: number): Promise<CommandResult> {
  if (!hasTauriRuntime()) {
    return { success: false };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("db_delete_transcription", { id });
    return { success: true };
  } catch (error) {
    console.warn("deleteTranscription failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export const deleteTranscriptions = deleteTranscription;

export async function clearTranscriptions(): Promise<ClearTranscriptionsResult> {
  if (!hasTauriRuntime()) {
    return { success: true, cleared: 0 };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("db_clear_transcriptions");
    return { success: true };
  } catch (error) {
    console.warn("clearTranscriptions failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function pruneTranscriptionHistory(): Promise<{
  success: boolean;
  deleted: number;
  error?: string;
}> {
  if (!hasTauriRuntime()) {
    return { success: true, deleted: 0 };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const deleted = await invoke<number>("db_prune_transcription_history");
    return { success: true, deleted };
  } catch (error) {
    console.warn("pruneTranscriptionHistory failed:", error);
    return { success: false, deleted: 0, error: getErrorMessage(error) };
  }
}
