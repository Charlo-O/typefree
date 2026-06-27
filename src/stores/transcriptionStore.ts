import { useSyncExternalStore } from "react";
import { platform } from "../shared/platform";
import type { TranscriptionItem } from "../types/desktop";

type Listener = () => void;

const listeners = new Set<Listener>();
let transcriptions: TranscriptionItem[] = [];
let hasBoundHistoryListeners = false;
const DEFAULT_LIMIT = 50;
let currentLimit = DEFAULT_LIMIT;

const emit = () => {
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => transcriptions;

function bindDisposer(
  disposers: Array<() => void>,
  result: void | (() => void) | Promise<void | (() => void)>
) {
  if (!result) return;
  if (typeof result === "function") {
    disposers.push(result);
    return;
  }

  result
    .then((dispose) => {
      if (typeof dispose === "function") {
        disposers.push(dispose);
      }
    })
    .catch(() => {
      // ignore listener setup failures; history can still be refreshed manually
    });
}

function ensureHistoryListeners() {
  if (hasBoundHistoryListeners) {
    return;
  }

  const disposers: Array<() => void> = [];

  bindDisposer(
    disposers,
    platform.history.onAdded((item) => {
      if (item) {
        addTranscription(item);
      }
    })
  );

  bindDisposer(
    disposers,
    platform.history.onDeleted(({ id }) => {
      removeTranscription(id);
    })
  );

  bindDisposer(
    disposers,
    platform.history.onCleared(() => {
      clearTranscriptions();
    })
  );

  bindDisposer(
    disposers,
    platform.history.onPruned(() => {
      void initializeTranscriptions(currentLimit);
    })
  );

  hasBoundHistoryListeners = true;

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      disposers.forEach((dispose) => dispose());
    });
  }
}

export async function initializeTranscriptions(limit = DEFAULT_LIMIT) {
  currentLimit = limit;
  ensureHistoryListeners();
  const items = await platform.history.getTranscriptions(limit);
  transcriptions = items;
  emit();
  return items;
}

export function addTranscription(item: TranscriptionItem) {
  if (!item) return;
  const withoutDuplicate = transcriptions.filter((existing) => existing.id !== item.id);
  transcriptions = [item, ...withoutDuplicate].slice(0, currentLimit);
  emit();
}

export function removeTranscription(id: number) {
  if (!id) return;
  const next = transcriptions.filter((item) => item.id !== id);
  if (next.length === transcriptions.length) return;
  transcriptions = next;
  emit();
}

export function clearTranscriptions() {
  if (transcriptions.length === 0) return;
  transcriptions = [];
  emit();
}

export function useTranscriptions() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
