import { useCallback, useEffect } from "react";
import {
  CLIPBOARD_STORAGE_KEYS,
  collectUnusedClipboardImagePaths,
  isSameClipboardItem,
  migrateInlineClipboardImageItems,
  normalizeClipboardUpdatePayload,
} from "../clipboardItems";
import { pruneStoredClipboardHistoryWithImageCleanup } from "../clipboardRetention";
import { pruneHistoryItemsByRetention } from "../../privacy/privacySettings";
import platform from "../../../shared/platform";
import type {
  ClipboardFavoritesState,
  ClipboardHistoryItem,
  ClipboardUpdatePayload,
} from "../../../types/clipboard";

const STORAGE_KEYS = CLIPBOARD_STORAGE_KEYS;

const DEFAULT_MAX_ITEMS = 50;

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sameItemId(a: ClipboardHistoryItem, b: ClipboardHistoryItem): boolean {
  return a.id === b.id;
}

function readFavoriteItems(): ClipboardHistoryItem[] {
  const favorites = safeJsonParse<ClipboardFavoritesState | null>(
    localStorage.getItem(STORAGE_KEYS.favorites),
    null
  );
  return Array.isArray(favorites?.items) ? favorites.items : [];
}

function cleanupUnusedImageFiles(
  removed: ClipboardHistoryItem[],
  retained: ClipboardHistoryItem[]
): void {
  const paths = collectUnusedClipboardImagePaths(removed, [...retained, ...readFavoriteItems()]);
  if (paths.length > 0) {
    void platform.clipboard.deleteImageFiles(paths);
  }
}

export function useClipboardListener(): void {
  const handleClipboardUpdate = useCallback((payload: ClipboardUpdatePayload) => {
    try {
      const enabledRaw = localStorage.getItem(STORAGE_KEYS.enabled);
      const enabled = enabledRaw === null ? true : enabledRaw === "true";
      if (!enabled) return;

      const incoming = normalizeClipboardUpdatePayload(payload);
      if (!incoming) return;

      const maxRaw = localStorage.getItem(STORAGE_KEYS.maxItems);
      const maxItems = maxRaw ? Number.parseInt(maxRaw, 10) : DEFAULT_MAX_ITEMS;
      const limit = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : DEFAULT_MAX_ITEMS;

      const current = safeJsonParse<ClipboardHistoryItem[]>(
        localStorage.getItem(STORAGE_KEYS.history),
        []
      );
      const retained = pruneHistoryItemsByRetention(current);
      const retentionRemoved = current.filter(
        (item) => !retained.some((retainedItem) => sameItemId(item, retainedItem))
      );
      const existingIndex = retained.findIndex((item) => isSameClipboardItem(item, incoming));
      if (existingIndex !== -1) {
        const existing = retained[existingIndex];
        const next: ClipboardHistoryItem[] = [
          { ...existing, ...incoming, id: existing.id || incoming.id },
          ...retained.filter((_, index) => index !== existingIndex),
        ].slice(0, limit);
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(next));
        cleanupUnusedImageFiles([...retentionRemoved, existing], next);
        return;
      }

      const expanded = pruneHistoryItemsByRetention([incoming, ...retained]);
      const next: ClipboardHistoryItem[] = expanded.slice(0, limit);
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(next));
      const trimRemoved = expanded.filter(
        (item) => !next.some((nextItem) => sameItemId(item, nextItem))
      );
      cleanupUnusedImageFiles([...retentionRemoved, ...trimRemoved], next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pruned = pruneStoredClipboardHistoryWithImageCleanup({
          deleteImageFiles: platform.clipboard.deleteImageFiles,
        });
        const current = pruned.retained;
        const migrated = await migrateInlineClipboardImageItems(
          current,
          platform.clipboard.storeImage
        );
        if (cancelled) return;
        if (migrated.changed) {
          localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(migrated.items));
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: undefined | (() => void);

    (async () => {
      try {
        const nextUnlisten = await platform.clipboard.onUpdate(handleClipboardUpdate);
        if (typeof nextUnlisten === "function") {
          unlisten = nextUnlisten;
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [handleClipboardUpdate]);
}
