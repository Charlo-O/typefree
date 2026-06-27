import { getErrorMessage, hasTauriRuntime, normalizeCommandError } from "./commandCore";
import type { ForegroundApplication, PrivacyDiagnostics } from "./types";

function getLocalStorageValue(key: string): string | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function getLocalStorageBoolean(key: string, defaultValue: boolean): boolean {
  const value = getLocalStorageValue(key);
  if (value === null) {
    return defaultValue;
  }
  return value !== "false";
}

function getLocalStorageNumber(key: string, defaultValue: number): number {
  const value = Number.parseInt(getLocalStorageValue(key) || "", 10);
  if (!Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  return Math.min(value, 3650);
}

function normalizePrivacyApplicationKey(value: string): string {
  const normalizedPath = value.trim().replaceAll("\\", "/");
  const leaf = normalizedPath.split("/").pop() || value;

  return leaf
    .toLowerCase()
    .replace(/\.exe$/u, "")
    .replace(/[^a-z0-9._-]/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function parseLocalPrivacyBlacklist(value: string | null): string[] {
  const entries = new Set(
    (value || "")
      .split(/[\n,;]/u)
      .map(normalizePrivacyApplicationKey)
      .filter(Boolean)
  );

  return Array.from(entries).sort();
}

function createBrowserPrivacyDiagnostics(error: string | null = null): PrivacyDiagnostics {
  const autoDeleteHistoryEnabled = getLocalStorageBoolean("privacyAutoDeleteHistoryEnabled", false);
  const historyRetentionDays = getLocalStorageNumber("privacyHistoryRetentionDays", 30);

  return {
    detectedForeground: null,
    activeForeground: null,
    applicationBlacklist: parseLocalPrivacyBlacklist(
      getLocalStorageValue("privacyApplicationBlacklist")
    ),
    detectedCandidates: [],
    activeCandidates: [],
    detectedApplicationBlacklisted: false,
    activeApplicationBlacklisted: false,
    pauseHistoryInBlacklistedApps: getLocalStorageBoolean(
      "privacyPauseHistoryInBlacklistedApps",
      true
    ),
    pauseClipboardInBlacklistedApps: getLocalStorageBoolean(
      "privacyPauseClipboardInBlacklistedApps",
      true
    ),
    autoDeleteHistoryEnabled,
    historyRetentionDays,
    effectiveHistoryRetentionDays: autoDeleteHistoryEnabled ? historyRetentionDays : null,
    wouldSkipTranscriptionHistory: false,
    wouldSkipClipboardCapture: false,
    detectionError: error,
  };
}

export async function getForegroundApplication(): Promise<ForegroundApplication | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ForegroundApplication | null>("get_foreground_application");
  } catch (error) {
    console.warn("getForegroundApplication failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function syncForegroundApplicationVocabulary(): Promise<ForegroundApplication | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ForegroundApplication | null>("sync_foreground_application_vocabulary");
  } catch (error) {
    console.warn("syncForegroundApplicationVocabulary failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function getPrivacyDiagnostics(): Promise<PrivacyDiagnostics> {
  if (!hasTauriRuntime()) {
    return createBrowserPrivacyDiagnostics("Tauri runtime not available");
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PrivacyDiagnostics>("privacy_diagnostics");
  } catch (error) {
    console.warn("getPrivacyDiagnostics failed:", error);
    return createBrowserPrivacyDiagnostics(getErrorMessage(error));
  }
}
