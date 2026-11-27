import { PROCESSING_MODES, type ProcessingModeId } from "./processingModes";

export const PROCESSING_MODE_HOTKEYS_STORAGE_KEY = "processingModeHotkeys";

/**
 * The voice-agent hotkey shares the processing-mode hotkey map, but it is one-shot: it routes a
 * single recording to the Codex agent without changing the persisted processing mode.
 */
export const AGENT_HOTKEY_TARGET_ID = "agent";

export type HotkeyTargetId = ProcessingModeId | typeof AGENT_HOTKEY_TARGET_ID;

export type ProcessingModeHotkeys = Partial<Record<HotkeyTargetId, string>>;

const PROCESSING_MODE_IDS = new Set<HotkeyTargetId>([
  ...PROCESSING_MODES.map((mode) => mode.id),
  AGENT_HOTKEY_TARGET_ID,
]);

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
    if (!PROCESSING_MODE_IDS.has(modeId as HotkeyTargetId) || typeof hotkey !== "string") {
      continue;
    }
    const normalized = hotkey.trim();
    if (normalized) {
      result[modeId as HotkeyTargetId] = normalized;
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
