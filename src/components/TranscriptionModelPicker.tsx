import { useCallback, useEffect, useMemo } from "react";
import { Input } from "./ui/input";
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
                  {t("transcription.examples")} <code className="text-purple-600">http://localhost:11434/v1</code>{" "}
                  (Ollama), <code className="text-purple-600">http://localhost:8080/v1</code>{" "}
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
                <Input
                  value={selectedCloudModel}
                  onChange={(e) => onCloudModelSelect(e.target.value)}
                  placeholder="whisper-1"
                  className="text-sm"
                />
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
                    className="text-xs text-blue-600 hover:text-blue-700 underline cursor-pointer"
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
