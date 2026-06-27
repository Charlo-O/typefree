import { CLIPBOARD_STORAGE_KEYS, collectUnusedClipboardImagePaths } from "./clipboardItems";
import { partitionHistoryItemsByRetention, readPrivacySettings } from "../privacy/privacySettings";
import type { HistoryRetentionPruneResult } from "../privacy/privacySettings";
import type { ClipboardFavoritesState, ClipboardHistoryItem } from "../../types/clipboard";

export interface ClipboardRetentionCleanupResult extends HistoryRetentionPruneResult<ClipboardHistoryItem> {
  unusedImagePaths: string[];
}

interface ClipboardRetentionCleanupOptions {
  storage?: Storage | null;
  nowMs?: number;
  deleteImageFiles?: (paths: string[]) => Promise<unknown> | unknown;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readHistoryItems(storage: Storage): ClipboardHistoryItem[] {
  return safeJsonParse<ClipboardHistoryItem[]>(storage.getItem(CLIPBOARD_STORAGE_KEYS.history), []);
}

function readFavoriteItems(storage: Storage): ClipboardHistoryItem[] {
  const favorites = safeJsonParse<ClipboardFavoritesState | null>(
    storage.getItem(CLIPBOARD_STORAGE_KEYS.favorites),
    null
  );
  return Array.isArray(favorites?.items) ? favorites.items : [];
}

export function pruneStoredClipboardHistoryWithImageCleanup(
  options: ClipboardRetentionCleanupOptions = {}
): ClipboardRetentionCleanupResult {
  const storage = options.storage ?? getStorage();
  if (!storage) {
    return { retained: [], removed: [], unusedImagePaths: [] };
  }

  const result = partitionHistoryItemsByRetention(
    readHistoryItems(storage),
    readPrivacySettings(storage),
    options.nowMs
  );
  if (result.removed.length === 0) {
    return { ...result, unusedImagePaths: [] };
  }

  try {
    storage.setItem(CLIPBOARD_STORAGE_KEYS.history, JSON.stringify(result.retained));
  } catch {
    // ignore
  }

  const unusedImagePaths = collectUnusedClipboardImagePaths(result.removed, [
    ...result.retained,
    ...readFavoriteItems(storage),
  ]);
  if (unusedImagePaths.length > 0) {
    void options.deleteImageFiles?.(unusedImagePaths);
  }

  return { ...result, unusedImagePaths };
}
