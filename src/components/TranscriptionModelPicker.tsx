import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ProviderTabs } from "./ui/ProviderTabs";
import ModelCardList from "./ui/ModelCardList";
import ApiKeyInput from "./ui/ApiKeyInput";
import {
  getTranscriptionProviders,
  type TranscriptionProviderData,
} from "../models/ModelRegistry";
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

  // 检查连接函数
  const testConnection = useCallback(async () => {
    if (!cloudTranscriptionBaseUrl || !selectedCloudModel) {
      setConnectionStatus("error");
      setConnectionMessage(t("transcription.testConnection.missingFields") || "请填写端点 URL 和模型名称");
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus("idle");
    setConnectionMessage("");

    try {
      // 尝试调用 /models 端点检查连接
      const baseUrl = cloudTranscriptionBaseUrl.replace(/\/+$/, "");
      const modelsUrl = `${baseUrl}/models`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (openaiApiKey) {
        headers["Authorization"] = `Bearer ${openaiApiKey}`;
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
        setConnectionMessage(`${t("transcription.testConnection.failed") || "连接失败"}: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      setConnectionStatus("error");
      setConnectionMessage(`${t("transcription.testConnection.error") || "连接错误"}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsTestingConnection(false);
    }
  }, [cloudTranscriptionBaseUrl, selectedCloudModel, openaiApiKey, t]);

  const providerTabs = useMemo(
    () =>
      CLOUD_PROVIDER_TABS.map((tab) => ({
        ...tab,
        name: tab.id === "custom" ? t("common.custom") : tab.name,
      })),
    [t]
  );

  const cloudProviders = useMemo(() => getTranscriptionProviders(), []);

  const ensureValidCloudSelection = useCallback(() => {
    const isValidProvider = VALID_CLOUD_PROVIDER_IDS.includes(selectedCloudProvider);

    if (!isValidProvider) {
      const knownProviderUrls = cloudProviders.map((p) => p.baseUrl);
      const hasCustomUrl =
        cloudTranscriptionBaseUrl.trim() !== "" &&
        cloudTranscriptionBaseUrl !== API_ENDPOINTS.TRANSCRIPTION_BASE &&
        !knownProviderUrls.includes(cloudTranscriptionBaseUrl);

      if (hasCustomUrl) {
        onCloudProviderSelect("custom");
        if (!selectedCloudModel) {
          onCloudModelSelect("whisper-1");
        }
        return;
      }

      const firstProvider = cloudProviders[0];
      if (firstProvider) {
        onCloudProviderSelect(firstProvider.id);
        if (firstProvider.models?.length) {
          onCloudModelSelect(firstProvider.models[0].id);
        }
        setCloudTranscriptionBaseUrl?.(firstProvider.baseUrl);
      }
      return;
    }

    if (selectedCloudProvider !== "custom" && !selectedCloudModel) {
      const provider = cloudProviders.find((p) => p.id === selectedCloudProvider);
      if (provider?.models?.length) {
        onCloudModelSelect(provider.models[0].id);
      }
    }
  }, [
    cloudProviders,
    cloudTranscriptionBaseUrl,
    onCloudModelSelect,
    onCloudProviderSelect,
    selectedCloudModel,
    selectedCloudProvider,
    setCloudTranscriptionBaseUrl,
  ]);

  useEffect(() => {
    ensureValidCloudSelection();
  }, [ensureValidCloudSelection]);

  const handleCloudProviderChange = useCallback(
    (providerId: string) => {
      onCloudProviderSelect(providerId);

      if (providerId === "custom") {
        // Avoid sending provider-specific models to arbitrary endpoints by default.
        onCloudModelSelect("whisper-1");
        return;
      }

      const provider = cloudProviders.find((p) => p.id === providerId);
      if (!provider) {
        return;
      }

      setCloudTranscriptionBaseUrl?.(provider.baseUrl);
      if (provider.models?.length) {
        onCloudModelSelect(provider.models[0].id);
      }
    },
    [cloudProviders, onCloudProviderSelect, onCloudModelSelect, setCloudTranscriptionBaseUrl]
  );

  const handleBaseUrlBlur = useCallback(() => {
    if (!setCloudTranscriptionBaseUrl || selectedCloudProvider !== "custom") {
      return;
    }

    const trimmed = (cloudTranscriptionBaseUrl || "").trim();
    if (!trimmed) {
      return;
    }

    const normalized = normalizeBaseUrl(trimmed);
    if (normalized && normalized !== cloudTranscriptionBaseUrl) {
      setCloudTranscriptionBaseUrl(normalized);
    }

    // Auto-detect if this matches a known provider.
    if (normalized) {
      for (const provider of cloudProviders) {
        const providerNormalized = normalizeBaseUrl(provider.baseUrl);
        if (normalized === providerNormalized) {
          onCloudProviderSelect(provider.id);
          setCloudTranscriptionBaseUrl(provider.baseUrl);
          if (provider.models?.length) {
            onCloudModelSelect(provider.models[0].id);
          }
          break;
        }
      }
    }
  }, [
    cloudProviders,
    cloudTranscriptionBaseUrl,
    onCloudModelSelect,
    onCloudProviderSelect,
    selectedCloudProvider,
    setCloudTranscriptionBaseUrl,
  ]);

  const currentCloudProvider = useMemo<TranscriptionProviderData | undefined>(
    () => cloudProviders.find((p) => p.id === selectedCloudProvider),
    [cloudProviders, selectedCloudProvider]
  );

  const cloudModelOptions = useMemo(() => {
    if (!currentCloudProvider) return [];
    return currentCloudProvider.models.map((m) => ({
      value: m.id,
      label: m.name,
      description: m.description,
      icon: getProviderIcon(selectedCloudProvider),
    }));
  }, [currentCloudProvider, selectedCloudProvider]);

  const apiKeyUrl = useMemo(() => {
    if (selectedCloudProvider === "groq") return "https://console.groq.com/keys";
    if (selectedCloudProvider === "zai") return "https://z.ai/manage-apikey/apikey-list";
    return "https://platform.openai.com/api-keys";
  }, [selectedCloudProvider]);

  const selectedApiKey = useMemo(() => {
    if (selectedCloudProvider === "groq") return groqApiKey;
    if (selectedCloudProvider === "zai") return zaiApiKey;
    return openaiApiKey;
  }, [groqApiKey, openaiApiKey, selectedCloudProvider, zaiApiKey]);

  const selectedSetApiKey = useMemo(() => {
    if (selectedCloudProvider === "groq") return setGroqApiKey;
    if (selectedCloudProvider === "zai") return setZaiApiKey;
    return setOpenaiApiKey;
  }, [selectedCloudProvider, setGroqApiKey, setOpenaiApiKey, setZaiApiKey]);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className={styles.container}>
        <ProviderTabs
          providers={providerTabs}
          selectedId={selectedCloudProvider}
          onSelect={handleCloudProviderChange}
          colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
          scrollable
        />

        <div className="p-4">
          {selectedCloudProvider === "custom" ? (
            <div className="space-y-4">
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700">{t("transcription.customEndpoint.title")}</h4>
                <p className="text-xs text-gray-500">
                  {t("transcription.customEndpoint.desc")}
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium text-gray-900">{t("transcription.endpointUrl")}</h4>
                <Input
                  value={cloudTranscriptionBaseUrl}
                  onChange={(e) => setCloudTranscriptionBaseUrl?.(e.target.value)}
                  onBlur={handleBaseUrlBlur}
                  placeholder="https://your-api.example.com/v1"
                  className="text-sm"
                />
                <p className="text-xs text-gray-500">
                  {t("transcription.examples")} <code className="text-neutral-700">http://localhost:11434/v1</code>{" "}
                  (Ollama), <code className="text-neutral-700">http://localhost:8080/v1</code>{" "}
                  (LocalAI).
                  <br />
                  {t("transcription.providerDetection")}
                </p>
              </div>

              <div className="space-y-3 pt-4">
                <h4 className="font-medium text-gray-900">{t("transcription.apiKeyOptional")}</h4>
                <ApiKeyInput
                  apiKey={openaiApiKey}
                  setApiKey={setOpenaiApiKey}
                  label=""
                  helpText={t("transcription.apiKeyHelp")}
                />
              </div>

              <div className="space-y-2 pt-4">
                <label className="block text-sm font-medium text-gray-700">{t("transcription.modelName")}</label>
                <div className="flex gap-2">
                  <Input
                    value={selectedCloudModel}
                    onChange={(e) => onCloudModelSelect(e.target.value)}
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
                        <svg className="animate-spin h-3 w-3 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
                  <p className={`text-xs ${connectionStatus === 'success' ? 'text-green-600' : connectionStatus === 'error' ? 'text-red-600' : 'text-gray-500'}`}>
                    {connectionMessage}
                  </p>
                )}

                <p className="text-xs text-gray-500">
                  {t("transcription.modelNameDesc")}
                </p>
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
                <h4 className="text-sm font-medium text-gray-700">{t("transcription.selectModel")}</h4>
                <ModelCardList
                  models={cloudModelOptions}
                  selectedModel={selectedCloudModel}
                  onModelSelect={onCloudModelSelect}
                  colorScheme={colorScheme === "purple" ? "purple" : "indigo"}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
