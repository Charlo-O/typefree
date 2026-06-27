import { normalizeCommandError } from "./commandCore";
import type { TranscriptionProvider } from "./types";

export async function transcribeAudio(
  audioData: Uint8Array,
  provider: string,
  model?: string,
  language?: string,
  sessionId?: string | null,
  endpointOverride?: string | null
): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("transcribe_audio", {
      audioData: Array.from(audioData),
      provider,
      model,
      language,
      sessionId: sessionId || null,
      endpointOverride: endpointOverride || null,
    });
  } catch (error) {
    console.warn("transcribeAudio failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function startVolcengineStreamingTranscription(
  appId: string,
  accessToken: string,
  resourceId?: string,
  model?: string,
  language?: string
): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_volcengine_streaming_transcription", {
      appId,
      accessToken,
      resourceId: resourceId || null,
      model: model || null,
      language: language || null,
    });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function sendVolcengineStreamingAudio(
  sessionId: string,
  audioData: Uint8Array
): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("send_volcengine_streaming_audio", {
      sessionId,
      audioData: Array.from(audioData),
    });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function finishVolcengineStreamingTranscription(sessionId: string): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("finish_volcengine_streaming_transcription", { sessionId });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function cancelVolcengineStreamingTranscription(sessionId: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("cancel_volcengine_streaming_transcription", { sessionId });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function startOpenAIRealtimeTranscription(
  apiKey: string,
  model?: string,
  language?: string,
  delay?: string
): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_openai_realtime_transcription", {
      apiKey,
      model: model || null,
      language: language || null,
      delay: delay || null,
    });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function sendOpenAIRealtimeAudio(
  sessionId: string,
  audioData: Uint8Array
): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("send_openai_realtime_audio", {
      sessionId,
      audioData: Array.from(audioData),
    });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function finishOpenAIRealtimeTranscription(sessionId: string): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("finish_openai_realtime_transcription", { sessionId });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function cancelOpenAIRealtimeTranscription(sessionId: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("cancel_openai_realtime_transcription", { sessionId });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function getTranscriptionProviders(): Promise<TranscriptionProvider[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_transcription_providers");
  } catch (error) {
    console.warn("getTranscriptionProviders failed:", error);
    return [];
  }
}
