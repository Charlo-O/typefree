import { pruneHistoryItemsByRetention } from "../../privacy/privacySettings";

type CompletionStepName =
  | "normalize"
  | "dedupe"
  | "ui"
  | "insert"
  | "clipboard-history"
  | "db-history";
type CompletionStepStatus = "completed" | "skipped" | "failed";

export interface DictationCompletionGuard {
  insertedText: string;
  lastText: string;
  lastAt: number;
  savedTexts: Set<string>;
}

export interface DictationCompletionInput {
  success?: boolean;
  text?: string | null;
  rawText?: string | null;
  normalizedText?: string | null;
  source?: string;
  provider?: string | null;
  skipPaste?: boolean;
  postProcessingSteps?: unknown[];
  postProcessingTimings?: Record<string, unknown> | null;
  processingMode?: string | null;
  usedReasoning?: boolean;
  fallbackReason?: string | null;
  timings?: Record<string, unknown> | null;
}

export interface CompletionPipelineStep {
  name: CompletionStepName;
  status: CompletionStepStatus;
  detail?: string;
  durationMs?: number;
}

export interface CompletionPipelineResult {
  status: "completed" | "empty" | "duplicate" | "failed";
  text: string;
  normalizedText: string;
  steps: CompletionPipelineStep[];
  error?: string;
}

export type CompletionHistorySaveResult =
  | boolean
  | {
      success: boolean;
      skipped?: boolean;
      reason?: string;
      error?: string;
      message?: string;
    };

export interface CompletionSaveTranscriptionOptions {
  rawText?: string | null;
  processedText?: string | null;
  method?: string | null;
  sessionId?: string | null;
  provider?: string | null;
  model?: string | null;
  language?: string | null;
  status?: string | null;
  outputs?: Array<{
    stage: string;
    text: string;
    metadataJson?: string | null;
  }>;
}

interface CompletionPipelineOptions {
  result: DictationCompletionInput;
  sessionId: string;
  guard: DictationCompletionGuard;
  stopRequested: boolean;
  dispatchSession: (event: {
    type: "completed" | "inserting" | "failed";
    sessionId: string;
    text?: string;
    error?: string;
  }) => void;
  setTranscript: (text: string) => void;
  setLiveTranscript: (text: string) => void;
  setAudioLevel: (level: number) => void;
  hideWindow: () => Promise<void>;
  pasteText: (text: string) => Promise<boolean>;
  saveTranscription: (
    text: string,
    options?: CompletionSaveTranscriptionOptions
  ) => Promise<CompletionHistorySaveResult>;
  skipHistory?: boolean;
  historySkipReason?: string;
  insertDelayMs?: number;
}

const HISTORY_KEY = "clipboard.history";
const MAX_KEY = "clipboard.maxItems";
const DUPLICATE_WINDOW_MS = 10000;
const DEFAULT_INSERT_DELAY_MS = 180;
const KNOWN_TRANSCRIPTION_PROVIDER_IDS = [
  "assemblyai",
  "openai",
  "groq",
  "zai",
  "volcengine",
  "custom",
];

export function createDictationCompletionGuard(): DictationCompletionGuard {
  return {
    insertedText: "",
    lastText: "",
    lastAt: 0,
    savedTexts: new Set(),
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function durationSince(startedAt: number): number {
  return Math.round(nowMs() - startedAt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHistoryItem(text: string): {
  id: string;
  type: "text";
  content: string;
  tsMs: number;
} {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "text",
    content: text,
    tsMs: Date.now(),
  };
}

function saveToClipboardHistory(text: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  const maxItems = Number.parseInt(window.localStorage.getItem(MAX_KEY) || "50", 10) || 50;
  const existing = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
  const retained = pruneHistoryItemsByRetention(Array.isArray(existing) ? existing : []);
  const next = pruneHistoryItemsByRetention([createHistoryItem(text), ...retained]).slice(
    0,
    maxItems
  );
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

function pushStep(
  steps: CompletionPipelineStep[],
  name: CompletionStepName,
  status: CompletionStepStatus,
  detail?: string,
  durationMs?: number
): void {
  steps.push({
    name,
    status,
    detail,
    durationMs,
  });
}

function normalizeHistorySaveResult(result: CompletionHistorySaveResult): {
  status: CompletionStepStatus;
  detail?: string;
} {
  if (typeof result === "boolean") {
    return result
      ? { status: "completed" }
      : { status: "failed", detail: "saveTranscription returned false" };
  }

  if (result.success) {
    return { status: "completed", detail: result.message };
  }

  const detail = result.error || result.message || result.reason || "history save failed";
  if (result.skipped) {
    return { status: "skipped", detail };
  }

  return { status: "failed", detail };
}

async function runInsertion({
  text,
  normalizedText,
  result,
  guard,
  stopRequested,
  sessionId,
  steps,
  dispatchSession,
  hideWindow,
  pasteText,
  insertDelayMs,
}: {
  text: string;
  normalizedText: string;
  result: DictationCompletionInput;
  guard: DictationCompletionGuard;
  stopRequested: boolean;
  sessionId: string;
  steps: CompletionPipelineStep[];
  dispatchSession: CompletionPipelineOptions["dispatchSession"];
  hideWindow: () => Promise<void>;
  pasteText: (text: string) => Promise<boolean>;
  insertDelayMs: number;
}): Promise<void> {
  if (result.skipPaste) {
    if (!guard.insertedText || normalizedText.length >= guard.insertedText.length) {
      guard.insertedText = normalizedText;
    }
    pushStep(steps, "insert", "skipped", "result requested skipPaste");
    return;
  }

  if (!stopRequested) {
    console.warn("[Transcription] Final insertion skipped until explicit stop", {
      source: result.source,
      length: normalizedText.length,
    });
    pushStep(steps, "insert", "skipped", "waiting for explicit stop");
    return;
  }

  const alreadyInserted = guard.insertedText;
  if (alreadyInserted) {
    console.warn("[Transcription] Additional completion skipped after final insert", {
      source: result.source,
      insertedLength: alreadyInserted.length,
      nextLength: normalizedText.length,
    });
    pushStep(steps, "insert", "skipped", "already inserted");
    return;
  }

  const startedAt = nowMs();
  try {
    dispatchSession({ type: "inserting", sessionId });
    await hideWindow();
    await sleep(insertDelayMs);
    const pasted = await pasteText(text);
    if (pasted) {
      guard.insertedText = normalizedText;
      pushStep(steps, "insert", "completed", undefined, durationSince(startedAt));
    } else {
      pushStep(steps, "insert", "failed", "paste returned false", durationSince(startedAt));
    }
  } catch (error) {
    console.error("[Transcription] Failed to insert text:", error);
    pushStep(
      steps,
      "insert",
      "failed",
      error instanceof Error ? error.message : String(error),
      durationSince(startedAt)
    );
  }
}

async function runHistorySaves({
  text,
  normalizedText,
  guard,
  steps,
  saveTranscription,
  skipHistory = false,
  historySkipReason = "privacy settings",
  saveOptions,
}: {
  text: string;
  normalizedText: string;
  guard: DictationCompletionGuard;
  steps: CompletionPipelineStep[];
  saveTranscription: (
    text: string,
    options?: CompletionSaveTranscriptionOptions
  ) => Promise<CompletionHistorySaveResult>;
  skipHistory?: boolean;
  historySkipReason?: string;
  saveOptions?: CompletionSaveTranscriptionOptions;
}): Promise<{ dbHistoryStatus: CompletionStepStatus; dbHistoryDetail?: string }> {
  if (skipHistory) {
    guard.savedTexts.add(normalizedText);
    pushStep(steps, "clipboard-history", "skipped", historySkipReason);
    pushStep(steps, "db-history", "skipped", historySkipReason);
    return { dbHistoryStatus: "skipped", dbHistoryDetail: historySkipReason };
  }

  if (guard.savedTexts.has(normalizedText)) {
    pushStep(steps, "clipboard-history", "skipped", "already saved");
    pushStep(steps, "db-history", "skipped", "already saved");
    return { dbHistoryStatus: "skipped", dbHistoryDetail: "already saved" };
  }

  const clipboardStartedAt = nowMs();
  try {
    saveToClipboardHistory(text);
    console.log("[Transcription] Saved to clipboard history");
    pushStep(steps, "clipboard-history", "completed", undefined, durationSince(clipboardStartedAt));
  } catch (error) {
    console.error("[Transcription] Failed to save to clipboard history:", error);
    pushStep(
      steps,
      "clipboard-history",
      "failed",
      error instanceof Error ? error.message : String(error),
      durationSince(clipboardStartedAt)
    );
  }

  const dbStartedAt = nowMs();
  try {
    const saved = await saveTranscription(text, saveOptions);
    const result = normalizeHistorySaveResult(saved);
    pushStep(steps, "db-history", result.status, result.detail, durationSince(dbStartedAt));
    if (result.status === "completed" || result.status === "skipped") {
      guard.savedTexts.add(normalizedText);
      return {
        dbHistoryStatus: result.status,
        dbHistoryDetail: result.detail,
      };
    }
    return { dbHistoryStatus: "failed", dbHistoryDetail: result.detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pushStep(steps, "db-history", "failed", detail, durationSince(dbStartedAt));
    return { dbHistoryStatus: "failed", dbHistoryDetail: detail };
  }
}

function stringifyMetadata(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeTranscriptionProviderId(value?: string | null): string | null {
  const candidate = String(value || "")
    .trim()
    .toLowerCase();
  if (!candidate) return null;

  return (
    KNOWN_TRANSCRIPTION_PROVIDER_IDS.find(
      (provider) => candidate === provider || candidate.startsWith(`${provider}-`)
    ) || null
  );
}

function buildCompletionSaveOptions(
  result: DictationCompletionInput,
  sessionId: string,
  text: string,
  normalizedText: string
): CompletionSaveTranscriptionOptions {
  const rawText = String(result.rawText || text);
  const pipelineNormalizedText = String(result.normalizedText || normalizedText);
  const processingMetadata = {
    source: result.source || "renderer",
    processingMode: result.processingMode ?? null,
    usedReasoning: !!result.usedReasoning,
    fallbackReason: result.fallbackReason ?? null,
    postProcessingSteps: result.postProcessingSteps || [],
    postProcessingTimings: result.postProcessingTimings || null,
    timings: result.timings || null,
  };

  const outputs: CompletionSaveTranscriptionOptions["outputs"] = [
    {
      stage: "pipeline",
      text,
      metadataJson: stringifyMetadata(processingMetadata),
    },
  ];

  if (
    pipelineNormalizedText &&
    pipelineNormalizedText !== rawText &&
    pipelineNormalizedText !== text
  ) {
    outputs.unshift({
      stage: "normalized",
      text: pipelineNormalizedText,
      metadataJson: null,
    });
  }

  return {
    rawText,
    processedText: text,
    method: result.processingMode || result.source || "dictation",
    sessionId,
    provider:
      normalizeTranscriptionProviderId(result.provider) ||
      normalizeTranscriptionProviderId(result.source),
    status: "completed",
    outputs,
  };
}

export async function runDictationCompletionPipeline({
  result,
  sessionId,
  guard,
  stopRequested,
  dispatchSession,
  setTranscript,
  setLiveTranscript,
  setAudioLevel,
  hideWindow,
  pasteText,
  saveTranscription,
  skipHistory = false,
  historySkipReason,
  insertDelayMs = DEFAULT_INSERT_DELAY_MS,
}: CompletionPipelineOptions): Promise<CompletionPipelineResult> {
  const steps: CompletionPipelineStep[] = [];
  const text = String(result.text || "");
  const normalizedText = text.trim();
  pushStep(steps, "normalize", "completed", `length=${normalizedText.length}`);

  if (!normalizedText) {
    dispatchSession({ type: "completed", sessionId, text: "" });
    return { status: "empty", text, normalizedText, steps };
  }

  const now = Date.now();
  if (guard.lastText === normalizedText && now - guard.lastAt < DUPLICATE_WINDOW_MS) {
    console.warn("[Transcription] Duplicate completion ignored", {
      source: result.source,
      length: normalizedText.length,
    });
    pushStep(steps, "dedupe", "skipped", "duplicate completion");
    return { status: "duplicate", text, normalizedText, steps };
  }

  guard.lastText = normalizedText;
  guard.lastAt = now;
  pushStep(steps, "dedupe", "completed");

  setTranscript(text);
  setLiveTranscript(text);
  setAudioLevel(0);
  if (skipHistory) {
    console.log("[Transcription] Complete, text redacted by privacy settings", {
      length: normalizedText.length,
    });
  } else {
    console.log("[Transcription] Complete", {
      length: normalizedText.length,
      source: result.source || "renderer",
    });
  }
  pushStep(steps, "ui", "completed");

  await runInsertion({
    text,
    normalizedText,
    result,
    guard,
    stopRequested,
    sessionId,
    steps,
    dispatchSession,
    hideWindow,
    pasteText,
    insertDelayMs,
  });

  const historyResult = await runHistorySaves({
    text,
    normalizedText,
    guard,
    steps,
    saveTranscription,
    skipHistory,
    historySkipReason,
    saveOptions: buildCompletionSaveOptions(result, sessionId, text, normalizedText),
  });

  if (historyResult.dbHistoryStatus === "failed") {
    const error = `Dictation history save failed: ${
      historyResult.dbHistoryDetail || "unknown error"
    }`;
    dispatchSession({ type: "failed", sessionId, error });
    return { status: "failed", text, normalizedText, steps, error };
  }

  dispatchSession({ type: "completed", sessionId, text });
  return { status: "completed", text, normalizedText, steps };
}
