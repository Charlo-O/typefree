import { normalizeCommandError } from "./commandCore";
import type { TranscriptionProvider } from "./types";

export type LocalAsrRuntimeStatus = {
  available: boolean;
  runtime: string;
  modelReady: boolean;
  reason: string;
};

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

/**
 * Run the configured local ASR adapter.  This deliberately has its own
 * command instead of pretending that a local model is an OpenAI-compatible
 * cloud provider; GGUF, ONNX and sidecar runtimes have different contracts.
 */
export async function transcribeLocalAudio(
  audioData: Uint8Array,
  model?: string,
  language?: string,
  sessionId?: string | null
): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("local_asr_transcribe", {
      audioData: Array.from(audioData),
      model: model || null,
      language: language || null,
      sessionId: sessionId || null,
    });
  } catch (error) {
    console.warn("transcribeLocalAudio failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function checkLocalAsrRuntime(): Promise<LocalAsrRuntimeStatus> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("local_asr_check_runtime");
  } catch (error) {
    console.warn("checkLocalAsrRuntime failed:", error);
    throw normalizeCommandError(error);
  }
}

/**
 * Streaming local ASR session (currently the llama.cpp R2T2 runtime only).
 * Chunks are 16 kHz signed 16-bit little-endian PCM, mirroring the
 * Volcengine streaming contract so the same capture graph can feed both.
 */
export async function startLocalAsrStreamingTranscription(language?: string): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("local_asr_stream_start", {
      language: language || null,
    });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function sendLocalAsrStreamingAudio(
  sessionId: string,
  audioData: Uint8Array
): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("local_asr_stream_send", {
      sessionId,
      audioData: Array.from(audioData),
    });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function finishLocalAsrStreamingTranscription(sessionId: string): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("local_asr_stream_finish", { sessionId });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function cancelLocalAsrStreamingTranscription(sessionId: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("local_asr_stream_cancel", { sessionId });
  } catch (error) {
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
