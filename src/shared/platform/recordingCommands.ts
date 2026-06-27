import { getErrorMessage, hasTauriRuntime, normalizeCommandError } from "./commandCore";
import type { NativeRecordingCapabilities, NativeRecordingResult } from "./types";

export async function startAudioDucking(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_audio_ducking");
    return true;
  } catch (error) {
    console.warn("startAudioDucking failed:", normalizeCommandError(error));
    return false;
  }
}

export async function stopAudioDucking(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_audio_ducking");
    return true;
  } catch (error) {
    console.warn("stopAudioDucking failed:", normalizeCommandError(error));
    return false;
  }
}

export async function getNativeRecordingCapabilities(): Promise<NativeRecordingCapabilities> {
  if (!hasTauriRuntime()) {
    return {
      supported: false,
      platform: "browser",
      backend: "browser-mediarecorder",
      status: "fallback",
      reason: "Tauri runtime not available",
      active: false,
    };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<NativeRecordingCapabilities>("get_native_recording_capabilities");
  } catch (error) {
    console.warn("getNativeRecordingCapabilities failed:", error);
    return {
      supported: false,
      platform: "unknown",
      backend: "unknown",
      status: "unavailable",
      reason: getErrorMessage(error),
      active: false,
    };
  }
}

export async function startNativeRecording(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_native_recording");
  } catch (error) {
    console.warn("startNativeRecording failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function stopNativeRecording(): Promise<NativeRecordingResult | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = (await invoke("stop_native_recording")) as any;

    const rawBytes = result?.audio_data || result?.audioData || [];
    const audioData = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);

    const mimeType = String(result?.mime_type || result?.mimeType || "audio/wav");
    const durationSeconds =
      typeof result?.duration_seconds === "number"
        ? result.duration_seconds
        : typeof result?.durationSeconds === "number"
          ? result.durationSeconds
          : null;

    return { audioData, mimeType, durationSeconds };
  } catch (error) {
    console.warn("stopNativeRecording failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function cancelNativeRecording(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("cancel_native_recording");
  } catch (error) {
    console.warn("cancelNativeRecording failed:", error);
    throw normalizeCommandError(error);
  }
}
