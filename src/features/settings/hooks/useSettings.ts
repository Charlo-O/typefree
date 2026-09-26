import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { getModelProvider } from "../../../models/ModelRegistry";
import ReasoningService from "../../../services/ReasoningService";
import type { ProcessingModeId } from "../../../config/processingModes";
import { syncVocabularySettingsToBackend } from "../../../utils/vocabulary";
import { platform } from "../../../shared/platform";
import { hydrateCredentialSetting, persistCredentialInBackground } from "../credentialMigration";
import {
  getBackendSettingKey,
  getSettingDefinition,
  shouldSyncSettingToBackend,
  type ActivationMode,
  type AppSettingKey,
  type AppSettingsValueMap,
  type DictationTriggerMode,
  type LocalAsrModelFamily,
  type LocalAsrRuntimeId,
} from "../schema/settingsSchema";

const VOLCENGINE_ASR2_MODEL = "volcengine-bigmodel-async";

function useSchemaSetting<K extends AppSettingKey>(key: K) {
  const definition = getSettingDefinition(key);
  return useLocalStorage<AppSettingsValueMap[K]>(definition.storageKey, definition.defaultValue, {
    serialize: definition.serialize,
    deserialize: definition.deserialize,
  });
}

function syncSchemaSettingToBackend<K extends AppSettingKey>(
  key: K,
  value: AppSettingsValueMap[K]
) {
  if (!shouldSyncSettingToBackend(key)) return;
  void platform.settings.set(getBackendSettingKey(key), value);
}

function useBackendSettingSync<K extends AppSettingKey>(key: K, value: AppSettingsValueMap[K]) {
  useEffect(() => {
    syncSchemaSettingToBackend(key, value);
  }, [key, value]);
}

export interface TranscriptionSettings {
  preferredLanguage: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl?: string;
}

export interface LocalAsrSettings {
  runtime: LocalAsrRuntimeId;
  modelFamily: LocalAsrModelFamily;
  modelPath: string;
  tokensPath: string;
  encoderPath: string;
  decoderPath: string;
  joinerPath: string;
  convFrontendPath: string;
  tokenizerPath: string;
  projectorPath: string;
  executablePath: string;
  commandArgs: string;
  endpoint: string;
  numThreads: number;
}

export interface ReasoningSettings {
  useReasoningModel: boolean;
  reasoningModel: string;
  reasoningProvider: string;
  cloudReasoningBaseUrl?: string;
  processingModeId?: ProcessingModeId;
}

export interface HotkeySettings {
  dictationKey: string;
  dictationTriggerMode: DictationTriggerMode;
  clipboardHotkey: string;
  processingModeHotkeys: string;
  activationMode: ActivationMode;
}

export interface MicrophoneSettings {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
}

export interface RecordingAudioSettings {
  muteSystemAudioWhileRecording: boolean;
  audioQualityProcessingEnabled: boolean;
  audioQualityNoiseGateEnabled: boolean;
  audioQualityPreRollMs: number;
  recordingMaxDurationSeconds: number;
}

export interface PrivacySettings {
  privacyApplicationBlacklist: string;
  privacyPauseHistoryInBlacklistedApps: boolean;
  privacyPauseClipboardInBlacklistedApps: boolean;
  privacyAutoDeleteHistoryEnabled: boolean;
  privacyHistoryRetentionDays: number;
}

export interface ApiKeySettings {
  assemblyaiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  deepseekApiKey: string;
  zaiApiKey: string;
  volcengineAppId: string;
  volcengineAccessToken: string;
  customReasoningApiKey: string;
  customTranscriptionApiKey: string;
}

export function useSettings() {
  const [preferredLanguage, setPreferredLanguage] = useSchemaSetting("preferredLanguage");
  const [cloudTranscriptionProvider, setCloudTranscriptionProvider] = useSchemaSetting(
    "cloudTranscriptionProvider"
  );
  const [cloudTranscriptionModel, setCloudTranscriptionModel] =
    useSchemaSetting("cloudTranscriptionModel");
  const [cloudTranscriptionBaseUrl, setCloudTranscriptionBaseUrl] = useSchemaSetting(
    "cloudTranscriptionBaseUrl"
  );
  const [localAsrRuntime, setLocalAsrRuntime] = useSchemaSetting("localAsrRuntime");
  const [localAsrModelFamily, setLocalAsrModelFamily] = useSchemaSetting("localAsrModelFamily");
  const [localAsrModelPath, setLocalAsrModelPath] = useSchemaSetting("localAsrModelPath");
  const [localAsrTokensPath, setLocalAsrTokensPath] = useSchemaSetting("localAsrTokensPath");
  const [localAsrEncoderPath, setLocalAsrEncoderPath] = useSchemaSetting("localAsrEncoderPath");
  const [localAsrDecoderPath, setLocalAsrDecoderPath] = useSchemaSetting("localAsrDecoderPath");
  const [localAsrJoinerPath, setLocalAsrJoinerPath] = useSchemaSetting("localAsrJoinerPath");
  const [localAsrConvFrontendPath, setLocalAsrConvFrontendPath] = useSchemaSetting(
    "localAsrConvFrontendPath"
  );
  const [localAsrTokenizerPath, setLocalAsrTokenizerPath] =
    useSchemaSetting("localAsrTokenizerPath");
  const [localAsrProjectorPath, setLocalAsrProjectorPath] =
    useSchemaSetting("localAsrProjectorPath");
  const [localAsrExecutablePath, setLocalAsrExecutablePath] =
    useSchemaSetting("localAsrExecutablePath");
  const [localAsrCommandArgs, setLocalAsrCommandArgs] = useSchemaSetting("localAsrCommandArgs");
  const [localAsrEndpoint, setLocalAsrEndpoint] = useSchemaSetting("localAsrEndpoint");
  const [localAsrNumThreads, setLocalAsrNumThreads] = useSchemaSetting("localAsrNumThreads");
  const [cloudReasoningBaseUrl, setCloudReasoningBaseUrl] =
    useSchemaSetting("cloudReasoningBaseUrl");

  useBackendSettingSync("preferredLanguage", preferredLanguage);
  useBackendSettingSync("cloudTranscriptionProvider", cloudTranscriptionProvider);
  useBackendSettingSync("cloudTranscriptionModel", cloudTranscriptionModel);

  useEffect(() => {
    if (
      cloudTranscriptionProvider === "volcengine" &&
      cloudTranscriptionModel !== VOLCENGINE_ASR2_MODEL
    ) {
      setCloudTranscriptionModel(VOLCENGINE_ASR2_MODEL);
    }
  }, [cloudTranscriptionModel, cloudTranscriptionProvider, setCloudTranscriptionModel]);

  useBackendSettingSync("cloudTranscriptionBaseUrl", cloudTranscriptionBaseUrl);
  useBackendSettingSync("localAsrRuntime", localAsrRuntime);
  useBackendSettingSync("localAsrModelFamily", localAsrModelFamily);
  useBackendSettingSync("localAsrModelPath", localAsrModelPath);
  useBackendSettingSync("localAsrTokensPath", localAsrTokensPath);
  useBackendSettingSync("localAsrEncoderPath", localAsrEncoderPath);
  useBackendSettingSync("localAsrDecoderPath", localAsrDecoderPath);
  useBackendSettingSync("localAsrJoinerPath", localAsrJoinerPath);
  useBackendSettingSync("localAsrConvFrontendPath", localAsrConvFrontendPath);
  useBackendSettingSync("localAsrTokenizerPath", localAsrTokenizerPath);
  useBackendSettingSync("localAsrProjectorPath", localAsrProjectorPath);
  useBackendSettingSync("localAsrExecutablePath", localAsrExecutablePath);
  useBackendSettingSync("localAsrCommandArgs", localAsrCommandArgs);
  useBackendSettingSync("localAsrEndpoint", localAsrEndpoint);
  useBackendSettingSync("localAsrNumThreads", localAsrNumThreads);

  // Reasoning settings
  const [processingModeId, setProcessingModeId] = useSchemaSetting("processingModeId");
  const [processingModeHotkeys, setProcessingModeHotkeys] =
    useSchemaSetting("processingModeHotkeys");
  const [useReasoningModel, setUseReasoningModel] = useSchemaSetting("useReasoningModel");
  const [reasoningModel, setReasoningModel] = useSchemaSetting("reasoningModel");
  const [recordingOverlayVisualStyle, setRecordingOverlayVisualStyle] = useSchemaSetting(
    "recordingOverlayVisualStyle"
  );
  const [muteSystemAudioWhileRecording, setMuteSystemAudioWhileRecording] = useSchemaSetting(
    "muteSystemAudioWhileRecording"
  );
  const [audioQualityProcessingEnabled, setAudioQualityProcessingEnabled] = useSchemaSetting(
    "audioQualityProcessingEnabled"
  );
  const [audioQualityNoiseGateEnabled, setAudioQualityNoiseGateEnabled] = useSchemaSetting(
    "audioQualityNoiseGateEnabled"
  );
  const [audioQualityPreRollMs, setAudioQualityPreRollMs] =
    useSchemaSetting("audioQualityPreRollMs");
  const [recordingMaxDurationSeconds, setRecordingMaxDurationSeconds] = useSchemaSetting(
    "recordingMaxDurationSeconds"
  );

  useBackendSettingSync("processingModeId", processingModeId);
  useBackendSettingSync("processingModeHotkeys", processingModeHotkeys);
  useBackendSettingSync("recordingOverlayVisualStyle", recordingOverlayVisualStyle);
  useBackendSettingSync("muteSystemAudioWhileRecording", muteSystemAudioWhileRecording);
  useBackendSettingSync("audioQualityProcessingEnabled", audioQualityProcessingEnabled);
  useBackendSettingSync("audioQualityNoiseGateEnabled", audioQualityNoiseGateEnabled);
  useBackendSettingSync("audioQualityPreRollMs", audioQualityPreRollMs);
  useBackendSettingSync("recordingMaxDurationSeconds", recordingMaxDurationSeconds);

  useEffect(() => {
    void syncVocabularySettingsToBackend();
  }, []);

  // API keys are kept in memory and persisted through the platform credential store.
  const [openaiApiKey, setOpenaiApiKeyLocal] = useState("");
  const [assemblyaiApiKey, setAssemblyaiApiKeyLocal] = useState("");
  const [anthropicApiKey, setAnthropicApiKeyLocal] = useState("");
  const [geminiApiKey, setGeminiApiKeyLocal] = useState("");
  const [groqApiKey, setGroqApiKeyLocal] = useState("");
  const [deepseekApiKey, setDeepseekApiKeyLocal] = useState("");
  const [zaiApiKey, setZaiApiKeyLocal] = useState("");
  const [volcengineAppId, setVolcengineAppIdLocal] = useState("");
  const [volcengineAccessToken, setVolcengineAccessTokenLocal] = useState("");
  const [customReasoningApiKey, setCustomReasoningApiKeyLocal] = useState("");
  const [customTranscriptionApiKey, setCustomTranscriptionApiKeyLocal] = useState("");

  // Sync credentials from the platform store and migrate old localStorage mirrors.
  const hasRunApiKeySync = useRef(false);
  useEffect(() => {
    if (hasRunApiKeySync.current) return;
    hasRunApiKeySync.current = true;

    const syncKeys = async () => {
      const storedUseReasoning = await platform.settings.get<boolean>("useReasoningModel");
      if (storedUseReasoning !== null) {
        setUseReasoningModel(storedUseReasoning);
      }

      await hydrateCredentialSetting("openaiApiKey", setOpenaiApiKeyLocal);
      await hydrateCredentialSetting("assemblyaiApiKey", setAssemblyaiApiKeyLocal);
      await hydrateCredentialSetting("anthropicApiKey", setAnthropicApiKeyLocal);
      await hydrateCredentialSetting("geminiApiKey", setGeminiApiKeyLocal);
      await hydrateCredentialSetting("groqApiKey", setGroqApiKeyLocal);
      await hydrateCredentialSetting("deepseekApiKey", setDeepseekApiKeyLocal);
      await hydrateCredentialSetting("zaiApiKey", setZaiApiKeyLocal);
      await hydrateCredentialSetting("volcengineAppId", setVolcengineAppIdLocal);
      await hydrateCredentialSetting("volcengineAccessToken", setVolcengineAccessTokenLocal);
      await hydrateCredentialSetting("customReasoningApiKey", setCustomReasoningApiKeyLocal);
      await hydrateCredentialSetting(
        "customTranscriptionApiKey",
        setCustomTranscriptionApiKeyLocal
      );
    };

    syncKeys().catch((error) => {
      console.error("Failed to sync credentials from platform store:", error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wrapped setters that sync to the Tauri bridge and invalidate cache
  const setOpenaiApiKey = useCallback(
    (key: string) => {
      setOpenaiApiKeyLocal(key);
      persistCredentialInBackground("openaiApiKey", key);
      ReasoningService.clearApiKeyCache("openai");
    },
    [setOpenaiApiKeyLocal]
  );

  const setAssemblyAIApiKey = useCallback(
    (key: string) => {
      setAssemblyaiApiKeyLocal(key);
      persistCredentialInBackground("assemblyaiApiKey", key);
    },
    [setAssemblyaiApiKeyLocal]
  );

  const setAnthropicApiKey = useCallback(
    (key: string) => {
      setAnthropicApiKeyLocal(key);
      persistCredentialInBackground("anthropicApiKey", key);
      ReasoningService.clearApiKeyCache("anthropic");
    },
    [setAnthropicApiKeyLocal]
  );

  const setGeminiApiKey = useCallback(
    (key: string) => {
      setGeminiApiKeyLocal(key);
      persistCredentialInBackground("geminiApiKey", key);
      ReasoningService.clearApiKeyCache("gemini");
    },
    [setGeminiApiKeyLocal]
  );

  const setGroqApiKey = useCallback(
    (key: string) => {
      setGroqApiKeyLocal(key);
      persistCredentialInBackground("groqApiKey", key);
      ReasoningService.clearApiKeyCache("groq");
    },
    [setGroqApiKeyLocal]
  );

  const setDeepseekApiKey = useCallback(
    (key: string) => {
      setDeepseekApiKeyLocal(key);
      persistCredentialInBackground("deepseekApiKey", key);
      ReasoningService.clearApiKeyCache("deepseek");
    },
    [setDeepseekApiKeyLocal]
  );

  const setZaiApiKey = useCallback(
    (key: string) => {
      setZaiApiKeyLocal(key);
      persistCredentialInBackground("zaiApiKey", key);
    },
    [setZaiApiKeyLocal]
  );

  const setVolcengineAppId = useCallback(
    (value: string) => {
      setVolcengineAppIdLocal(value);
      persistCredentialInBackground("volcengineAppId", value);
    },
    [setVolcengineAppIdLocal]
  );

  const setVolcengineAccessToken = useCallback(
    (value: string) => {
      setVolcengineAccessTokenLocal(value);
      persistCredentialInBackground("volcengineAccessToken", value);
    },
    [setVolcengineAccessTokenLocal]
  );

  const setCustomReasoningApiKey = useCallback(
    (key: string) => {
      setCustomReasoningApiKeyLocal(key);
      persistCredentialInBackground("customReasoningApiKey", key);
      ReasoningService.clearApiKeyCache("openai");
    },
    [setCustomReasoningApiKeyLocal]
  );

  const setCustomTranscriptionApiKey = useCallback(
    (key: string) => {
      setCustomTranscriptionApiKeyLocal(key);
      persistCredentialInBackground("customTranscriptionApiKey", key);
    },
    [setCustomTranscriptionApiKeyLocal]
  );

  // Hotkey
  const [dictationKey, setDictationKey] = useSchemaSetting("dictationKey");
  const [dictationTriggerMode, setDictationTriggerMode] = useSchemaSetting("dictationTriggerMode");
  const [clipboardHotkey, setClipboardHotkey] = useSchemaSetting("clipboardHotkey");
  const [activationMode, setActivationMode] = useSchemaSetting("activationMode");

  useEffect(() => {
    if (dictationTriggerMode === "double" && activationMode !== "tap") {
      setActivationMode("tap");
    }
  }, [activationMode, dictationTriggerMode, setActivationMode]);

  useBackendSettingSync("activationMode", activationMode);
  useBackendSettingSync("dictationTriggerMode", dictationTriggerMode);

  // General
  const [launchAtStartup, setLaunchAtStartup] = useSchemaSetting("launchAtStartup");

  // Microphone settings
  const [preferBuiltInMic, setPreferBuiltInMic] = useSchemaSetting("preferBuiltInMic");
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useSchemaSetting("selectedMicDeviceId");

  // Privacy settings
  const [privacyApplicationBlacklist, setPrivacyApplicationBlacklist] = useSchemaSetting(
    "privacyApplicationBlacklist"
  );
  const [privacyPauseHistoryInBlacklistedApps, setPrivacyPauseHistoryInBlacklistedApps] =
    useSchemaSetting("privacyPauseHistoryInBlacklistedApps");
  const [privacyPauseClipboardInBlacklistedApps, setPrivacyPauseClipboardInBlacklistedApps] =
    useSchemaSetting("privacyPauseClipboardInBlacklistedApps");
  const [privacyAutoDeleteHistoryEnabled, setPrivacyAutoDeleteHistoryEnabled] = useSchemaSetting(
    "privacyAutoDeleteHistoryEnabled"
  );
  const [privacyHistoryRetentionDays, setPrivacyHistoryRetentionDays] = useSchemaSetting(
    "privacyHistoryRetentionDays"
  );

  useBackendSettingSync("privacyApplicationBlacklist", privacyApplicationBlacklist);
  useBackendSettingSync(
    "privacyPauseHistoryInBlacklistedApps",
    privacyPauseHistoryInBlacklistedApps
  );
  useBackendSettingSync(
    "privacyPauseClipboardInBlacklistedApps",
    privacyPauseClipboardInBlacklistedApps
  );
  useBackendSettingSync("privacyAutoDeleteHistoryEnabled", privacyAutoDeleteHistoryEnabled);
  useBackendSettingSync("privacyHistoryRetentionDays", privacyHistoryRetentionDays);

  // Computed values
  const reasoningProvider = getModelProvider(reasoningModel);

  useBackendSettingSync("useReasoningModel", useReasoningModel);
  useBackendSettingSync("reasoningModel", reasoningModel);
  useBackendSettingSync("cloudReasoningBaseUrl", cloudReasoningBaseUrl);

  useEffect(() => {
    if (deepseekApiKey.trim()) {
      persistCredentialInBackground("deepseekApiKey", deepseekApiKey);
    }
  }, [deepseekApiKey]);

  useEffect(() => {
    if (customReasoningApiKey.trim()) {
      persistCredentialInBackground("customReasoningApiKey", customReasoningApiKey);
    }
  }, [customReasoningApiKey]);

  // Batch operations
  const updateTranscriptionSettings = useCallback(
    (settings: Partial<TranscriptionSettings>) => {
      if (settings.preferredLanguage !== undefined)
        setPreferredLanguage(settings.preferredLanguage);
      if (settings.cloudTranscriptionProvider !== undefined)
        setCloudTranscriptionProvider(settings.cloudTranscriptionProvider);
      if (settings.cloudTranscriptionModel !== undefined)
        setCloudTranscriptionModel(settings.cloudTranscriptionModel);
      if (settings.cloudTranscriptionBaseUrl !== undefined)
        setCloudTranscriptionBaseUrl(settings.cloudTranscriptionBaseUrl);
    },
    [
      setPreferredLanguage,
      setCloudTranscriptionProvider,
      setCloudTranscriptionModel,
      setCloudTranscriptionBaseUrl,
    ]
  );

  const updateLocalAsrSettings = useCallback(
    (settings: Partial<LocalAsrSettings>) => {
      if (settings.runtime !== undefined) setLocalAsrRuntime(settings.runtime);
      if (settings.modelFamily !== undefined) setLocalAsrModelFamily(settings.modelFamily);
      if (settings.modelPath !== undefined) setLocalAsrModelPath(settings.modelPath);
      if (settings.tokensPath !== undefined) setLocalAsrTokensPath(settings.tokensPath);
      if (settings.encoderPath !== undefined) setLocalAsrEncoderPath(settings.encoderPath);
      if (settings.decoderPath !== undefined) setLocalAsrDecoderPath(settings.decoderPath);
      if (settings.joinerPath !== undefined) setLocalAsrJoinerPath(settings.joinerPath);
      if (settings.convFrontendPath !== undefined)
        setLocalAsrConvFrontendPath(settings.convFrontendPath);
      if (settings.tokenizerPath !== undefined) setLocalAsrTokenizerPath(settings.tokenizerPath);
      if (settings.projectorPath !== undefined) setLocalAsrProjectorPath(settings.projectorPath);
      if (settings.executablePath !== undefined) setLocalAsrExecutablePath(settings.executablePath);
      if (settings.commandArgs !== undefined) setLocalAsrCommandArgs(settings.commandArgs);
      if (settings.endpoint !== undefined) setLocalAsrEndpoint(settings.endpoint);
      if (settings.numThreads !== undefined) setLocalAsrNumThreads(settings.numThreads);
    },
    [
      setLocalAsrCommandArgs,
      setLocalAsrConvFrontendPath,
      setLocalAsrDecoderPath,
      setLocalAsrEndpoint,
      setLocalAsrEncoderPath,
      setLocalAsrExecutablePath,
      setLocalAsrJoinerPath,
      setLocalAsrModelFamily,
      setLocalAsrModelPath,
      setLocalAsrNumThreads,
      setLocalAsrProjectorPath,
      setLocalAsrRuntime,
      setLocalAsrTokensPath,
      setLocalAsrTokenizerPath,
    ]
  );

  const updateReasoningSettings = useCallback(
    (settings: Partial<ReasoningSettings>) => {
      if (settings.useReasoningModel !== undefined) {
        setUseReasoningModel(settings.useReasoningModel);
        syncSchemaSettingToBackend("useReasoningModel", settings.useReasoningModel);
      }
      if (settings.reasoningModel !== undefined) setReasoningModel(settings.reasoningModel);
      if (settings.processingModeId !== undefined) setProcessingModeId(settings.processingModeId);
      if (settings.cloudReasoningBaseUrl !== undefined) {
        setCloudReasoningBaseUrl(settings.cloudReasoningBaseUrl);
        syncSchemaSettingToBackend("cloudReasoningBaseUrl", settings.cloudReasoningBaseUrl);
      }
      // reasoningProvider is computed from reasoningModel, not stored separately
    },
    [setUseReasoningModel, setReasoningModel, setProcessingModeId, setCloudReasoningBaseUrl]
  );

  const updateApiKeys = useCallback(
    (keys: Partial<ApiKeySettings>) => {
      if (keys.assemblyaiApiKey !== undefined) setAssemblyAIApiKey(keys.assemblyaiApiKey);
      if (keys.openaiApiKey !== undefined) setOpenaiApiKey(keys.openaiApiKey);
      if (keys.anthropicApiKey !== undefined) setAnthropicApiKey(keys.anthropicApiKey);
      if (keys.geminiApiKey !== undefined) setGeminiApiKey(keys.geminiApiKey);
      if (keys.groqApiKey !== undefined) setGroqApiKey(keys.groqApiKey);
      if (keys.deepseekApiKey !== undefined) setDeepseekApiKey(keys.deepseekApiKey);
      if (keys.zaiApiKey !== undefined) setZaiApiKey(keys.zaiApiKey);
      if (keys.volcengineAppId !== undefined) setVolcengineAppId(keys.volcengineAppId);
      if (keys.volcengineAccessToken !== undefined)
        setVolcengineAccessToken(keys.volcengineAccessToken);
      if (keys.customReasoningApiKey !== undefined)
        setCustomReasoningApiKey(keys.customReasoningApiKey);
      if (keys.customTranscriptionApiKey !== undefined)
        setCustomTranscriptionApiKey(keys.customTranscriptionApiKey);
    },
    [
      setAssemblyAIApiKey,
      setOpenaiApiKey,
      setAnthropicApiKey,
      setGeminiApiKey,
      setGroqApiKey,
      setDeepseekApiKey,
      setZaiApiKey,
      setVolcengineAppId,
      setVolcengineAccessToken,
      setCustomReasoningApiKey,
      setCustomTranscriptionApiKey,
    ]
  );

  return {
    preferredLanguage,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    localAsrSettings: {
      runtime: localAsrRuntime,
      modelFamily: localAsrModelFamily,
      modelPath: localAsrModelPath,
      tokensPath: localAsrTokensPath,
      encoderPath: localAsrEncoderPath,
      decoderPath: localAsrDecoderPath,
      joinerPath: localAsrJoinerPath,
      convFrontendPath: localAsrConvFrontendPath,
      tokenizerPath: localAsrTokenizerPath,
      projectorPath: localAsrProjectorPath,
      executablePath: localAsrExecutablePath,
      commandArgs: localAsrCommandArgs,
      endpoint: localAsrEndpoint,
      numThreads: localAsrNumThreads,
    },
    cloudReasoningBaseUrl,
    useReasoningModel,
    reasoningModel,
    processingModeId,
    processingModeHotkeys,
    recordingOverlayVisualStyle,
    muteSystemAudioWhileRecording,
    audioQualityProcessingEnabled,
    audioQualityNoiseGateEnabled,
    audioQualityPreRollMs,
    recordingMaxDurationSeconds,
    reasoningProvider,
    assemblyaiApiKey,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    deepseekApiKey,
    zaiApiKey,
    volcengineAppId,
    volcengineAccessToken,
    customReasoningApiKey,
    customTranscriptionApiKey,
    dictationKey,
    dictationTriggerMode,
    clipboardHotkey,
    launchAtStartup,
    setPreferredLanguage,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setUseReasoningModel,
    setReasoningModel,
    setProcessingModeId,
    setProcessingModeHotkeys,
    setRecordingOverlayVisualStyle,
    setMuteSystemAudioWhileRecording,
    setAudioQualityProcessingEnabled,
    setAudioQualityNoiseGateEnabled,
    setAudioQualityPreRollMs,
    setRecordingMaxDurationSeconds,
    setReasoningProvider: (provider: string) => {
      if (provider !== "custom") {
        setReasoningModel("");
      }
    },
    setAssemblyAIApiKey,
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setDeepseekApiKey,
    setZaiApiKey,
    setVolcengineAppId,
    setVolcengineAccessToken,
    setCustomReasoningApiKey,
    setCustomTranscriptionApiKey,
    setDictationKey,
    setDictationTriggerMode,
    setClipboardHotkey,
    setLaunchAtStartup,
    activationMode,
    setActivationMode,
    preferBuiltInMic,
    selectedMicDeviceId,
    privacyApplicationBlacklist,
    privacyPauseHistoryInBlacklistedApps,
    privacyPauseClipboardInBlacklistedApps,
    privacyAutoDeleteHistoryEnabled,
    privacyHistoryRetentionDays,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
    setPrivacyApplicationBlacklist,
    setPrivacyPauseHistoryInBlacklistedApps,
    setPrivacyPauseClipboardInBlacklistedApps,
    setPrivacyAutoDeleteHistoryEnabled,
    setPrivacyHistoryRetentionDays,
    updateTranscriptionSettings,
    updateLocalAsrSettings,
    updateReasoningSettings,
    updateApiKeys,
  };
}
