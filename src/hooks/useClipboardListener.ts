import { useCallback, useEffect } from "react";
import type { ClipboardHistoryItem, ClipboardItemType } from "../types/clipboard";

const STORAGE_KEYS = {
  enabled: "clipboard.enabled",
  maxItems: "clipboard.maxItems",
  history: "clipboard.history",
} as const;

const DEFAULT_MAX_ITEMS = 50;

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useClipboardListener(): void {
  const handleClipboardUpdate = useCallback((payload: any) => {
    try {
      const enabledRaw = localStorage.getItem(STORAGE_KEYS.enabled);
      const enabled = enabledRaw === null ? true : enabledRaw === "true";
      if (!enabled) return;

      const id = String(payload?.id || "").trim();
      if (!id) return;

      const itemType = (payload?.type || payload?.item_type || "text") as ClipboardItemType;
      const content = String(payload?.content || "");
      const tsMs = Number(payload?.tsMs ?? payload?.ts_ms ?? Date.now());

      if (!content.trim()) return;

      const maxRaw = localStorage.getItem(STORAGE_KEYS.maxItems);
      const maxItems = maxRaw ? Number.parseInt(maxRaw, 10) : DEFAULT_MAX_ITEMS;
      const limit = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : DEFAULT_MAX_ITEMS;

      const current = safeJsonParse<ClipboardHistoryItem[]>(
        localStorage.getItem(STORAGE_KEYS.history),
        []
      );
      if (current.some((item) => item.id === id)) {
        return;
      }

      const next: ClipboardHistoryItem[] = [
        { id, type: itemType, content, tsMs },
        ...current,
      ].slice(0, limit);
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let unlisten: undefined | (() => void);

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("clipboard-update", (event) => {
          handleClipboardUpdate((event as any).payload);
        });
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
