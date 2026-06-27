import { getErrorMessage, type CommandResult } from "./commandCore";
import type { DictationTriggerMode } from "./types";

type HotkeyRegistrationStatus = {
  success: boolean;
  message?: string | null;
};

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

function toHotkeyResult(status?: HotkeyRegistrationStatus): CommandResult {
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

export async function updateHotkey(hotkey: string): Promise<CommandResult> {
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
    const message = getErrorMessage(error);
    return { success: false, message, error: message };
  }
}

export async function updateClipboardHotkey(hotkey: string): Promise<CommandResult> {
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
    const message = getErrorMessage(error);
    return { success: false, message, error: message };
  }
}

export async function updateDictationTriggerMode(
  mode: DictationTriggerMode
): Promise<CommandResult> {
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
    const message = getErrorMessage(error);
    return { success: false, message, error: message };
  }
}

export async function setHotkeyListeningMode(enabled: boolean): Promise<void> {
  // TODO: Implement hotkey listening mode.
  console.log("setHotkeyListeningMode:", enabled);
}
