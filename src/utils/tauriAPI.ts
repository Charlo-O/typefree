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

// ============================================================================
// Clipboard Functions
// ============================================================================

export async function pasteText(text: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("paste_text", { text });
  } catch (error) {
    console.warn("pasteText failed:", error);
  }
}

export async function pasteImage(dataUrl: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("paste_image", { dataUrl });
  } catch (error) {
    console.warn("pasteImage failed:", error);
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

export async function deleteTranscription(id: number): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_delete_transcription", { id });
  } catch (error) {
    console.warn("deleteTranscription failed:", error);
  }
}

export async function clearTranscriptions(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("db_clear_transcriptions");
  } catch (error) {
    console.warn("clearTranscriptions failed:", error);
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
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_setting", { key });
  } catch (error) {
    console.warn("getSetting failed:", error);
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_setting", { key, value });
  } catch (error) {
    console.warn("setSetting failed:", error);
  }
}

export async function getEnvVar(key: string): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_env_var", { key });
  } catch (error) {
    console.warn("getEnvVar failed:", error);
    return null;
  }
}

export async function setEnvVar(key: string, value: string): Promise<void> {
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

  // Default to debug in dev to make diagnosis easy.
  try {
    // eslint-disable-next-line no-undef
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

// API Key helpers
export async function getOpenAIKey(): Promise<string | null> {
  return getEnvVar("OPENAI_API_KEY");
}

export async function saveOpenAIKey(key: string): Promise<void> {
  return setEnvVar("OPENAI_API_KEY", key);
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
    const systemPrompt = getSystemPrompt(agentName);

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
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("hide_window");
  } catch (error) {
    console.warn("hideWindow failed:", error);
  }
}

export async function showWindow(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("show_window");
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
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  } catch (error) {
    console.warn("openExternal failed, falling back to window.open:", error);
    window.open(url, "_blank");
  }
}

export async function updateHotkey(hotkey: string): Promise<{ success: boolean; message?: string }> {
  console.log("updateHotkey called with:", hotkey);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const success = await invoke("register_hotkey", { hotkey });
    console.log("Hotkey registered:", success);
    return { success: success as boolean, message: success ? "ok" : "registration returned false" };
  } catch (error) {
    console.error("Failed to register hotkey:", error);
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

export async function saveAllKeysToEnv(): Promise<void> {
  // Keys are already saved via setEnvVar
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

  // Database
  saveTranscription,
  getTranscriptions,
  deleteTranscription,
  clearTranscriptions,

  // Transcription
  transcribeAudio,
  getTranscriptionProviders,

  // Native Recording (macOS)
  startNativeRecording,
  stopNativeRecording,
  cancelNativeRecording,

  // Settings
  getSetting,
  setSetting,
  getEnvVar,
  setEnvVar,
  getAllSettings,
  getOpenAIKey,
  saveOpenAIKey,
  getAnthropicKey,
  saveAnthropicKey,
  getGeminiKey,
  saveGeminiKey,
  getGroqKey,
  saveGroqKey,
  getZaiKey,
  saveZaiKey,

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

  // Autostart
  getAutoStartEnabled,
  setAutoStartEnabled,

  // Hotkey
  updateHotkey,
  setHotkeyListeningMode,
  setMainWindowInteractivity,
  saveAllKeysToEnv,

  // Stub for missing functions
  onHotkeyFallbackUsed: (callback: any) => () => {},
  onHotkeyRegistrationFailed: (callback: any) => () => {},
  onGlobeKeyPressed: (callback: any) => () => {},
  modelGetAll: async () => [],
  processLocalReasoning,
  checkLocalReasoningAvailable,
  processAnthropicReasoning,
  getDebugState: async () => false,
  setDebugLogging: async (state: boolean) => true,
  openLogsFolder: async () => {},
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
          const isMac = /\bMac\b|\bDarwin\b/i.test(navigator.platform || navigator.userAgent || "");
          if (!isMac) return;
          if (!hasTauriRuntime()) return;

          const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";
          const model = localStorage.getItem("cloudTranscriptionModel") || "";
          const preferredLanguage = localStorage.getItem("preferredLanguage") || "auto";
          const activationMode = localStorage.getItem("activationMode") || "tap";

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
