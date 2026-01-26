import { useCallback, useEffect, useRef } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { useDebouncedCallback } from "./useDebouncedCallback";
import { getModelProvider } from "../models/ModelRegistry";
import { API_ENDPOINTS } from "../config/constants";
import ReasoningService from "../services/ReasoningService";

export interface TranscriptionSettings {
  preferredLanguage: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl?: string;
}

export interface ReasoningSettings {
  useReasoningModel: boolean;
  reasoningModel: string;
  reasoningProvider: string;
  cloudReasoningBaseUrl?: string;
}

export interface HotkeySettings {
  dictationKey: string;
  activationMode: "tap" | "push";
}

export interface MicrophoneSettings {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
}

export interface ApiKeySettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  zaiApiKey: string;
}

export function useSettings() {
  const [preferredLanguage, setPreferredLanguage] = useLocalStorage("preferredLanguage", "en", {
    serialize: String,
    deserialize: String,
  });

  const [cloudTranscriptionProvider, setCloudTranscriptionProvider] = useLocalStorage(
    "cloudTranscriptionProvider",
    "openai",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudTranscriptionModel, setCloudTranscriptionModel] = useLocalStorage(
    "cloudTranscriptionModel",
    "gpt-4o-mini-transcribe",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudTranscriptionBaseUrl, setCloudTranscriptionBaseUrl] = useLocalStorage(
    "cloudTranscriptionBaseUrl",
    API_ENDPOINTS.TRANSCRIPTION_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudReasoningBaseUrl, setCloudReasoningBaseUrl] = useLocalStorage(
    "cloudReasoningBaseUrl",
    API_ENDPOINTS.OPENAI_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );

  // Reasoning settings
  const [useReasoningModel, setUseReasoningModel] = useLocalStorage("useReasoningModel", true, {
    serialize: String,
    deserialize: (value) => value !== "false", // Default true
  });

  const [reasoningModel, setReasoningModel] = useLocalStorage("reasoningModel", "", {
    serialize: String,
    deserialize: String,
  });

  // API keys - localStorage for UI, synced to Electron IPC for persistence
  const [openaiApiKey, setOpenaiApiKeyLocal] = useLocalStorage("openaiApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [anthropicApiKey, setAnthropicApiKeyLocal] = useLocalStorage("anthropicApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [geminiApiKey, setGeminiApiKeyLocal] = useLocalStorage("geminiApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [groqApiKey, setGroqApiKeyLocal] = useLocalStorage("groqApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [zaiApiKey, setZaiApiKeyLocal] = useLocalStorage("zaiApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  // Sync API keys from main process on first mount (if localStorage was cleared)
  const hasRunApiKeySync = useRef(false);
  useEffect(() => {
    if (hasRunApiKeySync.current) return;
    hasRunApiKeySync.current = true;

    const syncKeys = async () => {
      if (typeof window === "undefined" || !window.electronAPI) return;

      // Only sync keys that are missing from localStorage
      if (!openaiApiKey) {
        const envKey = await window.electronAPI.getOpenAIKey?.();
        if (envKey) setOpenaiApiKeyLocal(envKey);
      }
      if (!anthropicApiKey) {
        const envKey = await window.electronAPI.getAnthropicKey?.();
        if (envKey) setAnthropicApiKeyLocal(envKey);
      }
      if (!geminiApiKey) {
        const envKey = await window.electronAPI.getGeminiKey?.();
        if (envKey) setGeminiApiKeyLocal(envKey);
      }
      if (!groqApiKey) {
        const envKey = await window.electronAPI.getGroqKey?.();
        if (envKey) setGroqApiKeyLocal(envKey);
      }
      if (!zaiApiKey) {
        const envKey = await window.electronAPI.getZaiKey?.();
        if (envKey) setZaiApiKeyLocal(envKey);
      }
    };

    syncKeys().catch(() => {
      // Silently ignore sync errors
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debouncedPersistToEnv = useDebouncedCallback(() => {
    if (typeof window !== "undefined" && window.electronAPI?.saveAllKeysToEnv) {
      window.electronAPI.saveAllKeysToEnv().catch(() => {
        // Silently ignore persistence errors
      });
    }
  }, 1000);

  // Wrapped setters that sync to Electron IPC and invalidate cache
  const setOpenaiApiKey = useCallback(
    (key: string) => {
      setOpenaiApiKeyLocal(key);
      window.electronAPI?.saveOpenAIKey?.(key);
      ReasoningService.clearApiKeyCache("openai");
      debouncedPersistToEnv();
    },
    [setOpenaiApiKeyLocal, debouncedPersistToEnv]
  );

  const setAnthropicApiKey = useCallback(
    (key: string) => {
      setAnthropicApiKeyLocal(key);
      window.electronAPI?.saveAnthropicKey?.(key);
      ReasoningService.clearApiKeyCache("anthropic");
      debouncedPersistToEnv();
    },
    [setAnthropicApiKeyLocal, debouncedPersistToEnv]
  );

  const setGeminiApiKey = useCallback(
    (key: string) => {
      setGeminiApiKeyLocal(key);
      window.electronAPI?.saveGeminiKey?.(key);
      ReasoningService.clearApiKeyCache("gemini");
      debouncedPersistToEnv();
    },
    [setGeminiApiKeyLocal, debouncedPersistToEnv]
  );

  const setGroqApiKey = useCallback(
    (key: string) => {
      setGroqApiKeyLocal(key);
      window.electronAPI?.saveGroqKey?.(key);
      ReasoningService.clearApiKeyCache("groq");
      debouncedPersistToEnv();
    },
    [setGroqApiKeyLocal, debouncedPersistToEnv]
  );

  const setZaiApiKey = useCallback(
    (key: string) => {
      setZaiApiKeyLocal(key);
      window.electronAPI?.saveZaiKey?.(key);
      debouncedPersistToEnv();
    },
    [setZaiApiKeyLocal, debouncedPersistToEnv]
  );

  // Hotkey
  const [dictationKey, setDictationKey] = useLocalStorage("dictationKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [activationMode, setActivationMode] = useLocalStorage<"tap" | "push">(
    "activationMode",
    "tap",
    {
      serialize: String,
      deserialize: (value) => (value === "push" ? "push" : "tap"),
    }
  );

  // General
  const [launchAtStartup, setLaunchAtStartup] = useLocalStorage("launchAtStartup", false, {
    serialize: String,
    deserialize: (value) => value === "true",
  });

  // Microphone settings
  const [preferBuiltInMic, setPreferBuiltInMic] = useLocalStorage("preferBuiltInMic", true, {
    serialize: String,
    deserialize: (value) => value !== "false",
  });

  const [selectedMicDeviceId, setSelectedMicDeviceId] = useLocalStorage("selectedMicDeviceId", "", {
    serialize: String,
    deserialize: String,
  });

  // Computed values
  const reasoningProvider = getModelProvider(reasoningModel);

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

  const updateReasoningSettings = useCallback(
    (settings: Partial<ReasoningSettings>) => {
      if (settings.useReasoningModel !== undefined)
        setUseReasoningModel(settings.useReasoningModel);
      if (settings.reasoningModel !== undefined) setReasoningModel(settings.reasoningModel);
      if (settings.cloudReasoningBaseUrl !== undefined)
        setCloudReasoningBaseUrl(settings.cloudReasoningBaseUrl);
      // reasoningProvider is computed from reasoningModel, not stored separately
    },
    [setUseReasoningModel, setReasoningModel, setCloudReasoningBaseUrl]
  );

  const updateApiKeys = useCallback(
    (keys: Partial<ApiKeySettings>) => {
      if (keys.openaiApiKey !== undefined) setOpenaiApiKey(keys.openaiApiKey);
      if (keys.anthropicApiKey !== undefined) setAnthropicApiKey(keys.anthropicApiKey);
      if (keys.geminiApiKey !== undefined) setGeminiApiKey(keys.geminiApiKey);
      if (keys.groqApiKey !== undefined) setGroqApiKey(keys.groqApiKey);
      if (keys.zaiApiKey !== undefined) setZaiApiKey(keys.zaiApiKey);
    },
    [setOpenaiApiKey, setAnthropicApiKey, setGeminiApiKey, setGroqApiKey, setZaiApiKey]
  );

  return {
    preferredLanguage,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl,
    useReasoningModel,
    reasoningModel,
    reasoningProvider,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    zaiApiKey,
    dictationKey,
    launchAtStartup,
    setPreferredLanguage,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setUseReasoningModel,
    setReasoningModel,
    setReasoningProvider: (provider: string) => {
      if (provider !== "custom") {
        setReasoningModel("");
      }
    },
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setZaiApiKey,
    setDictationKey,
    setLaunchAtStartup,
    activationMode,
    setActivationMode,
    preferBuiltInMic,
    selectedMicDeviceId,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
    updateTranscriptionSettings,
    updateReasoningSettings,
    updateApiKeys,
  };
}
