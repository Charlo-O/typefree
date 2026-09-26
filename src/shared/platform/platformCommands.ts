export { normalizeCommandError, TauriCommandError } from "./commandCore";
export type { CommandErrorKind, CommandErrorPayload } from "./commandCore";

export {
  checkAccessibilityPermission,
  checkPasteTools,
  deleteClipboardImageFiles,
  pasteImage,
  pasteText,
  readClipboard,
  resolveFileAssetSrc,
  storeClipboardImage,
  writeClipboard,
  writeClipboardImage,
} from "./clipboardCommands";

export type {
  BackendDictationStatePayload,
  BackendDictationSessionPayload,
  DictationPhase,
  OpenAIRealtimeTranscriptPayload,
  TranscriptEventPayload,
  VolcengineStreamingTranscriptPayload,
} from "./eventCommands";
export {
  OPENAI_REALTIME_TRANSCRIPT_EVENT_NAME,
  TRANSCRIPT_EVENT_NAME,
  VOLCENGINE_STREAMING_TRANSCRIPT_EVENT_NAME,
  onBackendDictationStartFeedback,
  onBackendDictationState,
  onBackendDictationError,
  onBackendDictationRecording,
  onClipboardUpdate,
  onHideOverlay,
  onOpenClipboardPanel,
  onOpenControlPanel,
  onOpenAIRealtimeTranscript,
  onShowOverlay,
  onStartDictation,
  onStopDictation,
  onToggleDictation,
  onTranscriptEvent,
  onTranscriptionAdded,
  onTranscriptionDeleted,
  onTranscriptionsCleared,
  onTranscriptionsPruned,
  onVolcengineStreamingTranscript,
} from "./eventCommands";

export {
  setHotkeyListeningMode,
  updateClipboardHotkey,
  updateDictationTriggerMode,
  updateProcessingModeHotkeys,
  updateHotkey,
} from "./hotkeyCommands";

export {
  clearTranscriptions,
  deleteTranscription,
  deleteTranscriptions,
  getDictationTimelineSessions,
  getTranscriptionOutputs,
  getTranscriptionSession,
  getTranscriptions,
  pruneTranscriptionHistory,
  saveDictationTimelineEvents,
  saveTranscription,
  searchTranscriptions,
} from "./historyCommands";

export {
  modelCancelDownload,
  modelCheck,
  modelCheckRuntime,
  modelDelete,
  modelDeleteAll,
  modelDownload,
  modelGetAll,
  onModelDownloadProgress,
} from "./modelCompatibilityCommands";

export {
  getForegroundApplication,
  getPrivacyDiagnostics,
  syncForegroundApplicationVocabulary,
} from "./privacyCommands";

export {
  cancelNativeRecording,
  getNativeRecordingCapabilities,
  startAudioDucking,
  startNativeRecording,
  stopAudioDucking,
  stopNativeRecording,
} from "./recordingCommands";

export {
  checkLocalReasoningAvailable,
  processAnthropicReasoning,
  processLocalReasoning,
} from "./reasoningCommands";

export {
  deleteCredential,
  getAllSettings,
  getAnthropicKey,
  getAssemblyAIKey,
  getCredential,
  getCredentialStatus,
  getDebugState,
  getEnvVar,
  getGeminiKey,
  getGroqKey,
  getLogLevel,
  getOpenAIKey,
  getSetting,
  getVolcengineAccessToken,
  getVolcengineAppId,
  getVolcengineResourceId,
  getZaiKey,
  log,
  openLogsFolder,
  saveAllKeysToEnv,
  saveAnthropicKey,
  saveAssemblyAIKey,
  saveGeminiKey,
  saveGroqKey,
  saveOpenAIKey,
  saveVolcengineAccessToken,
  saveVolcengineAppId,
  saveVolcengineResourceId,
  saveZaiKey,
  setCredential,
  setDebugLogging,
  setEnvVar,
  setSetting,
} from "./settingsCommands";

export {
  cancelOpenAIRealtimeTranscription,
  cancelVolcengineStreamingTranscription,
  checkLocalAsrRuntime,
  finishOpenAIRealtimeTranscription,
  finishVolcengineStreamingTranscription,
  getTranscriptionProviders,
  sendOpenAIRealtimeAudio,
  sendVolcengineStreamingAudio,
  startOpenAIRealtimeTranscription,
  startVolcengineStreamingTranscription,
  transcribeAudio,
  transcribeLocalAudio,
} from "./transcriptionCommands";

export {
  checkForUpdates,
  downloadUpdate,
  getAppVersion,
  getUpdateInfo,
  getUpdateStatus,
  installUpdate,
  onUpdateAvailable,
  onUpdateDownloaded,
  onUpdateDownloadProgress,
  onUpdateError,
  onUpdateNotAvailable,
} from "./updaterCommands";

export {
  appQuit,
  cleanupApp,
  getAutoStartEnabled,
  getPlatform,
  hideWindow,
  openAccessibilitySettings,
  openExternal,
  openMicrophoneSettings,
  openSoundInputSettings,
  setAutoStartEnabled,
  setMainWindowInteractivity,
  showControlPanel,
  showDictationPanel,
  showWindow,
  startWindowDrag,
  stopWindowDrag,
  windowClose,
  windowIsMaximized,
  windowMaximize,
  windowMinimize,
} from "./windowCommands";

export type * from "./types";
