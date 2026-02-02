import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ProviderTabs } from "./ui/ProviderTabs";
import ModelCardList from "./ui/ModelCardList";
import ApiKeyInput from "./ui/ApiKeyInput";
import { getTranscriptionProviders, type TranscriptionProviderData } from "../models/ModelRegistry";
import { MODEL_PICKER_COLORS, type ColorScheme } from "../utils/modelPickerStyles";
import { getProviderIcon } from "../utils/providerIcons";
import { API_ENDPOINTS, normalizeBaseUrl } from "../config/constants";
import { createExternalLinkHandler } from "../utils/externalLinks";
import { useI18n } from "../i18n";

interface TranscriptionModelPickerProps {
  selectedCloudProvider: string;
  onCloudProviderSelect: (providerId: string) => void;
  selectedCloudModel: string;
  onCloudModelSelect: (modelId: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  customTranscriptionApiKey: string;
  setCustomTranscriptionApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  zaiApiKey: string;
  setZaiApiKey: (key: string) => void;
  cloudTranscriptionBaseUrl?: string;
  setCloudTranscriptionBaseUrl?: (url: string) => void;
  className?: string;
  variant?: "onboarding" | "settings";
}

const CLOUD_PROVIDER_TABS = [
  { id: "openai", name: "OpenAI" },
  { id: "groq", name: "Groq" },
  { id: "zai", name: "Z.ai" },
  { id: "custom", name: "Custom" },
];

const VALID_CLOUD_PROVIDER_IDS = CLOUD_PROVIDER_TABS.map((p) => p.id);

export default function TranscriptionModelPicker({
  selectedCloudProvider,
  onCloudProviderSelect,
  selectedCloudModel,
  onCloudModelSelect,
  openaiApiKey,
  setOpenaiApiKey,
  customTranscriptionApiKey,
  setCustomTranscriptionApiKey,
  groqApiKey,
  setGroqApiKey,
  zaiApiKey,
  setZaiApiKey,
  cloudTranscriptionBaseUrl = "",
  setCloudTranscriptionBaseUrl,
  className = "",
  variant = "settings",
}: TranscriptionModelPickerProps) {
  const { t } = useI18n();
  const colorScheme: ColorScheme = variant === "settings" ? "purple" : "blue";
  const styles = useMemo(() => MODEL_PICKER_COLORS[colorScheme], [colorScheme]);

  // 连接测试状态
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");

  // Draft selection for browsing. Default transcription only updates when user clicks "Set as Default".
  const [draftProvider, setDraftProvider] = useState(() => {
    return VALID_CLOUD_PROVIDER_IDS.includes(selectedCloudProvider)
      ? selectedCloudProvider
      : "openai";
  });
  const [draftModel, setDraftModel] = useState(selectedCloudModel);
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
  const testConnection = useCallback(async () => {
    const baseValue = customBaseInput.trim();
    const modelValue = draftModel.trim();

    if (!baseValue || !modelValue) {
      setConnectionStatus("error");
      setConnectionMessage(
        t("transcription.testConnection.missingFields") || "请填写端点 URL 和模型名称"
      );
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus("idle");
    setConnectionMessage("");

    try {
      // 尝试调用 /models 端点检查连接
      const baseUrl = baseValue.replace(/\/+$/, "");
      const modelsUrl = `${baseUrl}/models`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
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
        setConnectionStatus("success");
        setConnectionMessage(t("transcription.testConnection.success") || "连接成功！");
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
  }, [customBaseInput, customTranscriptionApiKey, draftModel, t]);

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
      : "openai";
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
    if (draftProvider === "groq") return "https://console.groq.com/keys";
    if (draftProvider === "zai") return "https://z.ai/manage-apikey/apikey-list";
    return "https://platform.openai.com/api-keys";
  }, [draftProvider]);

  const selectedApiKey = useMemo(() => {
    if (draftProvider === "groq") return groqApiKey;
    if (draftProvider === "zai") return zaiApiKey;
    if (draftProvider === "custom") return customTranscriptionApiKey;
    return openaiApiKey;
  }, [customTranscriptionApiKey, draftProvider, groqApiKey, openaiApiKey, zaiApiKey]);

  const selectedSetApiKey = useMemo(() => {
    if (draftProvider === "groq") return setGroqApiKey;
    if (draftProvider === "zai") return setZaiApiKey;
    if (draftProvider === "custom") return setCustomTranscriptionApiKey;
    return setOpenaiApiKey;
  }, [draftProvider, setCustomTranscriptionApiKey, setGroqApiKey, setOpenaiApiKey, setZaiApiKey]);

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
    },
    [draftProvider, writeStoredModel]
  );

  const handleSetDefaultModel = useCallback(() => {
    setConnectionStatus("idle");
    setConnectionMessage("");

    if (draftProvider === "custom") {
      const normalized = normalizeBaseUrl(customBaseInput.trim());
      const modelId = (draftModel || "").trim() || "whisper-1";

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

    const provider = cloudProviders.find((p) => p.id === draftProvider);
    if (!provider) {
      return;
    }

    const modelIds = provider.models?.map((m) => m.id) || [];
    const modelId = modelIds.includes(draftModel) ? draftModel : modelIds[0] || "";

    onCloudProviderSelect(provider.id);
    setCloudTranscriptionBaseUrl?.(provider.baseUrl);
    if (modelId) {
      onCloudModelSelect(modelId);
    }
    setConnectionStatus("success");
    setConnectionMessage(t("transcription.defaultModelSet") || "Default model updated.");
  }, [
    cloudProviders,
    customBaseInput,
    draftModel,
    draftProvider,
    onCloudModelSelect,
    onCloudProviderSelect,
    setCloudTranscriptionBaseUrl,
    t,
  ]);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className={styles.container}>
        <ProviderTabs
          providers={providerTabs}
          selectedId={draftProvider}
          onSelect={handleDraftProviderChange}
          colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
          scrollable
        />

        <div className="p-4">
          {draftProvider === "custom" ? (
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
                  onChange={(e) => setCustomBaseInput(e.target.value)}
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
                  setApiKey={setCustomTranscriptionApiKey}
                  label=""
                  helpText={t("transcription.apiKeyHelp")}
                />
              </div>

              <div className="space-y-2 pt-4">
                <label className="block text-sm font-medium text-gray-700">
                  {t("transcription.modelName")}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={draftModel}
                    onChange={(e) => handleModelSelect(e.target.value)}
                    placeholder="whisper-1"
                    className="text-sm flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={testConnection}
                    disabled={isTestingConnection}
                    className="shrink-0"
                    size="sm"
                  >
                    {isTestingConnection ? (
                      <span className="flex items-center gap-2">
                        {/* Simple loading spinner */}
                        <svg
                          className="animate-spin h-3 w-3 text-current"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        {t("transcription.testConnection.checking") || "Checking..."}
                      </span>
                    ) : (
                      t("transcription.testConnection.button") || "Check Connection"
                    )}
                  </Button>
                </div>

                {/* Connection Status Message */}
                {connectionMessage && (
                  <p
                    className={`text-xs ${connectionStatus === "success" ? "text-green-600" : connectionStatus === "error" ? "text-red-600" : "text-gray-500"}`}
                  >
                    {connectionMessage}
                  </p>
                )}

                <p className="text-xs text-gray-500">{t("transcription.modelNameDesc")}</p>

                <div className="pt-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSetDefaultModel}
                    disabled={isCurrentDefault}
                  >
                    {isCurrentDefault
                      ? t("transcription.defaultModel")
                      : t("transcription.setDefaultModel")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 mb-4">
                <div className="flex items-baseline justify-between">
                  <h4 className="font-medium text-gray-900">{t("transcription.apiKey")}</h4>
                  <a
                    href={apiKeyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={createExternalLinkHandler(apiKeyUrl)}
                    className="text-xs text-neutral-600 hover:text-neutral-800 underline cursor-pointer"
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
                  colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
                />

                <div className="pt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleSetDefaultModel}
                    disabled={isCurrentDefault}
                  >
                    {isCurrentDefault
                      ? t("transcription.defaultModel")
                      : t("transcription.setDefaultModel")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
