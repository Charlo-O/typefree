import {
  getErrorMessage,
  hasTauriRuntime,
  unavailableInTauriBuild,
  type CommandResult,
} from "./commandCore";

type OpenSettingsResult = { success: boolean; error?: string };

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
  // No-op for Tauri - drag ends when mouse is released.
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
    const { invoke } = await import("@tauri-apps/api/core");
    const platform = await invoke<string>("get_platform").catch(() => "unknown");
    if (platform === "win32") {
      await invoke("hide_window");
      return;
    }

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
    const { invoke } = await import("@tauri-apps/api/core");
    const platform = await invoke<string>("get_platform").catch(() => "unknown");
    if (platform === "win32") {
      await invoke("hide_window");
      return;
    }

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

export async function setMainWindowInteractivity(interactive: boolean): Promise<void> {
  // TODO: Implement window interactivity toggle.
  void interactive;
}

export async function appQuit(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quit_app");
  } catch (error) {
    console.warn("appQuit failed:", error);
  }
}

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

export async function openMicrophoneSettings(): Promise<OpenSettingsResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_microphone_settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function openSoundInputSettings(): Promise<OpenSettingsResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_sound_input_settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function openAccessibilitySettings(): Promise<OpenSettingsResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_accessibility_settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getAutoStartEnabled(): Promise<boolean> {
  if (!hasTauriRuntime()) {
    return false;
  }
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return await isEnabled();
  } catch (error) {
    console.warn("getAutoStartEnabled failed:", error);
    return false;
  }
}

export async function setAutoStartEnabled(enabled: boolean): Promise<{ success: boolean }> {
  if (!hasTauriRuntime()) {
    return { success: false };
  }
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

export async function cleanupApp(): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: unavailableInTauriBuild("Application data cleanup"),
  };
}
