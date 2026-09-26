import type { ProcessingModeId } from "./processingModes";

/**
 * User overrides for the system prompt attached to each AI processing mode.
 *
 * Keep these separate from the legacy unified Prompt Studio value so users can
 * customize one mode without changing the other modes or the Prompt Studio
 * compatibility surface.
 */
export const CUSTOM_PROCESSING_MODE_PROMPTS_STORAGE_KEY = "customProcessingModePrompts";

export type ProcessingModePromptOverrides = Partial<Record<ProcessingModeId, string>>;

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

function isProcessingModeId(value: unknown): value is ProcessingModeId {
  return (
    value === "direct" ||
    value === "voice-polish" ||
    value === "command" ||
    value === "translate-en" ||
    value === "prompt-optimize"
  );
}

function isOverrides(value: unknown): value is ProcessingModePromptOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return Object.entries(value).every(
    ([key, prompt]) =>
      isProcessingModeId(key) && typeof prompt === "string" && prompt.trim().length > 0
  );
}

export function readProcessingModePromptOverrides(
  storage?: Storage | null
): ProcessingModePromptOverrides {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return {};

  try {
    const raw = resolvedStorage.getItem(CUSTOM_PROCESSING_MODE_PROMPTS_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!isOverrides(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).map(([key, prompt]) => [key, prompt.trim()])
    ) as ProcessingModePromptOverrides;
  } catch {
    return {};
  }
}

export function writeProcessingModePromptOverrides(
  overrides: ProcessingModePromptOverrides,
  storage?: Storage | null
): ProcessingModePromptOverrides {
  const resolvedStorage = resolveStorage(storage);
  const normalized = Object.fromEntries(
    Object.entries(overrides)
      .filter(
        ([key, prompt]) => isProcessingModeId(key) && typeof prompt === "string" && prompt.trim()
      )
      .map(([key, prompt]) => [key, prompt.trim()])
  ) as ProcessingModePromptOverrides;

  if (!resolvedStorage) return normalized;

  if (Object.keys(normalized).length === 0) {
    resolvedStorage.removeItem(CUSTOM_PROCESSING_MODE_PROMPTS_STORAGE_KEY);
  } else {
    resolvedStorage.setItem(CUSTOM_PROCESSING_MODE_PROMPTS_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function getStoredProcessingModePrompt(
  modeId: ProcessingModeId,
  storage?: Storage | null
): string | null {
  return readProcessingModePromptOverrides(storage)[modeId] || null;
}

export function setStoredProcessingModePrompt(
  modeId: ProcessingModeId,
  prompt: string,
  storage?: Storage | null
): ProcessingModePromptOverrides {
  const overrides = readProcessingModePromptOverrides(storage);
  const normalizedPrompt = prompt.trim();

  if (normalizedPrompt) {
    overrides[modeId] = normalizedPrompt;
  } else {
    delete overrides[modeId];
  }

  return writeProcessingModePromptOverrides(overrides, storage);
}

export function clearStoredProcessingModePrompt(
  modeId: ProcessingModeId,
  storage?: Storage | null
): ProcessingModePromptOverrides {
  const overrides = readProcessingModePromptOverrides(storage);
  delete overrides[modeId];
  return writeProcessingModePromptOverrides(overrides, storage);
}
