import { PROCESSING_MODES, type ProcessingModeId } from "./processingModes";

export const PROCESSING_MODE_HOTKEYS_STORAGE_KEY = "processingModeHotkeys";

export type ProcessingModeHotkeys = Partial<Record<ProcessingModeId, string>>;

const PROCESSING_MODE_IDS = new Set<ProcessingModeId>(PROCESSING_MODES.map((mode) => mode.id));

export function normalizeProcessingModeHotkeys(value: unknown): ProcessingModeHotkeys {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const result: ProcessingModeHotkeys = {};
  for (const [modeId, hotkey] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PROCESSING_MODE_IDS.has(modeId as ProcessingModeId) || typeof hotkey !== "string") {
      continue;
    }
    const normalized = hotkey.trim();
    if (normalized) {
      result[modeId as ProcessingModeId] = normalized;
    }
  }
  return result;
}

export function readProcessingModeHotkeys(): ProcessingModeHotkeys {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }
  return normalizeProcessingModeHotkeys(
    window.localStorage.getItem(PROCESSING_MODE_HOTKEYS_STORAGE_KEY)
  );
}

export function serializeProcessingModeHotkeys(value: unknown): string {
  return JSON.stringify(normalizeProcessingModeHotkeys(value));
}
