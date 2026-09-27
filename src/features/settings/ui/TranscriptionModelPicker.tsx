import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Button } from "../../../components/ui/button";
import { ProviderTabs } from "../../../components/ui/ProviderTabs";
import ModelCardList, { type ModelCardOption } from "../../../components/ui/ModelCardList";
import ApiKeyInput from "../../../components/ui/ApiKeyInput";
import { Check, Download, Loader2, RefreshCw } from "lucide-react";
import {
  getTranscriptionProviders,
  type TranscriptionProviderData,
} from "../../../models/ModelRegistry";
import { type ColorScheme } from "../../../utils/modelPickerStyles";
import { getProviderIcon } from "../../../utils/providerIcons";
import { normalizeBaseUrl } from "../../../config/constants";
import { createExternalLinkHandler } from "../../../utils/externalLinks";
import { useI18n } from "../../../i18n";
import { platform } from "../../../shared/platform";
import type { LocalModelRecord, ModelDownloadProgressPayload } from "../../../shared/platform";
import type { LocalAsrSettings } from "../hooks/useSettings";

interface TranscriptionModelPickerProps {
  selectedCloudProvider: string;
  onCloudProviderSelect: (providerId: string) => void;
  selectedCloudModel: string;
  onCloudModelSelect: (modelId: string) => void;
  assemblyaiApiKey: string;
  setAssemblyAIApiKey: (key: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  customTranscriptionApiKey: string;
  setCustomTranscriptionApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  zaiApiKey: string;
  setZaiApiKey: (key: string) => void;
  volcengineAppId?: string;
  setVolcengineAppId?: (value: string) => void;
  volcengineAccessToken?: string;
  setVolcengineAccessToken?: (value: string) => void;
  cloudTranscriptionBaseUrl?: string;
  setCloudTranscriptionBaseUrl?: (url: string) => void;
  localAsrSettings?: LocalAsrSettings;
  onLocalAsrSettingsChange?: (settings: Partial<LocalAsrSettings>) => void;
  className?: string;
  variant?: "onboarding" | "settings";
}

const CLOUD_PROVIDER_TABS = [
  { id: "local", name: "本地 ASR" },
  { id: "volcengine", name: "豆包" },
  { id: "zai", name: "Z.ai" },
  { id: "assemblyai", name: "AssemblyAI" },
  { id: "openai", name: "OpenAI" },
  { id: "groq", name: "Groq" },
  { id: "custom", name: "Custom" },
];

const VALID_CLOUD_PROVIDER_IDS = CLOUD_PROVIDER_TABS.map((p) => p.id);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const parseFetchedModelOptions = (payload: unknown, providerId: string): ModelCardOption[] => {
  const rawModels = isRecord(payload)
    ? Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : []
    : Array.isArray(payload)
      ? payload
      : [];
  const seen = new Set<string>();

  return rawModels
    .map((item) => {
      if (typeof item === "string") {
        return { id: item, label: item, description: "" };
      }

      if (!isRecord(item)) return null;

      const idValue = item.id || item.name || item.model;
      if (typeof idValue !== "string" || !idValue.trim()) return null;

      const labelValue =
        typeof item.name === "string" && item.name.trim() ? item.name.trim() : idValue.trim();
      const ownerValue = item.owned_by || item.ownedBy || item.owner;
      const descriptionValue = item.description || item.desc;

      return {
        id: idValue.trim(),
        label: labelValue,
        description:
          typeof descriptionValue === "string" && descriptionValue.trim()
            ? descriptionValue.trim()
            : typeof ownerValue === "string" && ownerValue.trim()
              ? `Owner: ${ownerValue.trim()}`
              : "",
      };
    })
    .filter((model): model is { id: string; label: string; description: string } => {
      if (!model || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .map((model) => ({
      value: model.id,
      label: model.label,
      description: model.description,
      icon: getProviderIcon(providerId),
    }));
};

export default function TranscriptionModelPicker({
  selectedCloudProvider,
  onCloudProviderSelect,
  selectedCloudModel,
  onCloudModelSelect,
  assemblyaiApiKey,
  setAssemblyAIApiKey,
  openaiApiKey,
  setOpenaiApiKey,
  customTranscriptionApiKey,
  setCustomTranscriptionApiKey,
  groqApiKey,
  setGroqApiKey,
  zaiApiKey,
  setZaiApiKey,
  volcengineAppId = "",
  setVolcengineAppId,
  volcengineAccessToken = "",
  setVolcengineAccessToken,
  cloudTranscriptionBaseUrl = "",
  setCloudTranscriptionBaseUrl,
  localAsrSettings,
  onLocalAsrSettingsChange,
  className = "",
  variant = "settings",
}: TranscriptionModelPickerProps) {
  const { t } = useI18n();
  const colorScheme: ColorScheme = variant === "settings" ? "purple" : "blue";

  // 连接测试状态
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [customFetchedModels, setCustomFetchedModels] = useState<ModelCardOption[]>([]);
  const [transcriptionPrompt, setTranscriptionPrompt] = useState(() => {
    try {
      return localStorage.getItem("transcriptionPrompt") || "";
    } catch {
      return "";
    }
  });
  const [promptSaveState, setPromptSaveState] = useState<"idle" | "saved">("idle");
  const [localRuntimeStatus, setLocalRuntimeStatus] = useState<
    "idle" | "checking" | "ready" | "error"
  >("idle");
  const [localRuntimeMessage, setLocalRuntimeMessage] = useState("");
  const [nativeModel, setNativeModel] = useState<LocalModelRecord | null>(null);
  const [nativeModelLoading, setNativeModelLoading] = useState(false);
  const [nativeModelBusy, setNativeModelBusy] = useState(false);
  const [nativeDownloadProgress, setNativeDownloadProgress] =
    useState<ModelDownloadProgressPayload | null>(null);

  const effectiveLocalAsrSettings: LocalAsrSettings = localAsrSettings || {
    runtime: "sherpa-onnx",
    modelFamily: "sense-voice",
    modelPath: "",
    tokensPath: "",
    encoderPath: "",
    decoderPath: "",
    joinerPath: "",
    convFrontendPath: "",
    tokenizerPath: "",
    projectorPath: "",
    executablePath: "",
    commandArgs: "",
    endpoint: "http://127.0.0.1:8080/v1",
    numThreads: 2,
  };

  const updateLocalAsrSetting = useCallback(
    <K extends keyof LocalAsrSettings>(key: K, value: LocalAsrSettings[K]) => {
      onLocalAsrSettingsChange?.({ [key]: value } as Partial<LocalAsrSettings>);
    },
    [onLocalAsrSettingsChange]
  );

  const loadNativeModel = useCallback(async () => {
    setNativeModelLoading(true);
    try {
      const models = await platform.models.getAll();
      setNativeModel(models.find((model) => model.id === "r2t2-native-q4") || null);
    } catch (error) {
      console.warn("Failed to load native local ASR model:", error);
      setNativeModel(null);
    } finally {
      setNativeModelLoading(false);
    }
  }, []);

  // Draft selection for browsing. Default transcription only updates when user clicks "Set as Default".
  const [draftProvider, setDraftProvider] = useState(() => {
    return VALID_CLOUD_PROVIDER_IDS.includes(selectedCloudProvider)
      ? selectedCloudProvider
      : CLOUD_PROVIDER_TABS[0].id;
  });
  const [draftModel, setDraftModel] = useState(selectedCloudModel);

  useEffect(() => {
    if (draftProvider !== "local") return;
    void loadNativeModel();
    const dispose = platform.models.onDownloadProgress((payload) => {
      if (payload.modelId === "r2t2-native-q4") {
        setNativeDownloadProgress(payload);
      }
    });
    return () => {
      if (typeof dispose === "function") {
        dispose();
      } else if (dispose) {
        void dispose.then((cleanup) => cleanup?.());
      }
    };
  }, [draftProvider, loadNativeModel]);
  const [customBaseInput, setCustomBaseInput] = useState(cloudTranscriptionBaseUrl);

  const getModelStorageKey = useCallback((providerId: string): string => {
    return providerId === "custom"
      ? "customTranscriptionModel"
      : `transcriptionModel_${providerId}`;
  }, []);

  const readStoredModel = useCallback(
    (providerId: string): string => {
      try {
        return localStorage.getItem(getModelStorageKey(providerId)) || "";
      } catch {
        return "";
      }
    },
    [getModelStorageKey]
  );

  const writeStoredModel = useCallback(
    (providerId: string, modelId: string) => {
      try {
        localStorage.setItem(getModelStorageKey(providerId), modelId);
      } catch {
        // ignore
      }
    },
    [getModelStorageKey]
  );

  // 检查连接函数
  const fetchCustomModels = useCallback(async () => {
    const baseValue = customBaseInput.trim();

    if (!baseValue) {
      setConnectionStatus("error");
      setConnectionMessage(t("transcription.testConnection.missingFields") || "请先填写端点 URL");
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus("idle");
    setConnectionMessage("");

    try {
      const baseUrl =
        normalizeBaseUrl(baseValue)?.replace(/\/+$/, "") || baseValue.replace(/\/+$/, "");
      const modelsUrl = `${baseUrl}/models`;

      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      const apiKey = (customTranscriptionApiKey || "").trim();
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers,
      });

      if (response.ok) {
        const payload = (await response.json()) as unknown;
        const modelOptions = parseFetchedModelOptions(payload, "custom");

        if (!modelOptions.length) {
          setCustomFetchedModels([]);
          setConnectionStatus("error");
          setConnectionMessage("没有从这个端点读取到可用模型。");
          return;
        }

        setCustomFetchedModels(modelOptions);
        const nextModel = modelOptions.some((model) => model.value === draftModel)
          ? draftModel
          : modelOptions[0].value;
        setDraftModel(nextModel);
        writeStoredModel("custom", nextModel);
        setConnectionStatus("success");
        setConnectionMessage(`已获取 ${modelOptions.length} 个模型，选择后点击启用。`);
      } else {
        setConnectionStatus("error");
        setConnectionMessage(
          `${t("transcription.testConnection.failed") || "连接失败"}: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      setConnectionStatus("error");
      setConnectionMessage(
        `${t("transcription.testConnection.error") || "连接错误"}: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsTestingConnection(false);
    }
  }, [customBaseInput, customTranscriptionApiKey, draftModel, t, writeStoredModel]);

  const checkLocalRuntime = useCallback(async () => {
    setLocalRuntimeStatus("checking");
    setLocalRuntimeMessage("");
    try {
      const result = await platform.transcription.checkLocalAsrRuntime();
      if (result.available && result.modelReady) {
        setLocalRuntimeStatus("ready");
        setLocalRuntimeMessage("本地 ASR runtime 和模型已就绪。");
      } else {
        setLocalRuntimeStatus("error");
        setLocalRuntimeMessage(result.reason || "runtime 或模型尚未就绪。");
      }
    } catch (error) {
      setLocalRuntimeStatus("error");
      setLocalRuntimeMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const downloadNativeModel = useCallback(async () => {
    setNativeModelBusy(true);
    setNativeDownloadProgress({
      modelId: "r2t2-native-q4",
      progress: 0,
      downloadedSize: 0,
      totalSize: nativeModel?.sizeBytes || 0,
    });
    try {
      const result = await platform.models.download("r2t2-native-q4");
      if (!result.success) {
        throw new Error(result.error || "模型下载失败");
      }
      await loadNativeModel();
      setConnectionStatus("success");
      setConnectionMessage("模型已下载。请点击“选择”将它设为默认本地 ASR。");
    } catch (error) {
      setConnectionStatus("error");
      setConnectionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setNativeModelBusy(false);
    }
  }, [loadNativeModel, nativeModel?.sizeBytes]);

  const selectNativeModel = useCallback(async () => {
    setNativeModelBusy(true);
    try {
      const selection = await platform.models.select("r2t2-native-q4");
      updateLocalAsrSetting("runtime", "llama.cpp");
      updateLocalAsrSetting("modelFamily", "r2t2");
      updateLocalAsrSetting("modelPath", selection.modelPath);
      updateLocalAsrSetting("projectorPath", selection.projectorPath);
      setDraftModel(selection.modelId);
      writeStoredModel("local", selection.modelId);
      onCloudProviderSelect("local");
      setCloudTranscriptionBaseUrl?.("");
      onCloudModelSelect(selection.modelId);
      setLocalRuntimeStatus("ready");
      setLocalRuntimeMessage("原生 llama.cpp 模型已设为默认本地 ASR。");
      setConnectionStatus("success");
      setConnectionMessage("默认本地 ASR 已更新。");
    } catch (error) {
      setConnectionStatus("error");
      setConnectionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setNativeModelBusy(false);
    }
  }, [
    onCloudModelSelect,
    onCloudProviderSelect,
    setCloudTranscriptionBaseUrl,
    updateLocalAsrSetting,
    writeStoredModel,
  ]);

  const providerTabs = useMemo(
    () =>
      CLOUD_PROVIDER_TABS.map((tab) => ({
        ...tab,
        name: tab.id === "custom" ? t("common.custom") : tab.name,
      })),
    [t]
  );

  const cloudProviders = useMemo(() => getTranscriptionProviders(), []);

  const resolveModelForProvider = useCallback(
    (providerId: string): string => {
      const stored = readStoredModel(providerId);

      if (providerId === "custom") {
        return stored || "whisper-1";
      }

      const provider = cloudProviders.find((p) => p.id === providerId);
      const models = provider?.models || [];
      if (!models.length) return "";

      if (stored && models.some((m) => m.id === stored)) {
        return stored;
      }

      return models[0].id;
    },
    [cloudProviders, readStoredModel]
  );

  useEffect(() => {
    // When the default selection changes (Set as Default), reset the draft UI back to it.
    const providerId = VALID_CLOUD_PROVIDER_IDS.includes(selectedCloudProvider)
      ? selectedCloudProvider
      : CLOUD_PROVIDER_TABS[0].id;
    setDraftProvider(providerId);
    setDraftModel(selectedCloudModel);
    setCustomBaseInput(cloudTranscriptionBaseUrl);

    if (selectedCloudModel) {
      writeStoredModel(providerId, selectedCloudModel);
    }
  }, [selectedCloudProvider, selectedCloudModel, cloudTranscriptionBaseUrl, writeStoredModel]);

  const handleDraftProviderChange = useCallback(
    (providerId: string) => {
      setDraftProvider(providerId);
      setConnectionStatus("idle");
      setConnectionMessage("");
      setCustomFetchedModels([]);

      if (providerId === selectedCloudProvider) {
        setDraftModel(selectedCloudModel);
        return;
      }

      const nextModel = resolveModelForProvider(providerId);
      setDraftModel(nextModel);
      if (nextModel) {
        writeStoredModel(providerId, nextModel);
      }

      if (providerId === "custom") {
        setCustomBaseInput((prev) => prev || cloudTranscriptionBaseUrl);
      }
    },
    [
      cloudTranscriptionBaseUrl,
      resolveModelForProvider,
      selectedCloudModel,
      selectedCloudProvider,
      writeStoredModel,
    ]
  );

  const handleBaseUrlBlur = useCallback(() => {
    if (draftProvider !== "custom") return;

    const trimmed = (customBaseInput || "").trim();
    if (!trimmed) return;

    const normalized = normalizeBaseUrl(trimmed);
    if (normalized && normalized !== customBaseInput) {
      setCustomBaseInput(normalized);
    }

    // Auto-detect if this matches a known provider (for convenience).
    if (normalized) {
      for (const provider of cloudProviders) {
        if (provider.id === "custom") continue;
        const providerNormalized = normalizeBaseUrl(provider.baseUrl);
        if (normalized === providerNormalized) {
          setDraftProvider(provider.id);
          const nextModel =
            provider.id === selectedCloudProvider
              ? selectedCloudModel
              : resolveModelForProvider(provider.id);
          setDraftModel(nextModel);
          break;
        }
      }
    }
  }, [
    cloudProviders,
    customBaseInput,
    draftProvider,
    resolveModelForProvider,
    selectedCloudModel,
    selectedCloudProvider,
  ]);

  const currentCloudProvider = useMemo<TranscriptionProviderData | undefined>(
    () => cloudProviders.find((p) => p.id === draftProvider),
    [cloudProviders, draftProvider]
  );

  const cloudModelOptions = useMemo(() => {
    if (!currentCloudProvider) return [];
    return currentCloudProvider.models.map((m) => ({
      value: m.id,
      label: m.name,
      description: m.description,
      icon: getProviderIcon(draftProvider),
    }));
  }, [currentCloudProvider, draftProvider]);

  const apiKeyUrl = useMemo(() => {
    if (draftProvider === "assemblyai") return "https://www.assemblyai.com/dashboard";
    if (draftProvider === "groq") return "https://console.groq.com/keys";
    if (draftProvider === "zai") return "https://z.ai/manage-apikey/apikey-list";
    return "https://platform.openai.com/api-keys";
  }, [draftProvider]);

  const selectedApiKey = useMemo(() => {
    if (draftProvider === "assemblyai") return assemblyaiApiKey;
    if (draftProvider === "groq") return groqApiKey;
    if (draftProvider === "zai") return zaiApiKey;
    if (draftProvider === "custom") return customTranscriptionApiKey;
    return openaiApiKey;
  }, [
    assemblyaiApiKey,
    customTranscriptionApiKey,
    draftProvider,
    groqApiKey,
    openaiApiKey,
    zaiApiKey,
  ]);

  const selectedSetApiKey = useMemo(() => {
    if (draftProvider === "assemblyai") return setAssemblyAIApiKey;
    if (draftProvider === "groq") return setGroqApiKey;
    if (draftProvider === "zai") return setZaiApiKey;
    if (draftProvider === "custom") return setCustomTranscriptionApiKey;
    return setOpenaiApiKey;
  }, [
    draftProvider,
    setAssemblyAIApiKey,
    setCustomTranscriptionApiKey,
    setGroqApiKey,
    setOpenaiApiKey,
    setZaiApiKey,
  ]);

  const saveTranscriptionPrompt = useCallback(() => {
    try {
      const trimmedPrompt = transcriptionPrompt.trim();
      localStorage.setItem("transcriptionPrompt", trimmedPrompt);
      void platform.settings.set("transcriptionPrompt", trimmedPrompt);
      setPromptSaveState("saved");
      window.setTimeout(() => setPromptSaveState("idle"), 1500);
    } catch {
      setPromptSaveState("idle");
    }
  }, [transcriptionPrompt]);

  const resetTranscriptionPrompt = useCallback(() => {
    try {
      localStorage.removeItem("transcriptionPrompt");
      void platform.settings.set("transcriptionPrompt", "");
    } catch {
      // ignore
    }
    setTranscriptionPrompt("");
    setPromptSaveState("idle");
  }, []);

  const isCurrentDefault = useMemo(() => {
    const baseMatches =
      draftProvider !== "custom" ||
      normalizeBaseUrl(customBaseInput) === normalizeBaseUrl(cloudTranscriptionBaseUrl);
    return (
      draftProvider === selectedCloudProvider && draftModel === selectedCloudModel && baseMatches
    );
  }, [
    cloudTranscriptionBaseUrl,
    customBaseInput,
    draftModel,
    draftProvider,
    selectedCloudModel,
    selectedCloudProvider,
  ]);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setDraftModel(modelId);
      writeStoredModel(draftProvider, modelId);
      if (draftProvider === "local") {
        const familyByModel: Record<string, LocalAsrSettings["modelFamily"]> = {
          "sensevoice-int8": "sense-voice",
          "paraformer-zh": "paraformer",
          "whisper-onnx": "whisper",
          "qwen3-asr-onnx": "qwen3-asr",
          "r2t2-native-q4": "r2t2",
          "r2t2-external": "custom",
        };
        const family = familyByModel[modelId];
        if (family) updateLocalAsrSetting("modelFamily", family);
      }
    },
    [draftProvider, updateLocalAsrSetting, writeStoredModel]
  );

  const commitDraftModel = useCallback(
    (modelOverride?: string) => {
      setConnectionStatus("idle");
      setConnectionMessage("");
      const targetModel = (modelOverride || draftModel || "").trim();

      if (draftProvider === "custom") {
        const normalized = normalizeBaseUrl(customBaseInput.trim());
        const modelId = targetModel || "whisper-1";

        if (!normalized) {
          setConnectionStatus("error");
          setConnectionMessage(t("transcription.testConnection.missingFields"));
          return;
        }

        onCloudProviderSelect("custom");
        setCloudTranscriptionBaseUrl?.(normalized);
        onCloudModelSelect(modelId);
        setConnectionStatus("success");
        setConnectionMessage(t("transcription.defaultModelSet") || "Default model updated.");
        return;
      }

      if (draftProvider === "local") {
        const provider = cloudProviders.find((item) => item.id === "local");
        const modelIds = provider?.models?.map((item) => item.id) || [];
        const modelId = modelIds.includes(targetModel)
          ? targetModel
          : modelIds[0] || "sensevoice-int8";
        onCloudProviderSelect("local");
        setCloudTranscriptionBaseUrl?.("");
        onCloudModelSelect(modelId);
        writeStoredModel("local", modelId);
        setConnectionStatus("success");
        setConnectionMessage("本地 ASR 配置已启用。请先检查 runtime 和模型路径。");
        return;
      }

      const provider = cloudProviders.find((p) => p.id === draftProvider);
      if (!provider) {
        return;
      }

      const modelIds = provider.models?.map((m) => m.id) || [];
      const modelId = modelIds.includes(targetModel) ? targetModel : modelIds[0] || "";

      onCloudProviderSelect(provider.id);
      setCloudTranscriptionBaseUrl?.(provider.baseUrl);
      if (modelId) {
        onCloudModelSelect(modelId);
      }
      setConnectionStatus("success");
      setConnectionMessage(t("transcription.defaultModelSet") || "Default model updated.");
    },
    [
      cloudProviders,
      customBaseInput,
      draftModel,
      draftProvider,
      onCloudModelSelect,
      onCloudProviderSelect,
      setCloudTranscriptionBaseUrl,
      t,
      writeStoredModel,
    ]
  );

  const handleSetDefaultModel = useCallback(() => {
    commitDraftModel();
  }, [commitDraftModel]);

  const handleActivateModel = useCallback(
    (modelId: string) => {
      setDraftModel(modelId);
      writeStoredModel(draftProvider, modelId);
      commitDraftModel(modelId);
    },
    [commitDraftModel, draftProvider, writeStoredModel]
  );

  return (
    <div className={`space-y-4 ${className}`}>
      <ProviderTabs
        providers={providerTabs}
        selectedId={draftProvider}
        onSelect={handleDraftProviderChange}
        colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
        labelMode="hover"
      />

      <div className="p-5 bg-white border border-neutral-200 shadow-sm rounded-xl">
        {draftProvider === "local" ? (
          <div className="space-y-5">
            <div className="space-y-1">
              <h4 className="text-base font-semibold text-gray-900">本地 ASR 运行时</h4>
              <p className="text-xs leading-5 text-gray-500">
                ONNX 模型使用内置 sherpa-onnx；Confucius4-R2T2 使用进程内 llama.cpp，下载并选择
                模型后即可离线识别，无需配置外部可执行文件。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-gray-700">运行时</span>
                <select
                  value={effectiveLocalAsrSettings.runtime}
                  onChange={(event) =>
                    updateLocalAsrSetting(
                      "runtime",
                      event.target.value as LocalAsrSettings["runtime"]
                    )
                  }
                  className="h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-sm outline-none focus:border-neutral-400"
                >
                  <option value="sherpa-onnx">sherpa-onnx（内置 ONNX）</option>
                  <option value="llama.cpp">llama.cpp（内置 GGUF）</option>
                  <option value="openai-compatible">OpenAI-compatible 本地服务</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-gray-700">模型家族</span>
                <select
                  value={effectiveLocalAsrSettings.modelFamily}
                  onChange={(event) =>
                    updateLocalAsrSetting(
                      "modelFamily",
                      event.target.value as LocalAsrSettings["modelFamily"]
                    )
                  }
                  className="h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-sm outline-none focus:border-neutral-400"
                >
                  <option value="sense-voice">SenseVoice</option>
                  <option value="paraformer">Paraformer</option>
                  <option value="whisper">Whisper</option>
                  <option value="qwen3-asr">Qwen3-ASR</option>
                  <option value="r2t2">Confucius4-R2T2</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-neutral-700">
                      GGUF
                    </span>
                    <span className="font-medium text-gray-900">
                      Confucius4-R2T2（原生 llama.cpp）
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-600">
                    {nativeModel?.description ||
                      "进程内 llama.cpp 音频 GGUF；无需安装外部可执行文件。"}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    下载包：Q4_K_M + audio projector Q8_0，约 1.3 GB
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {nativeModel?.downloaded ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        selectedCloudProvider === "local" && selectedCloudModel === "r2t2-native-q4"
                          ? "outline"
                          : "default"
                      }
                      onClick={() => void selectNativeModel()}
                      disabled={nativeModelBusy}
                      className="shadow-none"
                    >
                      {nativeModelBusy ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : selectedCloudProvider === "local" &&
                        selectedCloudModel === "r2t2-native-q4" ? (
                        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      ) : null}
                      {selectedCloudProvider === "local" && selectedCloudModel === "r2t2-native-q4"
                        ? "已选择"
                        : "选择"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void downloadNativeModel()}
                      disabled={nativeModelBusy || nativeModelLoading}
                      className="shadow-none"
                    >
                      {nativeModelBusy ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      下载模型
                    </Button>
                  )}
                </div>
              </div>
              {nativeDownloadProgress && nativeModelBusy && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>正在下载模型文件…</span>
                    <span>{nativeDownloadProgress.progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-neutral-900 transition-[width]"
                      style={{ width: `${nativeDownloadProgress.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <ModelCardList
              models={cloudModelOptions.filter(
                (model) => model.value !== "r2t2-external" && model.value !== "r2t2-native-q4"
              )}
              selectedModel={draftModel}
              onModelSelect={handleModelSelect}
              activeModel={draftProvider === selectedCloudProvider ? selectedCloudModel : ""}
              activationMode="confirm"
              onModelActivate={handleActivateModel}
              colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
            />

            {effectiveLocalAsrSettings.runtime === "openai-compatible" && (
              <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium text-gray-700">本地服务端点</span>
                  <Input
                    value={effectiveLocalAsrSettings.endpoint}
                    onChange={(event) => updateLocalAsrSetting("endpoint", event.target.value)}
                    placeholder="http://127.0.0.1:8080/v1"
                    className="bg-white text-sm"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium text-gray-700">服务模型 ID</span>
                  <Input
                    value={effectiveLocalAsrSettings.modelPath}
                    onChange={(event) => updateLocalAsrSetting("modelPath", event.target.value)}
                    placeholder="whisper-1 / qwen3-asr"
                    className="bg-white text-sm"
                  />
                </label>
                <p className="text-[11px] leading-4 text-gray-500">
                  端点需提供 OpenAI 风格的 <code>/audio/transcriptions</code> multipart 接口；仅允许
                  HTTPS 或本机/内网 HTTP。
                </p>
              </div>
            )}

            {effectiveLocalAsrSettings.runtime === "sherpa-onnx" && (
              <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                <p className="text-xs leading-5 text-gray-500">
                  路径直接指向模型文件。SenseVoice/Paraformer 需要单个 ONNX 文件；Whisper 需要
                  encoder 和 decoder；Qwen3-ASR 需要四件 sherpa-onnx 导出文件。
                </p>
                {(effectiveLocalAsrSettings.modelFamily === "sense-voice" ||
                  effectiveLocalAsrSettings.modelFamily === "paraformer") && (
                  <label className="block space-y-1.5">
                    <span className="block text-sm font-medium text-gray-700">模型文件</span>
                    <Input
                      value={effectiveLocalAsrSettings.modelPath}
                      onChange={(event) => updateLocalAsrSetting("modelPath", event.target.value)}
                      placeholder="model.int8.onnx"
                      className="bg-white text-sm"
                    />
                  </label>
                )}
                {effectiveLocalAsrSettings.modelFamily === "whisper" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["encoderPath", "decoderPath"] as const).map((key) => (
                      <label key={key} className="space-y-1.5">
                        <span className="block text-sm font-medium text-gray-700">
                          {key === "encoderPath" ? "Encoder 文件" : "Decoder 文件"}
                        </span>
                        <Input
                          value={effectiveLocalAsrSettings[key]}
                          onChange={(event) => updateLocalAsrSetting(key, event.target.value)}
                          placeholder={`${key}.onnx`}
                          className="bg-white text-sm"
                        />
                      </label>
                    ))}
                  </div>
                )}
                {effectiveLocalAsrSettings.modelFamily === "qwen3-asr" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["convFrontendPath", "Conv frontend"],
                        ["encoderPath", "Encoder"],
                        ["decoderPath", "Decoder"],
                        ["tokenizerPath", "Tokenizer"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="space-y-1.5">
                        <span className="block text-sm font-medium text-gray-700">{label}</span>
                        <Input
                          value={effectiveLocalAsrSettings[key]}
                          onChange={(event) => updateLocalAsrSetting(key, event.target.value)}
                          placeholder={`${label} 文件路径`}
                          className="bg-white text-sm"
                        />
                      </label>
                    ))}
                  </div>
                )}
                <label className="block max-w-[220px] space-y-1.5">
                  <span className="block text-sm font-medium text-gray-700">CPU 线程数</span>
                  <Input
                    type="number"
                    min={1}
                    max={64}
                    value={effectiveLocalAsrSettings.numThreads}
                    onChange={(event) =>
                      updateLocalAsrSetting(
                        "numThreads",
                        Math.max(1, Math.min(64, Number.parseInt(event.target.value, 10) || 1))
                      )
                    }
                    className="bg-white text-sm"
                  />
                </label>
              </div>
            )}

            {effectiveLocalAsrSettings.runtime === "llama.cpp" && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-xs leading-5 text-gray-600">
                识别时由应用进程内加载 GGUF 与 audio projector。请在上方模型卡片中完成下载，
                再点击“选择”设为默认；这里不需要填写 exe、命令参数或模型目录。
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void checkLocalRuntime()}
                disabled={localRuntimeStatus === "checking"}
                className="shadow-none"
              >
                {localRuntimeStatus === "checking" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                )}
                检查运行时
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSetDefaultModel}
                disabled={!draftModel.trim()}
                className="shadow-none"
              >
                启用本地 ASR
              </Button>
              {localRuntimeMessage && (
                <span
                  className={`text-xs ${localRuntimeStatus === "ready" ? "text-green-600" : "text-red-600"}`}
                >
                  {localRuntimeMessage}
                </span>
              )}
            </div>
          </div>
        ) : draftProvider === "volcengine" ? (
          <div className="space-y-4">
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700">豆包语音识别</h4>
              <p className="text-xs text-gray-500">
                新版控制台只填 API Key；旧版控制台填写 APP ID 和 Access Token。
              </p>
              <a
                href="https://console.volcengine.com/speech/service/8"
                target="_blank"
                rel="noopener noreferrer"
                onClick={createExternalLinkHandler(
                  "https://console.volcengine.com/speech/service/8"
                )}
                className="text-xs text-neutral-600 hover:text-neutral-800 underline cursor-pointer"
              >
                前往豆包控制台获取凭证
              </a>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">APP ID（旧版可选）</h4>
              <Input
                value={volcengineAppId}
                onChange={(e) => setVolcengineAppId?.(e.target.value)}
                placeholder="新版 API Key 可留空"
                className="text-sm"
              />
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">API Key / Access Token</h4>
              <ApiKeyInput
                apiKey={volcengineAccessToken}
                setApiKey={(val) => setVolcengineAccessToken?.(val)}
                label=""
                helpText=""
              />
            </div>

            <div className="pt-4 space-y-3">
              <h4 className="text-sm font-medium text-gray-700">
                {t("transcription.selectModel")}
              </h4>
              <ModelCardList
                models={cloudModelOptions}
                selectedModel={draftModel}
                onModelSelect={handleModelSelect}
                activeModel={draftProvider === selectedCloudProvider ? selectedCloudModel : ""}
                activationMode="confirm"
                onModelActivate={handleActivateModel}
                colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
              />
            </div>
          </div>
        ) : draftProvider === "custom" ? (
          <div className="space-y-4">
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700">
                {t("transcription.customEndpoint.title")}
              </h4>
              <p className="text-xs text-gray-500">{t("transcription.customEndpoint.desc")}</p>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">{t("transcription.endpointUrl")}</h4>
              <Input
                value={customBaseInput}
                onChange={(e) => {
                  setCustomBaseInput(e.target.value);
                  setCustomFetchedModels([]);
                  setConnectionStatus("idle");
                  setConnectionMessage("");
                }}
                onBlur={handleBaseUrlBlur}
                placeholder="https://your-api.example.com/v1"
                className="text-sm"
              />
              <p className="text-xs text-gray-500">
                {t("transcription.examples")}{" "}
                <code className="text-neutral-700">http://localhost:11434/v1</code> (Ollama),{" "}
                <code className="text-neutral-700">http://localhost:8080/v1</code> (LocalAI).
                <br />
                {t("transcription.providerDetection")}
              </p>
            </div>

            <div className="space-y-3 pt-4">
              <h4 className="font-medium text-gray-900">{t("transcription.apiKeyOptional")}</h4>
              <ApiKeyInput
                apiKey={customTranscriptionApiKey}
                setApiKey={(value) => {
                  setCustomTranscriptionApiKey(value);
                  setCustomFetchedModels([]);
                  setConnectionStatus("idle");
                  setConnectionMessage("");
                }}
                label=""
                helpText={t("transcription.apiKeyHelp")}
              />
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">模型列表</label>
                  <p className="text-xs text-gray-500">
                    填入端点和 API Key 后获取模型列表，选中模型后点击启用。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={fetchCustomModels}
                  disabled={isTestingConnection || !customBaseInput.trim()}
                  className="h-7 shrink-0 rounded-md border-neutral-200 px-2 text-[11px] shadow-none hover:border-neutral-300 hover:bg-neutral-50 [&_svg]:size-3"
                  size="sm"
                >
                  {isTestingConnection ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                  )}
                  {isTestingConnection ? "获取中" : "获取模型列表"}
                </Button>
              </div>

              {connectionMessage && (
                <p
                  className={`text-xs ${connectionStatus === "success" ? "text-green-600" : connectionStatus === "error" ? "text-red-600" : "text-gray-500"}`}
                >
                  {connectionMessage}
                </p>
              )}

              {customFetchedModels.length > 0 && (
                <ModelCardList
                  models={customFetchedModels}
                  selectedModel={draftModel}
                  onModelSelect={handleModelSelect}
                  activeModel={draftProvider === selectedCloudProvider ? selectedCloudModel : ""}
                  activationMode="confirm"
                  onModelActivate={handleActivateModel}
                  colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
                />
              )}

              <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                <label className="block text-sm font-medium text-gray-700">
                  {t("transcription.modelName")}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={draftModel}
                    onChange={(e) => handleModelSelect(e.target.value)}
                    placeholder="whisper-1"
                    className="flex-1 bg-white text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSetDefaultModel}
                    disabled={isCurrentDefault || !draftModel.trim()}
                    className="h-9 shrink-0 px-3 text-xs shadow-none"
                  >
                    {isCurrentDefault ? t("transcription.defaultModel") : "启用"}
                  </Button>
                </div>
                <p className="text-xs text-gray-500">{t("transcription.modelNameDesc")}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              <div className="space-y-1">
                <h4 className="text-base font-semibold text-gray-900">
                  {t("transcription.apiKey")}
                </h4>
                <a
                  href={apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={createExternalLinkHandler(apiKeyUrl)}
                  className="block text-xs text-neutral-500 underline underline-offset-4 transition-colors hover:text-neutral-900"
                >
                  {t("transcription.getKey")}
                </a>
              </div>
              <ApiKeyInput
                apiKey={selectedApiKey}
                setApiKey={selectedSetApiKey}
                label=""
                helpText=""
              />
            </div>

            <div className="pt-4 space-y-3">
              <h4 className="text-sm font-medium text-gray-700">
                {t("transcription.selectModel")}
              </h4>
              <ModelCardList
                models={cloudModelOptions}
                selectedModel={draftModel}
                onModelSelect={handleModelSelect}
                activeModel={draftProvider === selectedCloudProvider ? selectedCloudModel : ""}
                activationMode="confirm"
                onModelActivate={handleActivateModel}
                colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
              />

              {variant === "settings" && draftProvider === "assemblyai" && (
                <div className="space-y-6 pt-4 border-t border-gray-200">
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">
                        {t("transcription.prompt.title")}
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">{t("transcription.prompt.desc")}</p>
                    </div>
                    <Textarea
                      value={transcriptionPrompt}
                      onChange={(e) => setTranscriptionPrompt(e.target.value)}
                      placeholder={t("transcription.prompt.placeholder")}
                      rows={4}
                    />
                    <p className="text-xs text-gray-500">
                      {draftProvider === "assemblyai" && draftModel === "universal-3-pro"
                        ? t("transcription.prompt.assemblyaiActive")
                        : t("transcription.prompt.assemblyaiOnly")}
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={resetTranscriptionPrompt}
                      >
                        {t("transcription.prompt.reset")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={saveTranscriptionPrompt}
                      >
                        {promptSaveState === "saved"
                          ? t("transcription.prompt.saved")
                          : t("transcription.prompt.save")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
