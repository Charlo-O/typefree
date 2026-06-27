import type { ForegroundApplication } from "../../shared/platform";

export const PRIVACY_APPLICATION_BLACKLIST_KEY = "privacyApplicationBlacklist";
export const PRIVACY_PAUSE_HISTORY_KEY = "privacyPauseHistoryInBlacklistedApps";
export const PRIVACY_PAUSE_CLIPBOARD_KEY = "privacyPauseClipboardInBlacklistedApps";
export const PRIVACY_AUTO_DELETE_HISTORY_KEY = "privacyAutoDeleteHistoryEnabled";
export const PRIVACY_HISTORY_RETENTION_DAYS_KEY = "privacyHistoryRetentionDays";
export const DEFAULT_PRIVACY_HISTORY_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const CLIPBOARD_HISTORY_KEY = "clipboard.history";

export interface PrivacySettings {
  applicationBlacklist: string;
  pauseHistoryInBlacklistedApps: boolean;
  pauseClipboardInBlacklistedApps: boolean;
  autoDeleteHistoryEnabled: boolean;
  historyRetentionDays: number;
}

export interface HistoryRetentionPruneResult<T> {
  retained: T[];
  removed: T[];
}

function getStorage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

export function normalizeApplicationKey(value: unknown): string {
  const cleaned = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.exe$/i, "")
    .toLowerCase();

  return String(cleaned || "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeRetentionDays(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PRIVACY_HISTORY_RETENTION_DAYS;
  }

  return Math.min(parsed, 3650);
}

export function parsePrivacyApplicationBlacklist(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(normalizeApplicationKey).filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,;]+/)
    .map(normalizeApplicationKey)
    .filter(Boolean);
}

export function serializePrivacyApplicationBlacklist(entries: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of entries) {
    const normalized = normalizeApplicationKey(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result.join("\n");
}

export function readPrivacySettings(storage: Storage | null = getStorage()): PrivacySettings {
  return {
    applicationBlacklist: storage?.getItem(PRIVACY_APPLICATION_BLACKLIST_KEY) || "",
    pauseHistoryInBlacklistedApps: storage?.getItem(PRIVACY_PAUSE_HISTORY_KEY) !== "false",
    pauseClipboardInBlacklistedApps: storage?.getItem(PRIVACY_PAUSE_CLIPBOARD_KEY) !== "false",
    autoDeleteHistoryEnabled: storage?.getItem(PRIVACY_AUTO_DELETE_HISTORY_KEY) === "true",
    historyRetentionDays: normalizeRetentionDays(
      storage?.getItem(PRIVACY_HISTORY_RETENTION_DAYS_KEY)
    ),
  };
}

export function getHistoryRetentionCutoffMs(
  settings: PrivacySettings = readPrivacySettings(),
  nowMs = Date.now()
): number | null {
  if (!settings.autoDeleteHistoryEnabled) return null;
  return nowMs - settings.historyRetentionDays * DAY_MS;
}

export function pruneHistoryItemsByRetention<T extends { tsMs?: number }>(
  items: T[],
  settings: PrivacySettings = readPrivacySettings(),
  nowMs = Date.now()
): T[] {
  return partitionHistoryItemsByRetention(items, settings, nowMs).retained;
}

export function partitionHistoryItemsByRetention<T extends { tsMs?: number }>(
  items: T[],
  settings: PrivacySettings = readPrivacySettings(),
  nowMs = Date.now()
): HistoryRetentionPruneResult<T> {
  const cutoffMs = getHistoryRetentionCutoffMs(settings, nowMs);
  if (cutoffMs === null) return { retained: items, removed: [] };

  const retained: T[] = [];
  const removed: T[] = [];

  for (const item of items) {
    const tsMs = Number(item.tsMs);
    if (!Number.isFinite(tsMs) || tsMs >= cutoffMs) {
      retained.push(item);
    } else {
      removed.push(item);
    }
  }

  return { retained, removed };
}

export function pruneStoredClipboardHistoryWithResult<
  T extends { tsMs?: number } = { tsMs?: number },
>(storage: Storage | null = getStorage(), nowMs = Date.now()): HistoryRetentionPruneResult<T> {
  if (!storage) return { retained: [], removed: [] };

  try {
    const rawItems = JSON.parse(storage.getItem(CLIPBOARD_HISTORY_KEY) || "[]") as unknown;
    if (!Array.isArray(rawItems)) return { retained: [], removed: [] };

    const result = partitionHistoryItemsByRetention<T>(
      rawItems as T[],
      readPrivacySettings(storage),
      nowMs
    );
    if (result.removed.length > 0) {
      storage.setItem(CLIPBOARD_HISTORY_KEY, JSON.stringify(result.retained));
    }
    return result;
  } catch {
    return { retained: [], removed: [] };
  }
}

export function pruneStoredClipboardHistory(
  storage: Storage | null = getStorage(),
  nowMs = Date.now()
): number {
  return pruneStoredClipboardHistoryWithResult(storage, nowMs).removed.length;
}

export function isForegroundApplicationBlacklisted(
  application: ForegroundApplication | null | undefined,
  blacklistValue: unknown = readPrivacySettings().applicationBlacklist
): boolean {
  if (!application) return false;

  const blacklist = new Set(parsePrivacyApplicationBlacklist(blacklistValue));
  if (!blacklist.size) return false;

  const candidates = [
    application.id,
    application.name,
    application.bundleId,
    application.executablePath,
  ]
    .map(normalizeApplicationKey)
    .filter(Boolean);

  return candidates.some((candidate) => blacklist.has(candidate));
}

export function createPrivacySkipReason(application: ForegroundApplication | null | undefined) {
  if (!application?.id) return "privacy blacklist";
  return `privacy blacklist: ${application.id}`;
}
