export const PROMPT_TEST_SAMPLES_STORAGE_KEY = "promptStudio.testSamples";
export const MAX_PROMPT_TEST_SAMPLES = 12;

export interface PromptTestSample {
  id: string;
  input: string;
  selectedText: string;
  clipboardText: string;
  createdAt: string;
}

interface SavePromptTestSampleInput {
  input: string;
  selectedText?: string;
  clipboardText?: string;
  storage?: Storage | null;
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

function isPromptTestSample(value: unknown): value is PromptTestSample {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PromptTestSample>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.input === "string" &&
    typeof candidate.selectedText === "string" &&
    typeof candidate.clipboardText === "string" &&
    typeof candidate.createdAt === "string"
  );
}

export function readPromptTestSamples(storage?: Storage | null): PromptTestSample[] {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return [];

  try {
    const raw = resolvedStorage.getItem(PROMPT_TEST_SAMPLES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPromptTestSample).slice(0, MAX_PROMPT_TEST_SAMPLES);
  } catch {
    return [];
  }
}

export function writePromptTestSamples(
  samples: PromptTestSample[],
  storage?: Storage | null
): PromptTestSample[] {
  const resolvedStorage = resolveStorage(storage);
  const normalized = samples.filter(isPromptTestSample).slice(0, MAX_PROMPT_TEST_SAMPLES);

  if (!resolvedStorage) return normalized;
  resolvedStorage.setItem(PROMPT_TEST_SAMPLES_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function savePromptTestSample({
  input,
  selectedText = "",
  clipboardText = "",
  storage,
}: SavePromptTestSampleInput): { sample: PromptTestSample; samples: PromptTestSample[] } {
  const resolvedStorage = resolveStorage(storage);
  const sample: PromptTestSample = {
    id: createId(),
    input,
    selectedText,
    clipboardText,
    createdAt: new Date().toISOString(),
  };

  const samples = writePromptTestSamples(
    [sample, ...readPromptTestSamples(resolvedStorage)],
    resolvedStorage
  );

  return { sample, samples };
}

export function deletePromptTestSample(id: string, storage?: Storage | null): PromptTestSample[] {
  const resolvedStorage = resolveStorage(storage);
  return writePromptTestSamples(
    readPromptTestSamples(resolvedStorage).filter((sample) => sample.id !== id),
    resolvedStorage
  );
}
