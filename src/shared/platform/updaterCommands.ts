import {
  hasTauriRuntime,
  unavailableInTauriBuild,
  type UpdateCheckResult,
  type UpdateInfoResult,
  type UpdateStatusResult,
} from "./commandCore";
import type { PlatformUnlisten } from "./types";

const noopUnlisten = () => {};

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
  if (!hasTauriRuntime()) {
    return { version: "" };
  }
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

export function onUpdateAvailable(_callback: (event: any, info: any) => void): PlatformUnlisten {
  return noopUnlisten;
}

export function onUpdateNotAvailable(_callback: (event: any, info: any) => void): PlatformUnlisten {
  return noopUnlisten;
}

export function onUpdateDownloaded(_callback: (event: any, info: any) => void): PlatformUnlisten {
  return noopUnlisten;
}

export function onUpdateDownloadProgress(
  _callback: (event: any, progressObj: any) => void
): PlatformUnlisten {
  return noopUnlisten;
}

export function onUpdateError(_callback: (event: any, error: any) => void): PlatformUnlisten {
  return noopUnlisten;
}
