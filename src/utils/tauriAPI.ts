/**
 * Tauri API Bridge
 *
 * This module provides a bridge between the frontend and Tauri backend,
 * replacing the Electron preload script (window.electronAPI).
 *
 * All functions use Tauri's invoke() to call Rust commands.
 */

// ============================================================================
// Types
// ============================================================================

export interface Transcription {
  id: number;
  timestamp: string;
  original_text: string;
  processed_text: string | null;
  is_processed: boolean;
  processing_method: string;
  agent_name: string | null;
  error: string | null;
}

export interface TranscriptionProvider {
  id: string;
  name: string;
  requires_key: boolean;
}

export interface PasteToolsResult {
  platform: "darwin" | "win32" | "linux";
  available: boolean;
  method: string | null;
  requiresPermission: boolean;
  isWayland?: boolean;
  xwaylandAvailable?: boolean;
  tools?: string[];
  recommendedInstall?: string;
}

type CommandResult = {
  success: boolean;
  error?: string;
  message?: string;
};

type ClearTranscriptionsResult = CommandResult & {
  cleared?: number;
};

type DebugState = {
  enabled: boolean;
  logPath: string | null;
  logLevel: string;
};

type DebugLoggingResult = CommandResult & {
  enabled?: boolean;
  logPath?: string | null;
};

type UpdateCheckResult = {
  updateAvailable: boolean;
  version?: string;
  releaseDate?: string;
  files?: any[];
  releaseNotes?: string;
  message?: string;
};

type UpdateStatusResult = {
  updateAvailable: boolean;
  updateDownloaded: boolean;
  isDevelopment: boolean;
};

type UpdateInfoResult = {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  files?: any[];
};

const unavailableInTauriBuild = (feature: string) =>
  `${feature} is not available in this Tauri build`;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ============================================================================
// Clipboard Functions
// ============================================================================

export async function pasteText(text: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("paste_text", { text });
  } catch (error) {
    console.warn("pasteText failed:", error);
    throw error;
  }
}

export async function pasteImage(dataUrl: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("paste_image", { dataUrl });
  } catch (error) {
    console.warn("pasteImage failed:", error);
    throw error;
  }
}

export async function readClipboard(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("read_clipboard");
  } catch (error) {
    console.warn("readClipboard failed:", error);
    return "";
  }
}

export async function writeClipboard(text: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("write_clipboard", { text });
  } catch (error) {
    console.warn("writeClipboard failed:", error);
  }
}

export async function writeClipboardImage(dataUrl: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("write_clipboard_image", { dataUrl });
  } catch (error) {
    console.warn("writeClipboardImage failed:", error);
  }
}

export async function checkPasteTools(): Promise<PasteToolsResult | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("check_paste_tools");
  } catch (error) {
    console.warn("checkPasteTools failed:", error);
    return null;
  }
}

export async function checkAccessibilityPermission(prompt = false): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("check_accessibility_permission", { prompt });
  } catch (error) {
    console.warn("checkAccessibilityPermission failed:", error);
    return false;
  }
}

// ============================================================================
// Database Functions
// ============================================================================

export async function saveTranscription(
  text: string,
  processed?: string,
  method?: string,
  agentName?: string
): Promise<number> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_save_transcription", {
      text,
      processed,
      method,
      agentName,
    });
  } catch (error) {
    console.warn("saveTranscription failed:", error);
    return 0;
  }
}

export async function getTranscriptions(limit?: number): Promise<Transcription[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_get_transcriptions", { limit });
  } catch (error) {
    console.warn("getTranscriptions failed:", error);
    return [];
  }
}

export async function deleteTranscription(id: number): Promise<CommandResult> {
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
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("db_clear_transcriptions");
    return { success: true };
  } catch (error) {
    console.warn("clearTranscriptions failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

// ============================================================================
// Transcription Functions
// ============================================================================

export async function transcribeAudio(
  audioData: Uint8Array,
  provider: string,
  model?: string,
  language?: string
): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("transcribe_audio", {
      audioData: Array.from(audioData),
      provider,
      model,
      language,
    });
  } catch (error) {
    console.warn("transcribeAudio failed:", error);
    return "";
  }
}

export async function startVolcengineStreamingTranscription(
  appId: string,
  accessToken: string,
  resourceId?: string,
  model?: string,
  language?: string
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("start_volcengine_streaming_transcription", {
    appId,
    accessToken,
    resourceId: resourceId || null,
    model: model || null,
    language: language || null,
  });
}

export async function sendVolcengineStreamingAudio(
  sessionId: string,
  audioData: Uint8Array
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("send_volcengine_streaming_audio", {
    sessionId,
    audioData: Array.from(audioData),
  });
}

export async function finishVolcengineStreamingTranscription(sessionId: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("finish_volcengine_streaming_transcription", { sessionId });
}

export async function cancelVolcengineStreamingTranscription(sessionId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("cancel_volcengine_streaming_transcription", { sessionId });
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

// ============================================================================
// System Audio Ducking
// ============================================================================

export async function startAudioDucking(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_audio_ducking");
    return true;
  } catch (error) {
    console.warn("startAudioDucking failed:", error);
    return false;
  }
}

export async function stopAudioDucking(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_audio_ducking");
    return true;
  } catch (error) {
    console.warn("stopAudioDucking failed:", error);
    return false;
  }
}

// ============================================================================
// Native Recording (macOS)
// ============================================================================

export type NativeRecordingResult = {
  audioData: Uint8Array;
  mimeType: string;
  durationSeconds: number | null;
};

export async function startNativeRecording(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_native_recording");
  } catch (error) {
    console.warn("startNativeRecording failed:", error);
    return false;
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
    return null;
  }
}

export async function cancelNativeRecording(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("cancel_native_recording");
  } catch (error) {
    console.warn("cancelNativeRecording failed:", error);
    return false;
  }
}

// ============================================================================
// Settings Functions
// ============================================================================

export async function getSetting<T>(key: string): Promise<T | null> {
  if (!hasTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_setting", { key });
  } catch (error) {
    console.warn("getSetting failed:", error);
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_setting", { key, value });
  } catch (error) {
    console.warn("setSetting failed:", error);
  }
}

export async function getEnvVar(key: string): Promise<string | null> {
  if (!hasTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_env_var", { key });
  } catch (error) {
    console.warn("getEnvVar failed:", error);
    return null;
  }
}

export async function setEnvVar(key: string, value: string): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_env_var", { key, value });
  } catch (error) {
    console.warn("setEnvVar failed:", error);
  }
}

// =========================================================================
// Logging
// =========================================================================

type RendererLogPayload = {
  level: string;
  message: string;
  meta?: any;
  scope?: string;
  source?: string;
};

export async function log(payload: RendererLogPayload): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_renderer_log", {
      entry: {
        ...payload,
        message: String(payload.message),
        source: payload.source || "renderer",
      },
    });
  } catch (error) {
    // Fall back to console if logging command isn't available.
    console.log(
      `[${payload.level?.toUpperCase?.() || "INFO"}]${payload.scope ? `[${payload.scope}]` : ""} ${payload.message}`,
      payload.meta
    );
  }
}

export async function getLogLevel(): Promise<string> {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("logLevel") || "";
      if (stored.trim()) return stored.trim();
    }
  } catch {
    // ignore
  }

  try {
    const stored = await getSetting<string>("logLevel");
    if (typeof stored === "string" && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // ignore
  }

  // Default to debug in dev to make diagnosis easy.
  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env?.DEV) {
      return "debug";
    }
  } catch {
    // ignore
  }
  return "info";
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_all_settings");
  } catch (error) {
    console.warn("getAllSettings failed:", error);
    return {};
  }
}

export async function getDebugState(): Promise<DebugState> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const state = (await invoke("get_debug_state")) as DebugState;
    return {
      enabled: Boolean(state.enabled),
      logPath: state.logPath ?? null,
      logLevel: state.logLevel || "info",
    };
  } catch (error) {
    console.warn("getDebugState failed:", error);
    const level = await getLogLevel();
    return { enabled: level === "debug" || level === "trace", logPath: null, logLevel: level };
  }
}

export async function setDebugLogging(enabled: boolean): Promise<DebugLoggingResult> {
  const logLevel = enabled ? "debug" : "info";

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("logLevel", logLevel);
    }
  } catch {
    // ignore localStorage failures
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = (await invoke("set_debug_logging", { enabled })) as DebugLoggingResult;
    return {
      success: result.success !== false,
      enabled: result.enabled ?? enabled,
      logPath: result.logPath ?? null,
      error: result.error,
    };
  } catch (error) {
    console.warn("setDebugLogging failed:", error);
    await setSetting("logLevel", logLevel);
    return { success: true, enabled, logPath: null };
  }
}

export async function openLogsFolder(): Promise<CommandResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_logs_folder");
    return { success: true };
  } catch (error) {
    console.warn("openLogsFolder failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

// API Key helpers
export async function getOpenAIKey(): Promise<string | null> {
  return getEnvVar("OPENAI_API_KEY");
}

export async function saveOpenAIKey(key: string): Promise<void> {
  return setEnvVar("OPENAI_API_KEY", key);
}

export async function getAssemblyAIKey(): Promise<string | null> {
  return getEnvVar("ASSEMBLYAI_API_KEY");
}

export async function saveAssemblyAIKey(key: string): Promise<void> {
  return setEnvVar("ASSEMBLYAI_API_KEY", key);
}

export async function getAnthropicKey(): Promise<string | null> {
  return getEnvVar("ANTHROPIC_API_KEY");
}

export async function saveAnthropicKey(key: string): Promise<void> {
  return setEnvVar("ANTHROPIC_API_KEY", key);
}

export async function getGeminiKey(): Promise<string | null> {
  return getEnvVar("GEMINI_API_KEY");
}

export async function saveGeminiKey(key: string): Promise<void> {
  return setEnvVar("GEMINI_API_KEY", key);
}

export async function getGroqKey(): Promise<string | null> {
  return getEnvVar("GROQ_API_KEY");
}

export async function saveGroqKey(key: string): Promise<void> {
  return setEnvVar("GROQ_API_KEY", key);
}

export async function getZaiKey(): Promise<string | null> {
  return getEnvVar("ZAI_API_KEY");
}

export async function saveZaiKey(key: string): Promise<void> {
  return setEnvVar("ZAI_API_KEY", key);
}

// Volcengine (豆包) credentials
export async function getVolcengineAppId(): Promise<string | null> {
  return getEnvVar("VOLCENGINE_APP_ID");
}
export async function saveVolcengineAppId(value: string): Promise<void> {
  return setEnvVar("VOLCENGINE_APP_ID", value);
}
export async function getVolcengineAccessToken(): Promise<string | null> {
  return getEnvVar("VOLCENGINE_ACCESS_TOKEN");
}
export async function saveVolcengineAccessToken(value: string): Promise<void> {
  return setEnvVar("VOLCENGINE_ACCESS_TOKEN", value);
}
export async function getVolcengineResourceId(): Promise<string | null> {
  return getEnvVar("VOLCENGINE_RESOURCE_ID");
}
export async function saveVolcengineResourceId(value: string): Promise<void> {
  return setEnvVar("VOLCENGINE_RESOURCE_ID", value);
}

// =========================================================================
// Reasoning (Cloud / Local)
// =========================================================================

export async function processAnthropicReasoning(
  text: string,
  modelId: string,
  agentName: string | null,
  config: any
): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const apiKey = await getAnthropicKey();
    if (!apiKey) {
      return { success: false, error: "Anthropic API key not configured" };
    }

    const { getSystemPrompt } = await import("../config/prompts");
    const systemPrompt = getSystemPrompt(agentName, config?.promptContext || null);

    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("process_anthropic_reasoning", {
      apiKey,
      model: modelId,
      systemPrompt,
      text,
      maxTokens: config?.maxTokens,
      temperature: config?.temperature,
    });

    return result as any;
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}

export async function checkLocalReasoningAvailable(): Promise<boolean> {
  // Not implemented in Tauri build yet.
  return false;
}

export async function processLocalReasoning(
  _text: string,
  _modelId: string,
  _agentName: string | null,
  _config: any
): Promise<{ success: boolean; text?: string; error?: string }> {
  return { success: false, error: "Local reasoning is not available in this build" };
}

// ============================================================================
// Window Functions
// ============================================================================

export async function showDictationPanel(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("show_dictation_panel");
  } catch (error) {
    console.warn("showDictationPanel failed:", error);
  }
}

export async function showControlPanel(): Promise<void> {
  console.log("showControlPanel called");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    console.log("Invoking show_control_panel...");
    await invoke("show_control_panel");
    console.log("show_control_panel invoked successfully");
  } catch (error) {
    console.error("Error invoking show_control_panel:", error);
  }
}

export async function hideWindow(): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hide_window");
  } catch (error) {
    console.warn("hideWindow failed:", error);
  }
}

export async function showWindow(): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_window");
  } catch (error) {
    console.warn("showWindow failed:", error);
  }
}

export async function startWindowDrag(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_drag");
  } catch (error) {
    console.warn("startWindowDrag failed:", error);
  }
}

export async function stopWindowDrag(): Promise<void> {
  // No-op for Tauri - drag ends when mouse is released
}

export async function getPlatform(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_platform");
  } catch (error) {
    console.warn("getPlatform failed:", error);
    return "unknown";
  }
}

export async function windowMinimize(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    return win.minimize();
  } catch (error) {
    console.warn("windowMinimize failed:", error);
  }
}

export async function windowMaximize(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    return win.toggleMaximize();
  } catch (error) {
    console.warn("windowMaximize failed:", error);
  }
}

export async function windowClose(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    return win.close();
  } catch (error) {
    console.warn("windowClose failed:", error);
  }
}

export async function windowIsMaximized(): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    return win.isMaximized();
  } catch (error) {
    console.warn("windowIsMaximized failed:", error);
    return false;
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

type UnlistenFn = () => void;

export type VolcengineStreamingTranscriptPayload = {
  sessionId: string;
  text: string;
  isFinal: boolean;
  audioMs?: number | null;
  definite?: boolean;
};

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  // Tauri injects globals into the webview. Depending on version/build, the public
  // `__TAURI__` may not exist, but internals do.
  const w = window as any;
  if (typeof w.__TAURI_INTERNALS__ !== "undefined") {
    return true;
  }
  if (typeof w.__TAURI__ !== "undefined") {
    return true;
  }

  // Fallback heuristic (covers some webview user agents).
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  return /\bTauri\b/i.test(ua);
}

export async function onToggleDictation(callback: () => void): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("toggle-dictation", () => callback());
  } catch (error) {
    console.warn("onToggleDictation failed:", error);
    return () => {};
  }
}

export async function onStartDictation(callback: () => void): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("start-dictation", () => callback());
  } catch (error) {
    console.warn("onStartDictation failed:", error);
    return () => {};
  }
}

export async function onStopDictation(callback: () => void): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("stop-dictation", () => callback());
  } catch (error) {
    console.warn("onStopDictation failed:", error);
    return () => {};
  }
}

export async function onVolcengineStreamingTranscript(
  callback: (payload: VolcengineStreamingTranscriptPayload) => void
): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("volcengine-streaming-transcript", (event) => {
      callback(event.payload as VolcengineStreamingTranscriptPayload);
    });
  } catch (error) {
    console.warn("onVolcengineStreamingTranscript failed:", error);
    return () => {};
  }
}

export async function onTranscriptionAdded(
  callback: (transcription: Transcription) => void
): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("transcription-added", (event) => {
      callback(event.payload as Transcription);
    });
  } catch (error) {
    console.warn("onTranscriptionAdded failed:", error);
    return () => {};
  }
}

export async function onTranscriptionDeleted(
  callback: (data: { id: number }) => void
): Promise<UnlistenFn> {
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

export async function onTranscriptionsCleared(callback: () => void): Promise<UnlistenFn> {
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

export async function onBackendDictationError(
  callback: (error: string) => void
): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-error", (event) => {
      callback(String((event as any).payload ?? ""));
    });
  } catch (error) {
    console.warn("onBackendDictationError failed:", error);
    return () => {};
  }
}

export async function onBackendDictationShowWindow(callback: () => void): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-show-window", () => callback());
  } catch (error) {
    console.warn("onBackendDictationShowWindow failed:", error);
    return () => {};
  }
}

export async function onBackendDictationRecording(
  callback: (isRecording: boolean) => void
): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-recording", (event) => {
      callback(Boolean((event as any).payload));
    });
  } catch (error) {
    console.warn("onBackendDictationRecording failed:", error);
    return () => {};
  }
}

export async function onBackendDictationProcessing(
  callback: (isProcessing: boolean) => void
): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-processing", (event) => {
      callback(Boolean((event as any).payload));
    });
  } catch (error) {
    console.warn("onBackendDictationProcessing failed:", error);
    return () => {};
  }
}

export async function onBackendDictationResult(
  callback: (text: string) => void
): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("backend-dictation-result", (event) => {
      callback(String((event as any).payload ?? ""));
    });
  } catch (error) {
    console.warn("onBackendDictationResult failed:", error);
    return () => {};
  }
}

// ============================================================================
// App Control
// ============================================================================

export async function appQuit(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.close();
  } catch (error) {
    console.warn("appQuit failed:", error);
  }
}

// External URL opener
export async function openExternal(url: string): Promise<CommandResult> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return { success: true };
  } catch (error) {
    console.warn("openExternal failed, falling back to window.open:", error);
    try {
      window.open(url, "_blank");
      return { success: true };
    } catch (fallbackError) {
      return { success: false, error: getErrorMessage(fallbackError) };
    }
  }
}

type OpenSettingsResult = { success: boolean; error?: string };

export async function openMicrophoneSettings(): Promise<OpenSettingsResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_microphone_settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function openSoundInputSettings(): Promise<OpenSettingsResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_sound_input_settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function openAccessibilitySettings(): Promise<OpenSettingsResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_accessibility_settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// =========================================================================
// Updater compatibility
// =========================================================================

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return {
    updateAvailable: false,
    message: unavailableInTauriBuild("Automatic updates"),
  };
}

export async function downloadUpdate(): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: unavailableInTauriBuild("Automatic updates"),
  };
}

export async function installUpdate(): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: unavailableInTauriBuild("Automatic updates"),
  };
}

export async function getAppVersion(): Promise<{ version: string }> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return { version: await getVersion() };
  } catch {
    return { version: "" };
  }
}

export async function getUpdateStatus(): Promise<UpdateStatusResult> {
  let isDevelopment = false;
  try {
    isDevelopment = Boolean((import.meta as any).env?.DEV);
  } catch {
    // ignore
  }

  return {
    updateAvailable: false,
    updateDownloaded: false,
    isDevelopment,
  };
}

export async function getUpdateInfo(): Promise<UpdateInfoResult | null> {
  return null;
}

const noopUnlisten = () => {};

export function onUpdateAvailable(_callback: (event: any, info: any) => void): UnlistenFn {
  return noopUnlisten;
}

export function onUpdateNotAvailable(_callback: (event: any, info: any) => void): UnlistenFn {
  return noopUnlisten;
}

export function onUpdateDownloaded(_callback: (event: any, info: any) => void): UnlistenFn {
  return noopUnlisten;
}

export function onUpdateDownloadProgress(
  _callback: (event: any, progressObj: any) => void
): UnlistenFn {
  return noopUnlisten;
}

export function onUpdateError(_callback: (event: any, error: any) => void): UnlistenFn {
  return noopUnlisten;
}

type HotkeyRegistrationStatus = {
  success: boolean;
  message?: string | null;
};

type DictationTriggerMode = "single" | "double";

type HotkeyRegistrationResult = {
  dictation?: HotkeyRegistrationStatus;
  clipboard?: HotkeyRegistrationStatus;
};

function readStoredHotkey(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  const value = window.localStorage.getItem(key)?.trim();
  return value ? value : null;
}

function toHotkeyResult(status?: HotkeyRegistrationStatus): {
  success: boolean;
  message?: string;
} {
  if (!status) {
    return { success: false, message: "Missing registration status" };
  }

  if (status.message) {
    return { success: status.success, message: status.message };
  }

  return {
    success: status.success,
    message: status.success ? "ok" : "registration returned false",
  };
}

async function invokeHotkeyRegistration(
  dictationHotkey?: string | null,
  clipboardHotkey?: string | null,
  dictationTriggerMode?: DictationTriggerMode | null
): Promise<HotkeyRegistrationResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("register_hotkeys", {
    dictationHotkey: dictationHotkey || null,
    clipboardHotkey: clipboardHotkey || null,
    dictationTriggerMode: dictationTriggerMode || "single",
  });
}

export async function updateHotkey(
  hotkey: string
): Promise<{ success: boolean; message?: string }> {
  console.log("updateHotkey called with:", hotkey);
  try {
    const result = await invokeHotkeyRegistration(
      hotkey,
      readStoredHotkey("clipboardHotkey"),
      (readStoredHotkey("dictationTriggerMode") as DictationTriggerMode | null) || "single"
    );
    const status = toHotkeyResult(result.dictation);
    console.log("Dictation hotkey registered:", status);
    return status;
  } catch (error) {
    console.error("Failed to register hotkey:", error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

export async function updateClipboardHotkey(
  hotkey: string
): Promise<{ success: boolean; message?: string }> {
  console.log("updateClipboardHotkey called with:", hotkey);
  try {
    const result = await invokeHotkeyRegistration(
      readStoredHotkey("dictationKey"),
      hotkey,
      (readStoredHotkey("dictationTriggerMode") as DictationTriggerMode | null) || "single"
    );
    const status = toHotkeyResult(result.clipboard);
    console.log("Clipboard hotkey registered:", status);
    return status;
  } catch (error) {
    console.error("Failed to register clipboard hotkey:", error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

export async function updateDictationTriggerMode(
  mode: DictationTriggerMode
): Promise<{ success: boolean; message?: string }> {
  console.log("updateDictationTriggerMode called with:", mode);
  try {
    const result = await invokeHotkeyRegistration(
      readStoredHotkey("dictationKey"),
      readStoredHotkey("clipboardHotkey"),
      mode
    );
    const status = toHotkeyResult(result.dictation);
    console.log("Dictation trigger mode updated:", status);
    return status;
  } catch (error) {
    console.error("Failed to update dictation trigger mode:", error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

export async function setHotkeyListeningMode(enabled: boolean): Promise<void> {
  // TODO: Implement hotkey listening mode
  console.log("setHotkeyListeningMode:", enabled);
}

export async function setMainWindowInteractivity(interactive: boolean): Promise<void> {
  // TODO: Implement window interactivity toggle
  void interactive;
}

// =========================================================================
// Autostart (Launch at Startup)
// =========================================================================

export async function getAutoStartEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return await isEnabled();
  } catch (error) {
    console.warn("getAutoStartEnabled failed:", error);
    return false;
  }
}

export async function setAutoStartEnabled(enabled: boolean): Promise<{ success: boolean }> {
  try {
    const { enable, disable } = await import("@tauri-apps/plugin-autostart");
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
    return { success: true };
  } catch (error) {
    console.error("setAutoStartEnabled failed:", error);
    return { success: false };
  }
}

export async function saveAllKeysToEnv(): Promise<CommandResult> {
  // Keys are already saved individually via setEnvVar.
  return { success: true };
}

// =========================================================================
// Local model compatibility
// =========================================================================

export async function modelGetAll(): Promise<any[]> {
  return [];
}

export async function modelCheck(_modelId: string): Promise<boolean> {
  return false;
}

export async function modelDownload(_modelId: string): Promise<CommandResult> {
  return {
    success: false,
    error: unavailableInTauriBuild("Local model downloads"),
  };
}

export async function modelDelete(_modelId: string): Promise<void> {
  throw new Error(unavailableInTauriBuild("Local model deletion"));
}

export async function modelDeleteAll(): Promise<CommandResult> {
  return {
    success: false,
    error: unavailableInTauriBuild("Local model deletion"),
  };
}

export async function modelCheckRuntime(): Promise<boolean> {
  return false;
}

export async function modelCancelDownload(_modelId: string): Promise<CommandResult> {
  return {
    success: false,
    error: unavailableInTauriBuild("Local model downloads"),
  };
}

export function onModelDownloadProgress(_callback: (event: any, data: any) => void): UnlistenFn {
  return noopUnlisten;
}

export async function cleanupApp(): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: unavailableInTauriBuild("Application data cleanup"),
  };
}

// ============================================================================
// Compatibility Layer
// ============================================================================

/**
 * This object provides backward compatibility with the Electron API.
 * Components using window.electronAPI can use this without modification.
 */
export const electronAPICompat = {
  // Logging
  log,
  getLogLevel,

  // Clipboard
  pasteText,
  pasteImage,
  readClipboard,
  writeClipboard,
  writeClipboardImage,
  checkPasteTools,
  checkAccessibilityPermission,

  // Database
  saveTranscription,
  getTranscriptions,
  deleteTranscription,
  deleteTranscriptions,
  clearTranscriptions,

  // Transcription
  transcribeAudio,
  startVolcengineStreamingTranscription,
  sendVolcengineStreamingAudio,
  finishVolcengineStreamingTranscription,
  cancelVolcengineStreamingTranscription,
  getTranscriptionProviders,

  // Native Recording (macOS)
  startNativeRecording,
  stopNativeRecording,
  cancelNativeRecording,

  // System Audio Ducking
  startAudioDucking,
  stopAudioDucking,

  // Settings
  getSetting,
  setSetting,
  getEnvVar,
  setEnvVar,
  getAllSettings,
  getDebugState,
  setDebugLogging,
  openLogsFolder,
  getAssemblyAIKey,
  getOpenAIKey,
  saveAssemblyAIKey,
  saveOpenAIKey,
  getAnthropicKey,
  saveAnthropicKey,
  getGeminiKey,
  saveGeminiKey,
  getGroqKey,
  saveGroqKey,
  getZaiKey,
  saveZaiKey,
  getVolcengineAppId,
  saveVolcengineAppId,
  getVolcengineAccessToken,
  saveVolcengineAccessToken,
  getVolcengineResourceId,
  saveVolcengineResourceId,

  // Window
  showDictationPanel,
  showControlPanel,
  hideWindow,
  showWindow,
  startWindowDrag,
  stopWindowDrag,
  getPlatform,
  windowMinimize,
  windowMaximize,
  windowClose,
  windowIsMaximized,

  // Events
  onToggleDictation,
  onStartDictation,
  onStopDictation,
  onVolcengineStreamingTranscript,
  onTranscriptionAdded,
  onTranscriptionDeleted,
  onTranscriptionsCleared,
  onBackendDictationError,
  onBackendDictationShowWindow,
  onBackendDictationRecording,
  onBackendDictationProcessing,
  onBackendDictationResult,

  // App
  appQuit,
  openExternal,
  openMicrophoneSettings,
  openSoundInputSettings,
  openAccessibilitySettings,

  // Updater
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getAppVersion,
  getUpdateStatus,
  getUpdateInfo,
  onUpdateAvailable,
  onUpdateNotAvailable,
  onUpdateDownloaded,
  onUpdateDownloadProgress,
  onUpdateError,

  // Autostart
  getAutoStartEnabled,
  setAutoStartEnabled,

  // Hotkey
  updateHotkey,
  updateClipboardHotkey,
  updateDictationTriggerMode,
  setHotkeyListeningMode,
  setMainWindowInteractivity,
  saveAllKeysToEnv,
  cleanupApp,

  // Stub for missing functions
  onHotkeyFallbackUsed: (callback: any) => () => {},
  onHotkeyRegistrationFailed: (callback: any) => () => {},
  onGlobeKeyPressed: (callback: any) => () => {},
  modelGetAll,
  modelCheck,
  modelDownload,
  modelDelete,
  modelDeleteAll,
  modelCheckRuntime,
  modelCancelDownload,
  onModelDownloadProgress,
  processLocalReasoning,
  checkLocalReasoningAvailable,
  processAnthropicReasoning,
};

// Make available on window.electronAPI for backward compatibility
if (typeof window !== "undefined") {
  (window as any).electronAPI = electronAPICompat;
  (window as any).tauriAPI = electronAPICompat;

  // One-time marker so we can verify log forwarding works.
  // This ends up in both the persisted renderer log file and `tauri:dev` output.
  try {
    const w = window as any;
    if (!w.__TYPEFREE_LOG_BRIDGE_INIT__) {
      w.__TYPEFREE_LOG_BRIDGE_INIT__ = true;
      void log({
        level: "debug",
        message: "Renderer log bridge initialized",
        meta: { href: window.location.href },
        scope: "logging",
        source: "renderer",
      });
    }
  } catch {
    // ignore
  }

  // Keep a minimal copy of dictation settings in the backend for the macOS "backend dictation"
  // pipeline (global hotkey -> record -> transcribe -> paste), which can run while the renderer
  // is throttled by fullscreen apps.
  //
  // This used to live in `useAudioRecording`, but the main window may render a minimal overlay UI
  // that doesn't mount that hook.
  try {
    const w = window as any;
    if (!w.__TYPEFREE_DICTATION_SETTINGS_SYNC__) {
      w.__TYPEFREE_DICTATION_SETTINGS_SYNC__ = true;
      void (async () => {
        try {
          if (!hasTauriRuntime()) return;

          const activationMode = localStorage.getItem("activationMode") || "tap";
          const processingModeId = localStorage.getItem("processingModeId") || "voice-polish";
          const useReasoningModel = localStorage.getItem("useReasoningModel") !== "false";
          const reasoningProvider = localStorage.getItem("reasoningProvider") || "auto";
          const reasoningModel = localStorage.getItem("reasoningModel") || "";
          const cloudReasoningBaseUrl = localStorage.getItem("cloudReasoningBaseUrl") || "";
          const recordingOverlayVisualStyle =
            localStorage.getItem("recordingOverlayVisualStyle") || "timeline";
          await setSetting("activationMode", activationMode);
          await setSetting("processingModeId", processingModeId);
          await setSetting("useReasoningModel", useReasoningModel);
          await setSetting("reasoningProvider", reasoningProvider);
          await setSetting("reasoningModel", reasoningModel);
          await setSetting("cloudReasoningBaseUrl", cloudReasoningBaseUrl);
          await setSetting("recordingOverlayVisualStyle", recordingOverlayVisualStyle);

          const isMac = /\bMac\b|\bDarwin\b/i.test(navigator.platform || navigator.userAgent || "");
          if (!isMac) return;

          const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";
          const model = localStorage.getItem("cloudTranscriptionModel") || "";
          const preferredLanguage = localStorage.getItem("preferredLanguage") || "auto";

          await setSetting("cloudTranscriptionProvider", provider);
          await setSetting("cloudTranscriptionModel", model);
          await setSetting("preferredLanguage", preferredLanguage);
          await setSetting("activationMode", activationMode);
        } catch {
          // ignore
        }
      })();
    }
  } catch {
    // ignore
  }
}

export const tauriAPI = electronAPICompat;
export default tauriAPI;
