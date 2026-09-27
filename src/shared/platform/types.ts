import type { ProcessingModeHotkeys } from "../../config/processingModeHotkeys";

export type PlatformUnlisten = () => void;
export type PlatformListenerCleanup = PlatformUnlisten | Promise<PlatformUnlisten> | void;

export type DictationPhase =
  | "idle"
  | "recording"
  | "transcribing"
  | "postprocessing"
  | "inserting"
  | "completed"
  | "failed";

export type BackendDictationStatePayload = {
  sessionId: string;
  phase: DictationPhase;
  isRecording: boolean;
  isProcessing: boolean;
  text?: string | null;
  error?: string | null;
  timelineEvents?: BackendTimelineEvent[];
  postProcessingSteps?: BackendPostprocessingStep[];
  postProcessingTimings?: BackendPostprocessingTimings | null;
  processingMode?: string | null;
  usedReasoning?: boolean | null;
  fallbackReason?: string | null;
};

export type BackendTimelineEvent = {
  kind:
    | "session"
    | "input"
    | "state"
    | "transcription"
    | "postprocessing"
    | "completion"
    | "insert"
    | "history"
    | "backend"
    | "error";
  label: string;
  status?: "started" | "completed" | "failed" | "skipped" | "cancelled" | "info";
  phase?: DictationPhase;
  source?: string;
  durationMs?: number;
  detail?: string;
  meta?: Record<string, unknown>;
  at?: string;
  elapsedMs?: number;
};

export type PersistedDictationTimelineEvent = {
  id: string;
  sessionId: string;
  at: string;
  elapsedMs: number;
  kind: BackendTimelineEvent["kind"];
  label: string;
  status: NonNullable<BackendTimelineEvent["status"]>;
  phase?: DictationPhase | null;
  source?: string | null;
  durationMs?: number | null;
  detail?: string | null;
  meta?: Record<string, unknown> | null;
};

export type PersistedDictationTimelineSession = {
  sessionId: string;
  source: string;
  startedAt: string;
  updatedAt: string;
  events: PersistedDictationTimelineEvent[];
};

export type BackendPostprocessingStep = {
  name: string;
  status: "completed" | "skipped" | "failed" | string;
  detail?: string;
  durationMs?: number;
};

export type BackendPostprocessingTimings = {
  vocabularyDurationMs?: number;
  promptBuildDurationMs?: number;
  reasoningDurationMs?: number;
};

export type BackendDictationSessionPayload = {
  sessionId: string;
};

export type RecordingOverlayState = "idle" | "recording" | "transcribing" | "processing";

export type TranscriptEventMode = "batch" | "streaming" | "realtime";

export type TranscriptEventPayload = {
  sessionId: string;
  provider: string;
  mode: TranscriptEventMode;
  text: string;
  isFinal: boolean;
  delta?: string | null;
  itemId?: string | null;
  audioMs?: number | null;
  definite: boolean;
};

export type VolcengineStreamingTranscriptPayload = TranscriptEventPayload & {
  provider: "volcengine";
  mode: "streaming";
};

export type OpenAIRealtimeTranscriptPayload = TranscriptEventPayload & {
  provider: "openai";
  mode: "realtime";
};

export type ForegroundApplication = {
  id: string;
  name: string;
  platform: string;
  processId?: number | null;
  bundleId?: string | null;
  executablePath?: string | null;
};

export type NativeRecordingCapabilities = {
  supported: boolean;
  platform: string;
  backend: string;
  status: string;
  reason?: string | null;
  active: boolean;
};

export type NativeRecordingResult = {
  audioData: Uint8Array;
  mimeType: string;
  durationSeconds: number | null;
};

export type CredentialStatus = {
  key: string;
  present: boolean;
};

export type ClipboardUpdatePayload = import("../../types/clipboard").ClipboardUpdatePayload;
export type PasteToolsResult = import("../../types/desktop").PasteToolsResult;
export type PrivacyDiagnostics = import("../../types/desktop").PrivacyDiagnostics;
export type TranscriptionItem = import("../../types/desktop").TranscriptionItem;

export type TranscriptionOutputInput = {
  stage: string;
  text: string;
  metadataJson?: string | null;
};

export type SaveTranscriptionOptions = {
  rawText?: string | null;
  processedText?: string | null;
  method?: string | null;
  agentName?: string | null;
  sessionId?: string | null;
  provider?: string | null;
  model?: string | null;
  language?: string | null;
  status?: string | null;
  error?: string | null;
  outputs?: TranscriptionOutputInput[];
};

export type TranscriptionOutput = {
  id: number;
  transcriptionId: number;
  sessionId?: string | null;
  stage: string;
  text: string;
  metadataJson?: string | null;
  createdAt: string;
};

export type TranscriptionSession = {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  provider?: string | null;
  model?: string | null;
  language?: string | null;
  status: string;
  error?: string | null;
};

export type TranscriptionProviderCapabilities = {
  supports_batch: boolean;
  supports_streaming: boolean;
  supports_realtime: boolean;
};

export type TranscriptionProvider = {
  id: string;
  name: string;
  requires_key: boolean;
  default_base_url?: string | null;
  supports_endpoint_override?: boolean;
  capabilities: TranscriptionProviderCapabilities;
};

export type LocalAsrRuntimeStatus = {
  available: boolean;
  runtime: string;
  modelReady: boolean;
  reason: string;
};
export type LocalModelRecord = import("../../models/ModelRegistry").ModelDefinition & {
  isDownloaded?: boolean;
  isDownloading?: boolean;
  downloadProgress?: number;
  downloaded?: boolean;
  modelPath?: string | null;
  projectorPath?: string | null;
  runtime?: string;
};

export type ModelCommandResult = {
  success: boolean;
  error?: string;
  message?: string;
  code?: string;
};

export type ModelDownloadProgressPayload = {
  modelId: string;
  progress: number;
  downloadedSize: number;
  totalSize: number;
};

export type LocalModelSelection = {
  modelId: string;
  modelPath: string;
  projectorPath: string;
  runtime: string;
  modelFamily: string;
};

export type UpdateFileInfo = Record<string, unknown>;

export type UpdateCheckResult = {
  updateAvailable: boolean;
  version?: string;
  releaseDate?: string;
  files?: UpdateFileInfo[];
  releaseNotes?: string | null;
  message?: string;
};

export type UpdateStatusResult = {
  updateAvailable: boolean;
  updateDownloaded: boolean;
  isDevelopment: boolean;
};

export type UpdateInfoResult = {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  files?: UpdateFileInfo[];
};

export type UpdateResult = {
  success: boolean;
  message: string;
};

export type AppVersionResult = {
  version: string;
};

export type UpdateDownloadProgressPayload = {
  percent: number;
  transferred?: number;
  total?: number;
};

export type CommandResult = {
  success: boolean;
  message?: string;
  error?: string;
};

export type RendererLogPayload = {
  level: string;
  message: string;
  meta?: unknown;
  scope?: string;
  source?: string;
};

export type DebugState = {
  enabled: boolean;
  logPath: string | null;
  logLevel: string;
};

export type DebugLoggingResult = CommandResult & {
  enabled?: boolean;
  logPath?: string | null;
};

export type DictationTriggerMode = "single" | "double";

export type DictationHotkeyPayload = {
  processingMode?: string | null;
};

export type HotkeyFallbackPayload = {
  message: string;
  hotkey?: string;
  requestedHotkey?: string;
};

export type HotkeyRegistrationFailedPayload = {
  message?: string;
  hotkey?: string;
};

export type AppCleanupResult = {
  success: boolean;
  message: string;
  error?: string;
};

export type NativeReasoningResult = {
  success: boolean;
  text?: string;
  error?: string;
};

export type NativeReasoningConfig = {
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
  promptContext?: unknown;
  systemPrompt?: string;
  userPrompt?: string;
};

export type HistoryCommandResult = {
  success: boolean;
  error?: string;
  message?: string;
  cleared?: number;
  deleted?: number;
};

export type HistorySaveResult = HistoryCommandResult & {
  id?: number;
  skipped?: boolean;
  reason?: "unavailable" | "privacy" | "no-row-id" | "command-error";
};

export type HistoryDeletedPayload = {
  id: number;
};

export type HistoryPrunedPayload = {
  deleted: number;
  sessionsDeleted?: number;
  timelineSessionsDeleted?: number;
  retentionDays: number;
};

export type PlatformBridge = {
  runtime: {
    isTauri: () => boolean;
    getPlatform: () => Promise<string>;
  };
  window: {
    show: () => Promise<void>;
    hide: () => Promise<void>;
    showDictationPanel: () => Promise<void>;
    showControlPanel: () => Promise<void>;
    startDrag: () => Promise<void>;
    stopDrag: () => Promise<void>;
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    setMainWindowInteractivity: (interactive: boolean) => Promise<void>;
  };
  clipboard: {
    pasteText: (text: string) => Promise<void>;
    pasteImage: (imageSource: string) => Promise<void>;
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
    writeImage: (imageSource: string) => Promise<void>;
    storeImage: (
      imageSource: string,
      id?: string,
      tsMs?: number
    ) => Promise<ClipboardUpdatePayload | null>;
    deleteImageFiles: (paths: string[]) => Promise<number>;
    resolveFileAssetSrc: (source: string) => string;
    onUpdate: (callback: (payload: ClipboardUpdatePayload) => void) => PlatformListenerCleanup;
  };
  settings: {
    get: <T>(key: string) => Promise<T | null>;
    set: <T>(key: string, value: T) => Promise<void>;
  };
  secrets: {
    get: (key: string) => Promise<string | null>;
    status: (key: string) => Promise<CredentialStatus>;
    set: (key: string, value: string) => Promise<void>;
    saveAll: () => Promise<CommandResult>;
  };
  permissions: {
    openMicrophoneSettings: () => Promise<CommandResult>;
    openSoundInputSettings: () => Promise<CommandResult>;
    openAccessibilitySettings: () => Promise<CommandResult>;
    checkPasteTools: () => Promise<PasteToolsResult | null>;
    checkAccessibility: (prompt?: boolean) => Promise<boolean>;
  };
  logging: {
    getLevel: () => Promise<string>;
    write: (payload: RendererLogPayload) => Promise<void>;
  };
  debug: {
    getState: () => Promise<DebugState>;
    setLogging: (enabled: boolean) => Promise<DebugLoggingResult>;
    openLogsFolder: () => Promise<CommandResult>;
    getPrivacyDiagnostics: () => Promise<PrivacyDiagnostics>;
  };
  transcription: {
    getProviders: () => Promise<TranscriptionProvider[]>;
    transcribeAudio: (
      audioData: Uint8Array,
      provider: string,
      model?: string,
      language?: string,
      sessionId?: string | null,
      endpointOverride?: string | null
    ) => Promise<string>;
    transcribeLocalAudio: (
      audioData: Uint8Array,
      model?: string,
      language?: string,
      sessionId?: string | null
    ) => Promise<string>;
    checkLocalAsrRuntime: () => Promise<LocalAsrRuntimeStatus>;
    onTranscriptEvent: (
      callback: (payload: TranscriptEventPayload) => void
    ) => PlatformListenerCleanup;
    volcengine: {
      startStreaming: (
        appId: string,
        accessToken: string,
        resourceId?: string,
        model?: string,
        language?: string
      ) => Promise<string>;
      sendAudio: (sessionId: string, audioData: Uint8Array) => Promise<void>;
      finish: (sessionId: string) => Promise<string>;
      cancel: (sessionId: string) => Promise<void>;
      onTranscript: (
        callback: (payload: VolcengineStreamingTranscriptPayload) => void
      ) => PlatformListenerCleanup;
    };
    openAIRealtime: {
      start: (apiKey: string, model?: string, language?: string, delay?: string) => Promise<string>;
      sendAudio: (sessionId: string, audioData: Uint8Array) => Promise<void>;
      finish: (sessionId: string) => Promise<string>;
      cancel: (sessionId: string) => Promise<void>;
      onTranscript: (
        callback: (payload: OpenAIRealtimeTranscriptPayload) => void
      ) => PlatformListenerCleanup;
    };
  };
  history: {
    saveTranscription: (
      text: string,
      processed?: string,
      method?: string,
      agentName?: string,
      options?: SaveTranscriptionOptions
    ) => Promise<HistorySaveResult>;
    getTranscriptions: (limit?: number) => Promise<TranscriptionItem[]>;
    searchTranscriptions: (query: string, limit?: number) => Promise<TranscriptionItem[]>;
    getTranscriptionOutputs: (transcriptionId: number) => Promise<TranscriptionOutput[]>;
    getTranscriptionSession: (sessionId: string) => Promise<TranscriptionSession | null>;
    saveDictationTimelineEvents: (
      sessionId: string,
      source: string,
      events: BackendTimelineEvent[]
    ) => Promise<HistoryCommandResult>;
    getDictationTimelineSessions: (limit?: number) => Promise<PersistedDictationTimelineSession[]>;
    deleteTranscription: (id: number) => Promise<HistoryCommandResult>;
    deleteTranscriptions: (id: number) => Promise<HistoryCommandResult>;
    clearTranscriptions: () => Promise<HistoryCommandResult>;
    pruneTranscriptionHistory: () => Promise<HistoryCommandResult>;
    onAdded: (callback: (item: TranscriptionItem) => void) => PlatformListenerCleanup;
    onDeleted: (callback: (payload: HistoryDeletedPayload) => void) => PlatformListenerCleanup;
    onCleared: (callback: () => void) => PlatformListenerCleanup;
    onPruned: (callback: (payload: HistoryPrunedPayload) => void) => PlatformListenerCleanup;
  };
  recording: {
    getNativeCapabilities: () => Promise<NativeRecordingCapabilities>;
    startNative: () => Promise<boolean>;
    stopNative: () => Promise<NativeRecordingResult | null>;
    cancelNative: () => Promise<boolean>;
    startAudioDucking: () => Promise<boolean>;
    stopAudioDucking: () => Promise<boolean>;
  };
  models: {
    getAll: () => Promise<LocalModelRecord[]>;
    check: (modelId: string) => Promise<boolean>;
    download: (modelId: string) => Promise<ModelCommandResult>;
    delete: (modelId: string) => Promise<void>;
    deleteAll: () => Promise<ModelCommandResult>;
    checkRuntime: () => Promise<boolean>;
    cancelDownload: (modelId: string) => Promise<ModelCommandResult>;
    select: (modelId: string) => Promise<LocalModelSelection>;
    onDownloadProgress: (
      callback: (payload: ModelDownloadProgressPayload) => void
    ) => PlatformListenerCleanup;
  };
  updater: {
    checkForUpdates: () => Promise<UpdateCheckResult>;
    downloadUpdate: () => Promise<UpdateResult>;
    installUpdate: () => Promise<UpdateResult>;
    getAppVersion: () => Promise<AppVersionResult>;
    getStatus: () => Promise<UpdateStatusResult>;
    getInfo: () => Promise<UpdateInfoResult | null>;
    onAvailable: (callback: (info: UpdateInfoResult | null) => void) => PlatformListenerCleanup;
    onNotAvailable: (callback: (info: UpdateInfoResult | null) => void) => PlatformListenerCleanup;
    onDownloaded: (callback: (info: UpdateInfoResult | null) => void) => PlatformListenerCleanup;
    onDownloadProgress: (
      callback: (payload: UpdateDownloadProgressPayload) => void
    ) => PlatformListenerCleanup;
    onError: (callback: (error: unknown) => void) => PlatformListenerCleanup;
  };
  hotkeys: {
    updateDictation: (hotkey: string) => Promise<CommandResult>;
    updateClipboard: (hotkey: string) => Promise<CommandResult>;
    updateDictationTriggerMode: (mode: DictationTriggerMode) => Promise<CommandResult>;
    updateProcessingModeHotkeys: (hotkeys: ProcessingModeHotkeys) => Promise<CommandResult>;
    setListeningMode: (enabled: boolean) => Promise<void>;
    onFallbackUsed: (callback: (payload: HotkeyFallbackPayload) => void) => PlatformListenerCleanup;
    onRegistrationFailed: (
      callback: (payload: HotkeyRegistrationFailedPayload) => void
    ) => PlatformListenerCleanup;
    onGlobeKeyPressed: (callback: () => void) => PlatformListenerCleanup;
  };
  reasoning: {
    processAnthropic: (
      text: string,
      modelId: string,
      agentName: string | null,
      config: NativeReasoningConfig
    ) => Promise<NativeReasoningResult>;
    processLocal: (
      text: string,
      modelId: string,
      agentName: string | null,
      config: NativeReasoningConfig
    ) => Promise<NativeReasoningResult>;
    checkLocalAvailable: () => Promise<boolean>;
  };
  events: {
    onToggleDictation: (
      callback: (payload?: DictationHotkeyPayload) => void
    ) => PlatformListenerCleanup;
    onStartDictation: (
      callback: (payload?: DictationHotkeyPayload) => void
    ) => PlatformListenerCleanup;
    onStopDictation: (
      callback: (payload?: DictationHotkeyPayload) => void
    ) => PlatformListenerCleanup;
    onShowOverlay: (callback: (state: RecordingOverlayState) => void) => PlatformListenerCleanup;
    onHideOverlay: (callback: () => void) => PlatformListenerCleanup;
    onOpenClipboardPanel: (callback: () => void) => PlatformListenerCleanup;
    onOpenControlPanel: (callback: () => void) => PlatformListenerCleanup;
    onBackendDictationState: (
      callback: (payload: BackendDictationStatePayload) => void
    ) => PlatformListenerCleanup;
    onBackendDictationStartFeedback: (
      callback: (payload: BackendDictationSessionPayload) => void
    ) => PlatformListenerCleanup;
    onBackendDictationRecording: (
      callback: (isRecording: boolean) => void
    ) => PlatformListenerCleanup;
    onBackendDictationError: (callback: () => void) => PlatformListenerCleanup;
    onNoAudioDetected: (callback: () => void) => PlatformListenerCleanup;
  };
  app: {
    quit: () => Promise<void>;
    openExternal: (url: string) => Promise<{ success: boolean; error?: string } | void>;
    getForegroundApplication: () => Promise<ForegroundApplication | null>;
    syncForegroundApplicationVocabulary: () => Promise<ForegroundApplication | null>;
    getAutoStartEnabled: () => Promise<boolean>;
    setAutoStartEnabled: (enabled: boolean) => Promise<CommandResult>;
    cleanup: () => Promise<AppCleanupResult>;
    openAccessibilitySettings: () => Promise<CommandResult>;
  };
};
