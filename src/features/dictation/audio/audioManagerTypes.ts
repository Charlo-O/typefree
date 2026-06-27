import type { ProcessingModeId } from "../../../config/processingModes";
import type { PlatformBridge, SaveTranscriptionOptions } from "../../../shared/platform";
import type {
  CompletionHistorySaveResult,
  CompletionSaveTranscriptionOptions,
  DictationCompletionInput,
} from "../pipeline/completionPipeline";
import type { TranscriptionPipelineStep } from "../pipeline/transcriptionPipeline";

export type AudioManagerState = {
  isRecording: boolean;
  isProcessing: boolean;
  isStarting?: boolean;
};

export type AudioManagerError = {
  title?: string;
  description?: string;
};

export type AudioManagerLiveTranscriptPayload = {
  provider?: string;
  text?: unknown;
  delta?: string | null;
  isFinal?: boolean;
  audioMs?: number | null;
  definite?: boolean;
  itemId?: string | null;
};

export type AudioManagerTranscriptionTimings = {
  transcriptionProcessingDurationMs?: number;
  reasoningProcessingDurationMs?: number;
};

export type AudioManagerTranscriptionResult = DictationCompletionInput & {
  error?: string;
  timings?: AudioManagerTranscriptionTimings;
  postProcessingSteps?: TranscriptionPipelineStep[];
  postProcessingTimings?: Record<string, number> | null;
  processingMode?: ProcessingModeId | string | null;
  usedReasoning?: boolean;
  fallbackReason?: string | null;
};

export type AudioManagerCallbacks = {
  onStateChange: (state: AudioManagerState) => void;
  onError: (error: AudioManagerError) => void;
  onTranscriptionComplete: (result: AudioManagerTranscriptionResult) => void | Promise<void>;
  onLiveTranscript: (result?: AudioManagerLiveTranscriptPayload | null) => void;
  onAudioLevel: (level: number) => void;
  getSessionId?: (source?: string) => string | null;
};

export type AudioManagerFacade = {
  setCallbacks: (callbacks: AudioManagerCallbacks) => void;
  getState: () => AudioManagerState;
  startRecording: () => boolean | Promise<boolean>;
  stopRecording: () => boolean | Promise<boolean>;
  requestStop?: () => boolean | Promise<boolean>;
  cancelRecording: () => boolean | Promise<boolean>;
  safePaste: (text: string) => Promise<boolean>;
  saveTranscription: (
    text: string,
    options?: CompletionSaveTranscriptionOptions | SaveTranscriptionOptions
  ) => Promise<CompletionHistorySaveResult>;
  cleanup: () => void;
};

export type AudioManagerConstructor = new (platformBridge: PlatformBridge) => AudioManagerFacade;
