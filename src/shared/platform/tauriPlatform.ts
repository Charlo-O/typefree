import * as tauri from "./platformCommands";
import { hasTauriRuntime } from "./commandCore";
import type {
  BackendDictationStatePayload,
  CommandResult,
  DictationTriggerMode,
  HotkeyFallbackPayload,
  HotkeyRegistrationFailedPayload,
  ModelDownloadProgressPayload,
  PlatformBridge,
  RecordingOverlayState,
  UpdateDownloadProgressPayload,
  UpdateInfoResult,
} from "./types";

const noopUnlisten = () => {};

const browserHotkeyResult: CommandResult = { success: true };

function runHotkeyRegistration(action: () => Promise<CommandResult>): Promise<CommandResult> {
  if (!hasTauriRuntime()) {
    return Promise.resolve(browserHotkeyResult);
  }

  return action();
}

export const tauriPlatform: PlatformBridge = {
  runtime: {
    isTauri: hasTauriRuntime,
    getPlatform: tauri.getPlatform,
  },
  window: {
    show: tauri.showWindow,
    hide: tauri.hideWindow,
    showDictationPanel: tauri.showDictationPanel,
    showControlPanel: tauri.showControlPanel,
    startDrag: tauri.startWindowDrag,
    stopDrag: tauri.stopWindowDrag,
    minimize: tauri.windowMinimize,
    maximize: tauri.windowMaximize,
    close: tauri.windowClose,
    isMaximized: tauri.windowIsMaximized,
    setMainWindowInteractivity: tauri.setMainWindowInteractivity,
  },
  clipboard: {
    pasteText: tauri.pasteText,
    pasteImage: tauri.pasteImage,
    readText: tauri.readClipboard,
    writeText: tauri.writeClipboard,
    writeImage: tauri.writeClipboardImage,
    storeImage: tauri.storeClipboardImage,
    deleteImageFiles: tauri.deleteClipboardImageFiles,
    resolveFileAssetSrc: tauri.resolveFileAssetSrc,
    onUpdate: tauri.onClipboardUpdate,
  },
  settings: {
    get: tauri.getSetting,
    set: tauri.setSetting,
  },
  secrets: {
    get: tauri.getCredential,
    status: tauri.getCredentialStatus,
    set: tauri.setCredential,
    saveAll: tauri.saveAllKeysToEnv,
  },
  permissions: {
    openMicrophoneSettings: tauri.openMicrophoneSettings,
    openSoundInputSettings: tauri.openSoundInputSettings,
    openAccessibilitySettings: tauri.openAccessibilitySettings,
    checkPasteTools: tauri.checkPasteTools,
    checkAccessibility: tauri.checkAccessibilityPermission,
  },
  logging: {
    getLevel: tauri.getLogLevel,
    write: tauri.log,
  },
  debug: {
    getState: tauri.getDebugState,
    setLogging: tauri.setDebugLogging,
    openLogsFolder: tauri.openLogsFolder,
    getPrivacyDiagnostics: tauri.getPrivacyDiagnostics,
  },
  transcription: {
    getProviders: tauri.getTranscriptionProviders,
    transcribeAudio: tauri.transcribeAudio,
    transcribeLocalAudio: tauri.transcribeLocalAudio,
    checkLocalAsrRuntime: tauri.checkLocalAsrRuntime,
    onTranscriptEvent: tauri.onTranscriptEvent,
    volcengine: {
      startStreaming: tauri.startVolcengineStreamingTranscription,
      sendAudio: tauri.sendVolcengineStreamingAudio,
      finish: tauri.finishVolcengineStreamingTranscription,
      cancel: tauri.cancelVolcengineStreamingTranscription,
      onTranscript: tauri.onVolcengineStreamingTranscript,
    },
    openAIRealtime: {
      start: tauri.startOpenAIRealtimeTranscription,
      sendAudio: tauri.sendOpenAIRealtimeAudio,
      finish: tauri.finishOpenAIRealtimeTranscription,
      cancel: tauri.cancelOpenAIRealtimeTranscription,
      onTranscript: tauri.onOpenAIRealtimeTranscript,
    },
  },
  history: {
    saveTranscription: tauri.saveTranscription,
    getTranscriptions: tauri.getTranscriptions,
    searchTranscriptions: tauri.searchTranscriptions,
    getTranscriptionOutputs: tauri.getTranscriptionOutputs,
    getTranscriptionSession: tauri.getTranscriptionSession,
    saveDictationTimelineEvents: tauri.saveDictationTimelineEvents,
    getDictationTimelineSessions: tauri.getDictationTimelineSessions,
    deleteTranscription: tauri.deleteTranscription,
    deleteTranscriptions: tauri.deleteTranscriptions,
    clearTranscriptions: tauri.clearTranscriptions,
    pruneTranscriptionHistory: tauri.pruneTranscriptionHistory,
    onAdded: tauri.onTranscriptionAdded,
    onDeleted: tauri.onTranscriptionDeleted,
    onCleared: tauri.onTranscriptionsCleared,
    onPruned: tauri.onTranscriptionsPruned,
  },
  recording: {
    getNativeCapabilities: tauri.getNativeRecordingCapabilities,
    startNative: tauri.startNativeRecording,
    stopNative: tauri.stopNativeRecording,
    cancelNative: tauri.cancelNativeRecording,
    startAudioDucking: tauri.startAudioDucking,
    stopAudioDucking: tauri.stopAudioDucking,
  },
  models: {
    getAll: tauri.modelGetAll,
    check: tauri.modelCheck,
    download: tauri.modelDownload,
    delete: tauri.modelDelete,
    deleteAll: tauri.modelDeleteAll,
    checkRuntime: tauri.modelCheckRuntime,
    cancelDownload: tauri.modelCancelDownload,
    select: tauri.modelSelect,
    onDownloadProgress: (callback: (payload: ModelDownloadProgressPayload) => void) =>
      tauri.onModelDownloadProgress((_event, data) =>
        callback(data as ModelDownloadProgressPayload)
      ),
  },
  updater: {
    checkForUpdates: tauri.checkForUpdates,
    downloadUpdate: tauri.downloadUpdate,
    installUpdate: tauri.installUpdate,
    getAppVersion: tauri.getAppVersion,
    getStatus: tauri.getUpdateStatus,
    getInfo: tauri.getUpdateInfo,
    onAvailable: (callback: (info: UpdateInfoResult | null) => void) =>
      tauri.onUpdateAvailable((_event, info) => callback((info as UpdateInfoResult) ?? null)),
    onNotAvailable: (callback: (info: UpdateInfoResult | null) => void) =>
      tauri.onUpdateNotAvailable((_event, info) => callback((info as UpdateInfoResult) ?? null)),
    onDownloaded: (callback: (info: UpdateInfoResult | null) => void) =>
      tauri.onUpdateDownloaded((_event, info) => callback((info as UpdateInfoResult) ?? null)),
    onDownloadProgress: (callback: (payload: UpdateDownloadProgressPayload) => void) =>
      tauri.onUpdateDownloadProgress((_event, payload) =>
        callback((payload as UpdateDownloadProgressPayload) ?? { percent: 0 })
      ),
    onError: (callback: (error: unknown) => void) =>
      tauri.onUpdateError((_event, error) => callback(error)),
  },
  hotkeys: {
    updateDictation: (hotkey: string) => runHotkeyRegistration(() => tauri.updateHotkey(hotkey)),
    updateClipboard: (hotkey: string) =>
      runHotkeyRegistration(() => tauri.updateClipboardHotkey(hotkey)),
    updateDictationTriggerMode: (mode: DictationTriggerMode) =>
      runHotkeyRegistration(() => tauri.updateDictationTriggerMode(mode)),
    updateProcessingModeHotkeys: (hotkeys) =>
      runHotkeyRegistration(() => tauri.updateProcessingModeHotkeys(hotkeys)),
    setListeningMode: tauri.setHotkeyListeningMode,
    onFallbackUsed: (_callback: (payload: HotkeyFallbackPayload) => void) => noopUnlisten,
    onRegistrationFailed: (_callback: (payload: HotkeyRegistrationFailedPayload) => void) =>
      noopUnlisten,
    onGlobeKeyPressed: (_callback: () => void) => noopUnlisten,
  },
  reasoning: {
    processAnthropic: tauri.processAnthropicReasoning,
    processLocal: tauri.processLocalReasoning,
    checkLocalAvailable: tauri.checkLocalReasoningAvailable,
  },
  events: {
    onToggleDictation: tauri.onToggleDictation,
    onStartDictation: tauri.onStartDictation,
    onStopDictation: tauri.onStopDictation,
    onShowOverlay: (callback: (state: RecordingOverlayState) => void) =>
      tauri.onShowOverlay(callback),
    onHideOverlay: tauri.onHideOverlay,
    onOpenClipboardPanel: tauri.onOpenClipboardPanel,
    onOpenControlPanel: tauri.onOpenControlPanel,
    onBackendDictationState: (callback: (payload: BackendDictationStatePayload) => void) =>
      tauri.onBackendDictationState(callback),
    onBackendDictationStartFeedback: tauri.onBackendDictationStartFeedback,
    onBackendDictationRecording: tauri.onBackendDictationRecording,
    onBackendDictationError: tauri.onBackendDictationError,
    onNoAudioDetected: (_callback: () => void) => noopUnlisten,
  },
  app: {
    quit: tauri.appQuit,
    openExternal: tauri.openExternal,
    getForegroundApplication: tauri.getForegroundApplication,
    syncForegroundApplicationVocabulary: tauri.syncForegroundApplicationVocabulary,
    getAutoStartEnabled: tauri.getAutoStartEnabled,
    setAutoStartEnabled: tauri.setAutoStartEnabled,
    cleanup: tauri.cleanupApp,
    openAccessibilitySettings: tauri.openAccessibilitySettings,
  },
};

export default tauriPlatform;
