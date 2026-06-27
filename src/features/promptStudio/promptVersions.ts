import { CUSTOM_UNIFIED_PROMPT_STORAGE_KEY } from "../../config/promptStorage";

export const PROMPT_VERSIONS_STORAGE_KEY = "promptStudio.promptVersions";
export const ACTIVE_PROMPT_VERSION_ID_STORAGE_KEY = "promptStudio.activeVersionId";
export const MAX_PROMPT_VERSIONS = 20;

export type PromptVersionSource = "manual" | "reset" | "rollback" | "migration";

export interface PromptVersion {
  id: string;
  prompt: string;
  createdAt: string;
  source: PromptVersionSource;
  score: number;
  charCount: number;
}

interface SavePromptVersionOptions {
  source?: PromptVersionSource;
  storage?: Storage | null;
  score?: number;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPromptVersion(value: unknown): value is PromptVersion {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PromptVersion>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.prompt === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.score === "number" &&
    typeof candidate.charCount === "number"
  );
}

export function readPromptVersions(storage?: Storage | null): PromptVersion[] {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return [];

  try {
    const raw = resolvedStorage.getItem(PROMPT_VERSIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPromptVersion).slice(0, MAX_PROMPT_VERSIONS);
  } catch {
    return [];
  }
}

export function writePromptVersions(
  versions: PromptVersion[],
  storage?: Storage | null
): PromptVersion[] {
  const resolvedStorage = resolveStorage(storage);
  const normalized = versions.filter(isPromptVersion).slice(0, MAX_PROMPT_VERSIONS);

  if (!resolvedStorage) return normalized;
  resolvedStorage.setItem(PROMPT_VERSIONS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function readActivePromptVersionId(storage?: Storage | null): string | null {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return null;
  return resolvedStorage.getItem(ACTIVE_PROMPT_VERSION_ID_STORAGE_KEY);
}

export function setActivePromptVersionId(id: string | null, storage?: Storage | null): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;

  if (id) {
    resolvedStorage.setItem(ACTIVE_PROMPT_VERSION_ID_STORAGE_KEY, id);
  } else {
    resolvedStorage.removeItem(ACTIVE_PROMPT_VERSION_ID_STORAGE_KEY);
  }
}

export function savePromptVersion(
  prompt: string,
  options: SavePromptVersionOptions = {}
): { version: PromptVersion; versions: PromptVersion[] } {
  const resolvedStorage = resolveStorage(options.storage);
  const version: PromptVersion = {
    id: createId(),
    prompt,
    createdAt: new Date().toISOString(),
    source: options.source ?? "manual",
    score: options.score ?? 0,
    charCount: prompt.length,
  };

  const versions = writePromptVersions(
    [version, ...readPromptVersions(resolvedStorage)],
    resolvedStorage
  );
  setActivePromptVersionId(version.id, resolvedStorage);

  return { version, versions };
}

export function writeCurrentPrompt(prompt: string, storage?: Storage | null): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.setItem(CUSTOM_UNIFIED_PROMPT_STORAGE_KEY, JSON.stringify(prompt));
}

export function clearCurrentPrompt(storage?: Storage | null): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.removeItem(CUSTOM_UNIFIED_PROMPT_STORAGE_KEY);
}

export function readCurrentPromptRaw(storage?: Storage | null): string | null {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return null;
  return resolvedStorage.getItem(CUSTOM_UNIFIED_PROMPT_STORAGE_KEY);
}

export function restoreCurrentPromptRaw(rawValue: string | null, storage?: Storage | null): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;

  if (rawValue) {
    resolvedStorage.setItem(CUSTOM_UNIFIED_PROMPT_STORAGE_KEY, rawValue);
  } else {
    resolvedStorage.removeItem(CUSTOM_UNIFIED_PROMPT_STORAGE_KEY);
  }
}
