export const PROMPT_TEST_RUNS_STORAGE_KEY = "promptStudio.testRuns";
export const MAX_PROMPT_TEST_RUNS = 24;

export interface PromptTestRun {
  id: string;
  createdAt: string;
  input: string;
  selectedText: string;
  clipboardText: string;
  promptVersionId: string | null;
  promptScore: number;
  promptCharCount: number;
  provider: string;
  model: string;
  output: string;
  error: string | null;
  durationMs: number;
  comparisonId?: string;
}

type SavePromptTestRunInput = Omit<PromptTestRun, "id" | "createdAt"> & {
  storage?: Storage | null;
};

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

function isPromptTestRun(value: unknown): value is PromptTestRun {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PromptTestRun>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.input === "string" &&
    typeof candidate.selectedText === "string" &&
    typeof candidate.clipboardText === "string" &&
    (typeof candidate.promptVersionId === "string" || candidate.promptVersionId === null) &&
    typeof candidate.promptScore === "number" &&
    typeof candidate.promptCharCount === "number" &&
    typeof candidate.provider === "string" &&
    typeof candidate.model === "string" &&
    typeof candidate.output === "string" &&
    (typeof candidate.error === "string" || candidate.error === null) &&
    typeof candidate.durationMs === "number"
  );
}

export function readPromptTestRuns(storage?: Storage | null): PromptTestRun[] {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return [];

  try {
    const raw = resolvedStorage.getItem(PROMPT_TEST_RUNS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPromptTestRun).slice(0, MAX_PROMPT_TEST_RUNS);
  } catch {
    return [];
  }
}

export function writePromptTestRuns(
  runs: PromptTestRun[],
  storage?: Storage | null
): PromptTestRun[] {
  const resolvedStorage = resolveStorage(storage);
  const normalized = runs.filter(isPromptTestRun).slice(0, MAX_PROMPT_TEST_RUNS);

  if (!resolvedStorage) return normalized;
  resolvedStorage.setItem(PROMPT_TEST_RUNS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function savePromptTestRun({ storage, ...input }: SavePromptTestRunInput): {
  run: PromptTestRun;
  runs: PromptTestRun[];
} {
  const resolvedStorage = resolveStorage(storage);
  const run: PromptTestRun = {
    ...input,
    id: createId(),
    createdAt: new Date().toISOString(),
  };

  const runs = writePromptTestRuns([run, ...readPromptTestRuns(resolvedStorage)], resolvedStorage);
  return { run, runs };
}

export function deletePromptTestRun(id: string, storage?: Storage | null): PromptTestRun[] {
  const resolvedStorage = resolveStorage(storage);
  return writePromptTestRuns(
    readPromptTestRuns(resolvedStorage).filter((run) => run.id !== id),
    resolvedStorage
  );
}
