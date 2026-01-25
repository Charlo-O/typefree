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
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('paste_text', { text });
  } catch (error) {
    console.warn('pasteText failed:', error);
  }
}

export async function readClipboard(): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('read_clipboard');
  } catch (error) {
    console.warn('readClipboard failed:', error);
    return '';
  }
}

export async function writeClipboard(text: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('write_clipboard', { text });
  } catch (error) {
    console.warn('writeClipboard failed:', error);
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
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('db_save_transcription', {
      text,
      processed,
      method,
      agentName,
    });
  } catch (error) {
    console.warn('saveTranscription failed:', error);
    return 0;
  }
}

export async function getTranscriptions(limit?: number): Promise<Transcription[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('db_get_transcriptions', { limit });
  } catch (error) {
    console.warn('getTranscriptions failed:', error);
    return [];
  }
}

export async function deleteTranscription(id: number): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('db_delete_transcription', { id });
  } catch (error) {
    console.warn('deleteTranscription failed:', error);
  }
}

export async function clearTranscriptions(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('db_clear_transcriptions');
  } catch (error) {
    console.warn('clearTranscriptions failed:', error);
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
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('transcribe_audio', {
      audioData: Array.from(audioData),
      provider,
      model,
      language,
    });
  } catch (error) {
    console.warn('transcribeAudio failed:', error);
    return '';
  }
}

export async function getTranscriptionProviders(): Promise<TranscriptionProvider[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_transcription_providers');
  } catch (error) {
    console.warn('getTranscriptionProviders failed:', error);
    return [];
  }
}

// ============================================================================
// Settings Functions
// ============================================================================

export async function getSetting<T>(key: string): Promise<T | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_setting', { key });
  } catch (error) {
    console.warn('getSetting failed:', error);
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_setting', { key, value });
  } catch (error) {
    console.warn('setSetting failed:', error);
  }
}

export async function getEnvVar(key: string): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_env_var', { key });
  } catch (error) {
    console.warn('getEnvVar failed:', error);
    return null;
  }
}

export async function setEnvVar(key: string, value: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_env_var', { key, value });
  } catch (error) {
    console.warn('setEnvVar failed:', error);
  }
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_all_settings');
  } catch (error) {
    console.warn('getAllSettings failed:', error);
    return {};
  }
}

// API Key helpers
export async function getOpenAIKey(): Promise<string | null> {
  return getEnvVar('OPENAI_API_KEY');
}

export async function saveOpenAIKey(key: string): Promise<void> {
  return setEnvVar('OPENAI_API_KEY', key);
}

export async function getGroqKey(): Promise<string | null> {
  return getEnvVar('GROQ_API_KEY');
}

export async function saveGroqKey(key: string): Promise<void> {
  return setEnvVar('GROQ_API_KEY', key);
}

export async function getZaiKey(): Promise<string | null> {
  return getEnvVar('ZAI_API_KEY');
}

export async function saveZaiKey(key: string): Promise<void> {
  return setEnvVar('ZAI_API_KEY', key);
}

// ============================================================================
// Window Functions
// ============================================================================

export async function showDictationPanel(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('show_dictation_panel');
  } catch (error) {
    console.warn('showDictationPanel failed:', error);
  }
}

export async function showControlPanel(): Promise<void> {
  console.log('showControlPanel called');
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    console.log('Invoking show_control_panel...');
    await invoke('show_control_panel');
    console.log('show_control_panel invoked successfully');
  } catch (error) {
    console.error('Error invoking show_control_panel:', error);
  }
}

export async function hideWindow(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('hide_window');
  } catch (error) {
    console.warn('hideWindow failed:', error);
  }
}

export async function startWindowDrag(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('start_drag');
  } catch (error) {
    console.warn('startWindowDrag failed:', error);
  }
}

export async function stopWindowDrag(): Promise<void> {
  // No-op for Tauri - drag ends when mouse is released
}

export async function getPlatform(): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_platform');
  } catch (error) {
    console.warn('getPlatform failed:', error);
    return 'unknown';
  }
}

export async function windowMinimize(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    return win.minimize();
  } catch (error) {
    console.warn('windowMinimize failed:', error);
  }
}

export async function windowMaximize(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    return win.toggleMaximize();
  } catch (error) {
    console.warn('windowMaximize failed:', error);
  }
}

export async function windowClose(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    return win.close();
  } catch (error) {
    console.warn('windowClose failed:', error);
  }
}

export async function windowIsMaximized(): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    return win.isMaximized();
  } catch (error) {
    console.warn('windowIsMaximized failed:', error);
    return false;
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

type UnlistenFn = () => void;

export async function onToggleDictation(callback: () => void): Promise<UnlistenFn> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen('toggle-dictation', () => callback());
  } catch (error) {
    console.warn('onToggleDictation failed:', error);
    return () => { };
  }
}

export async function onStartDictation(callback: () => void): Promise<UnlistenFn> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen('start-dictation', () => callback());
  } catch (error) {
    console.warn('onStartDictation failed:', error);
    return () => { };
  }
}

export async function onStopDictation(callback: () => void): Promise<UnlistenFn> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen('stop-dictation', () => callback());
  } catch (error) {
    console.warn('onStopDictation failed:', error);
    return () => { };
  }
}

export async function onTranscriptionAdded(
  callback: (transcription: Transcription) => void
): Promise<UnlistenFn> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen('transcription-added', (event) => {
      callback(event.payload as Transcription);
    });
  } catch (error) {
    console.warn('onTranscriptionAdded failed:', error);
    return () => { };
  }
}

export async function onTranscriptionDeleted(
  callback: (data: { id: number }) => void
): Promise<UnlistenFn> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen('transcription-deleted', (event) => {
      callback(event.payload as { id: number });
    });
  } catch (error) {
    console.warn('onTranscriptionDeleted failed:', error);
    return () => { };
  }
}

export async function onTranscriptionsCleared(callback: () => void): Promise<UnlistenFn> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen('transcriptions-cleared', () => callback());
  } catch (error) {
    console.warn('onTranscriptionsCleared failed:', error);
    return () => { };
  }
}

// ============================================================================
// App Control
// ============================================================================

export async function appQuit(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.close();
  } catch (error) {
    console.warn('appQuit failed:', error);
  }
}

// External URL opener
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    return openUrl(url);
  } catch (error) {
    console.warn('openExternal failed, falling back to window.open:', error);
    window.open(url, '_blank');
  }
}

export async function updateHotkey(hotkey: string): Promise<{ success: boolean }> {
  console.log('updateHotkey called with:', hotkey);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const success = await invoke('register_hotkey', { hotkey });
    console.log('Hotkey registered:', success);
    return { success: success as boolean };
  } catch (error) {
    console.error('Failed to register hotkey:', error);
    return { success: false };
  }
}

export async function setHotkeyListeningMode(enabled: boolean): Promise<void> {
  // TODO: Implement hotkey listening mode
  console.log('setHotkeyListeningMode:', enabled);
}

export async function setMainWindowInteractivity(interactive: boolean): Promise<void> {
  // TODO: Implement window interactivity toggle
  console.log('setMainWindowInteractivity:', interactive);
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
  // Clipboard
  pasteText,
  readClipboard,
  writeClipboard,

  // Database
  saveTranscription,
  getTranscriptions,
  deleteTranscription,
  clearTranscriptions,

  // Transcription
  transcribeAudio,
  getTranscriptionProviders,

  // Settings
  getSetting,
  setSetting,
  getEnvVar,
  setEnvVar,
  getAllSettings,
  getOpenAIKey,
  saveOpenAIKey,
  getGroqKey,
  saveGroqKey,
  getZaiKey,
  saveZaiKey,

  // Window
  showDictationPanel,
  showControlPanel,
  hideWindow,
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

  // App
  appQuit,
  openExternal,

  // Hotkey
  updateHotkey,
  setHotkeyListeningMode,
  setMainWindowInteractivity,
  saveAllKeysToEnv,

  // Stub for missing functions
  onHotkeyFallbackUsed: (callback: any) => () => { },
  onHotkeyRegistrationFailed: (callback: any) => () => { },
  onGlobeKeyPressed: (callback: any) => () => { },
  modelGetAll: async () => [],
  processLocalReasoning: async () => '',
  getDebugState: async () => false,
  setDebugLogging: async (state: boolean) => true,
  openLogsFolder: async () => { },
};

// Make available on window.electronAPI for backward compatibility
if (typeof window !== 'undefined') {
  (window as any).electronAPI = electronAPICompat;
  (window as any).tauriAPI = electronAPICompat;
}

export const tauriAPI = electronAPICompat;
export default tauriAPI;
