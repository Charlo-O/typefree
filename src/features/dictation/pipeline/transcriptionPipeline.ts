import {
  buildModeSystemPrompt,
  getSelectedProcessingMode,
  type ProcessingModeDefinition,
} from "../../../config/processingModes";
import { capturePromptContext, type PromptRuntimeContext } from "../../../config/promptContext";
import { readAppSetting } from "../../settings/schema/settingsSchema";
import logger from "../../../utils/logger";
import { applySnippetReplacements } from "../../../utils/vocabulary";

type PipelineStepName =
  | "normalize"
  | "vocabulary"
  | "mode"
  | "prompt-context"
  | "prompt"
  | "reasoning";
type PipelineStepStatus = "completed" | "skipped" | "failed";

export interface TranscriptionPipelineStep {
  name: PipelineStepName;
  status: PipelineStepStatus;
  detail?: string;
  durationMs?: number;
}

export interface TranscriptionPostProcessingResult {
  text: string;
  rawText: string;
  normalizedText: string;
  usedReasoning: boolean;
  processingMode: ProcessingModeDefinition["id"];
  fallbackReason?: string;
  steps: TranscriptionPipelineStep[];
  timings: {
    vocabularyDurationMs: number;
    promptContextDurationMs?: number;
    promptBuildDurationMs?: number;
    reasoningDurationMs?: number;
  };
}

interface TranscriptionPostProcessingPipelineInput {
  text: unknown;
  source: string;
  isReasoningAvailable: () => Promise<boolean>;
  processWithReasoningModel: (
    text: string,
    model: string,
    agentName: string | null,
    config: {
      promptContext: PromptRuntimeContext;
      systemPrompt: string;
    }
  ) => Promise<string>;
  captureRuntimePromptContext?: () => Promise<PromptRuntimeContext>;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function durationSince(startedAt: number): number {
  return Math.round(nowMs() - startedAt);
}

function readRawStorageValue(key: string, fallback = ""): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return fallback;
  }

  return window.localStorage.getItem(key) || fallback;
}

function preview(text: string): string {
  return text.substring(0, 100) + (text.length > 100 ? "..." : "");
}

function createSkippedResult(
  rawText: string,
  normalizedText: string,
  processingMode: ProcessingModeDefinition,
  steps: TranscriptionPipelineStep[],
  timings: TranscriptionPostProcessingResult["timings"],
  fallbackReason: string
): TranscriptionPostProcessingResult {
  return {
    text: normalizedText,
    rawText,
    normalizedText,
    usedReasoning: false,
    processingMode: processingMode.id,
    fallbackReason,
    steps,
    timings,
  };
}

export async function runTranscriptionPostProcessingPipeline({
  text,
  source,
  isReasoningAvailable,
  processWithReasoningModel,
  captureRuntimePromptContext = capturePromptContext,
}: TranscriptionPostProcessingPipelineInput): Promise<TranscriptionPostProcessingResult> {
  const rawText = typeof text === "string" ? text.trim() : "";
  const steps: TranscriptionPipelineStep[] = [
    { name: "normalize", status: "completed", detail: `inputLength=${rawText.length}` },
  ];

  const vocabularyStartedAt = nowMs();
  const normalizedText = applySnippetReplacements(rawText).trim();
  const timings: TranscriptionPostProcessingResult["timings"] = {
    vocabularyDurationMs: durationSince(vocabularyStartedAt),
  };
  steps.push({
    name: "vocabulary",
    status: "completed",
    detail:
      normalizedText === rawText
        ? "unchanged"
        : `changedLength=${rawText.length}->${normalizedText.length}`,
    durationMs: timings.vocabularyDurationMs,
  });

  const processingMode = getSelectedProcessingMode();
  steps.push({
    name: "mode",
    status: "completed",
    detail: processingMode.id,
  });

  logger.logReasoning("TRANSCRIPTION_PIPELINE_RECEIVED", {
    source,
    textLength: normalizedText.length,
    textPreview: preview(normalizedText),
    processingMode: processingMode.id,
    timestamp: new Date().toISOString(),
  });

  if (!processingMode.requiresReasoning) {
    steps.push({
      name: "reasoning",
      status: "skipped",
      detail: "processing mode does not require reasoning",
    });
    logger.logReasoning("REASONING_SKIPPED", {
      reason: "Processing mode does not require reasoning",
      processingMode: processingMode.id,
    });
    return createSkippedResult(
      rawText,
      normalizedText,
      processingMode,
      steps,
      timings,
      "processing-mode"
    );
  }

  const reasoningModel = readAppSetting("reasoningModel");
  const reasoningProvider = readAppSetting("reasoningProvider");
  const agentName = readRawStorageValue("agentName") || null;

  if (!reasoningModel) {
    steps.push({
      name: "reasoning",
      status: "skipped",
      detail: "no reasoning model selected",
    });
    logger.logReasoning("REASONING_SKIPPED", {
      reason: "No reasoning model selected",
    });
    return createSkippedResult(
      rawText,
      normalizedText,
      processingMode,
      steps,
      timings,
      "missing-model"
    );
  }

  const useReasoning = await isReasoningAvailable();

  logger.logReasoning("REASONING_CHECK", {
    useReasoning,
    reasoningModel,
    reasoningProvider,
    agentName,
    processingMode: processingMode.id,
  });

  if (!useReasoning) {
    steps.push({
      name: "reasoning",
      status: "skipped",
      detail: "reasoning unavailable",
    });
    logger.logReasoning("USING_STANDARD_CLEANUP", {
      reason: "Reasoning not enabled",
    });
    return createSkippedResult(
      rawText,
      normalizedText,
      processingMode,
      steps,
      timings,
      "reasoning-unavailable"
    );
  }

  try {
    const promptContextStartedAt = nowMs();
    const promptContext = await captureRuntimePromptContext();
    timings.promptContextDurationMs = durationSince(promptContextStartedAt);
    steps.push({
      name: "prompt-context",
      status: "completed",
      durationMs: timings.promptContextDurationMs,
    });

    const promptStartedAt = nowMs();
    const systemPrompt = buildModeSystemPrompt(processingMode, agentName, promptContext);
    timings.promptBuildDurationMs = durationSince(promptStartedAt);
    steps.push({
      name: "prompt",
      status: "completed",
      detail: processingMode.id,
      durationMs: timings.promptBuildDurationMs,
    });

    logger.logReasoning("SENDING_TO_REASONING", {
      preparedTextLength: normalizedText.length,
      model: reasoningModel,
      provider: reasoningProvider,
      processingMode: processingMode.id,
    });

    const reasoningStartedAt = nowMs();
    const result = await processWithReasoningModel(normalizedText, reasoningModel, agentName, {
      promptContext,
      systemPrompt,
    });
    timings.reasoningDurationMs = durationSince(reasoningStartedAt);
    steps.push({
      name: "reasoning",
      status: "completed",
      durationMs: timings.reasoningDurationMs,
    });

    logger.logReasoning("REASONING_SUCCESS", {
      resultLength: result.length,
      resultPreview: preview(result),
      processingTime: new Date().toISOString(),
    });

    return {
      text: result,
      rawText,
      normalizedText,
      usedReasoning: true,
      processingMode: processingMode.id,
      steps,
      timings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({
      name: "reasoning",
      status: "failed",
      detail: message,
    });
    logger.logReasoning("REASONING_FAILED", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      fallbackToCleanup: true,
    });
    console.error(`Reasoning failed (${source}):`, message);
  }

  logger.logReasoning("USING_STANDARD_CLEANUP", {
    reason: "Reasoning failed",
  });

  return createSkippedResult(
    rawText,
    normalizedText,
    processingMode,
    steps,
    timings,
    "reasoning-failed"
  );
}
