import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Cloud } from "lucide-react";
import ApiKeyInput from "./ui/ApiKeyInput";
import ModelCardList from "./ui/ModelCardList";

import { ProviderTabs } from "./ui/ProviderTabs";
import { API_ENDPOINTS, buildApiUrl, normalizeBaseUrl } from "../config/constants";
import { REASONING_PROVIDERS } from "../models/ModelRegistry";

import { getProviderIcon } from "../utils/providerIcons";
import { isSecureEndpoint } from "../utils/urlUtils";
import { createExternalLinkHandler } from "../utils/externalLinks";
import { useI18n } from "../i18n";

type CloudModelOption = {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  ownedBy?: string;
};

const OWNED_BY_ICON_RULES: Array<{ match: RegExp; provider: string }> = [
  { match: /(openai|system|default|gpt|davinci)/, provider: "openai" },
  { match: /(azure)/, provider: "openai" },
  { match: /(anthropic|claude)/, provider: "anthropic" },
  { match: /(google|gemini)/, provider: "gemini" },
  { match: /(meta|llama)/, provider: "llama" },
  { match: /(mistral)/, provider: "mistral" },
  { match: /(qwen|ali|tongyi)/, provider: "qwen" },
  { match: /(openrouter|oss)/, provider: "openai-oss" },
];

const resolveOwnedByIcon = (ownedBy?: string): string | undefined => {
  if (!ownedBy) return undefined;
  const normalized = ownedBy.toLowerCase();
  const rule = OWNED_BY_ICON_RULES.find(({ match }) => match.test(normalized));
  if (rule) {
    return getProviderIcon(rule.provider);
  }
  return undefined;
};

interface ReasoningModelSelectorProps {
  useReasoningModel: boolean;
  setUseReasoningModel: (value: boolean) => void;
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
  localReasoningProvider: string;
  setLocalReasoningProvider: (provider: string) => void;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (value: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  showAlertDialog: (dialog: { title: string; description: string }) => void;
}

export default function ReasoningModelSelector({
  useReasoningModel,
  setUseReasoningModel,
  reasoningModel,
  setReasoningModel,
  localReasoningProvider,
  setLocalReasoningProvider,
  cloudReasoningBaseUrl,
  setCloudReasoningBaseUrl,
  openaiApiKey,
  setOpenaiApiKey,
  anthropicApiKey,
  setAnthropicApiKey,
  geminiApiKey,
  setGeminiApiKey,
  groqApiKey,
  setGroqApiKey,
}: ReasoningModelSelectorProps) {
  const { t } = useI18n();
  const [selectedCloudProvider, setSelectedCloudProvider] = useState("openai");
  const [customModelOptions, setCustomModelOptions] = useState<CloudModelOption[]>([]);
  const [customModelsLoading, setCustomModelsLoading] = useState(false);
  const [customModelsError, setCustomModelsError] = useState<string | null>(null);
  const [customBaseInput, setCustomBaseInput] = useState(cloudReasoningBaseUrl);
  const lastLoadedBaseRef = useRef<string | null>(null);
  const pendingBaseRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  // Connection testing state
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");

  const testConnection = useCallback(async () => {
    // FIX: Use current input value instead of potentially stale prop
    const targetUrl = customBaseInput.trim();

    if (!targetUrl || !reasoningModel) {
      setConnectionStatus("error");
      setConnectionMessage(t("transcription.testConnection.missingFields") || "Please fill in Endpoint URL and Model Name");
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus("idle");
    setConnectionMessage("");

    try {
      const normalizedBase = normalizeBaseUrl(targetUrl);
      if (!normalizedBase || !normalizedBase.includes("://")) {
        setConnectionStatus("error");
        setConnectionMessage(
          "Enter a full base URL including protocol (e.g. https://server/v1)."
        );
        return;
      }

      if (!isSecureEndpoint(normalizedBase)) {
        setConnectionStatus("error");
        setConnectionMessage("HTTPS required (HTTP allowed for local network only).");
        return;
      }

      const modelsUrl = buildApiUrl(normalizedBase, "/models");
      const headers: Record<string, string> = {};

      // Use logic similar to loadRemoteModels for key resolution
      const keyFromState = openaiApiKey?.trim();
      const apiKey = keyFromState && keyFromState.length > 0
        ? keyFromState
        : await window.electronAPI?.getOpenAIKey?.();

      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5000);

      let response: Response | null = null;
      try {
        response = await fetch(modelsUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const tryFallbackChat = async (): Promise<boolean> => {
        const endpoint = buildApiUrl(normalizedBase, "/chat/completions");
        const fallbackController = new AbortController();
        const fallbackTimeout = window.setTimeout(() => fallbackController.abort(), 5000);
        try {
          const fallbackRes = await fetch(endpoint, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: reasoningModel,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              temperature: 0,
            }),
            signal: fallbackController.signal,
          });

          if (!fallbackRes.ok) {
            const fallbackText = await fallbackRes.text().catch(() => "");
            throw new Error(
              `${fallbackRes.status} ${fallbackRes.statusText}${fallbackText ? `: ${fallbackText.slice(0, 200)}` : ""}`
            );
          }

          return true;
        } finally {
          window.clearTimeout(fallbackTimeout);
        }
      };

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const isModelsUnsupported = response.status === 404 || response.status === 405;
        if (isModelsUnsupported) {
          await tryFallbackChat();
          setConnectionStatus("success");
          setConnectionMessage(t("transcription.testConnection.success") || "Connection successful!");
        } else {
          setConnectionStatus("error");
          setConnectionMessage(
            `${t("transcription.testConnection.failed") || "Connection failed"}: ${response.status} ${response.statusText}${errorText ? `: ${errorText.slice(0, 200)}` : ""}`
          );
        }
      } else {
        const payload = await response.json().catch(() => ({}));
        const rawModels = Array.isArray((payload as any)?.data)
          ? (payload as any).data
          : Array.isArray((payload as any)?.models)
            ? (payload as any).models
            : [];
        const modelIds = rawModels
          .map((item: any) => item?.id || item?.name)
          .filter((id: any) => typeof id === "string") as string[];

        if (modelIds.length > 0 && !modelIds.includes(reasoningModel)) {
          setConnectionStatus("error");
          setConnectionMessage(
            `Endpoint reachable but model not found: ${reasoningModel}`
          );
        } else {
          setConnectionStatus("success");
          setConnectionMessage(t("transcription.testConnection.success") || "Connection successful!");

          // Auto-save the valid URL if it differs from saved state
          if (targetUrl !== cloudReasoningBaseUrl) {
            const normalized = normalizeBaseUrl(targetUrl);
            setCloudReasoningBaseUrl(normalized);
          }
        }
      }
    } catch (error) {
      setConnectionStatus("error");
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = error instanceof Error && error.name === "AbortError";
      const isGenericFetch = /Failed to fetch/i.test(message);
      const suffix = timedOut
        ? "Request timed out"
        : isGenericFetch
          ? "Request failed (possible CORS / network / TLS issue)"
          : message;
      setConnectionMessage(`${t("transcription.testConnection.error") || "Connection error"}: ${suffix}`);
    } finally {
      setIsTestingConnection(false);
    }
  }, [customBaseInput, cloudReasoningBaseUrl, reasoningModel, openaiApiKey, t, setCloudReasoningBaseUrl]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setCustomBaseInput(cloudReasoningBaseUrl);
  }, [cloudReasoningBaseUrl]);

  const defaultOpenAIBase = useMemo(() => normalizeBaseUrl(API_ENDPOINTS.OPENAI_BASE), []);
  const normalizedCustomReasoningBase = useMemo(
    () => normalizeBaseUrl(cloudReasoningBaseUrl),
    [cloudReasoningBaseUrl]
  );
  const latestReasoningBaseRef = useRef(normalizedCustomReasoningBase);

  useEffect(() => {
    latestReasoningBaseRef.current = normalizedCustomReasoningBase;
  }, [normalizedCustomReasoningBase]);

  const hasCustomBase = normalizedCustomReasoningBase !== "";
  const effectiveReasoningBase = hasCustomBase ? normalizedCustomReasoningBase : defaultOpenAIBase;

  const loadRemoteModels = useCallback(
    async (baseOverride?: string, force = false) => {
      const rawBase = (baseOverride ?? cloudReasoningBaseUrl) || "";
      const normalizedBase = normalizeBaseUrl(rawBase);

      if (!normalizedBase) {
        if (isMountedRef.current) {
          setCustomModelsLoading(false);
          setCustomModelsError(null);
          setCustomModelOptions([]);
        }
        return;
      }

      if (!force && lastLoadedBaseRef.current === normalizedBase) return;
      if (!force && pendingBaseRef.current === normalizedBase) return;

      if (baseOverride !== undefined) {
        latestReasoningBaseRef.current = normalizedBase;
      }

      pendingBaseRef.current = normalizedBase;

      if (isMountedRef.current) {
        setCustomModelsLoading(true);
        setCustomModelsError(null);
        setCustomModelOptions([]);
      }

      let apiKey: string | undefined;

      try {
        const keyFromState = openaiApiKey?.trim();
        apiKey =
          keyFromState && keyFromState.length > 0
            ? keyFromState
            : await window.electronAPI?.getOpenAIKey?.();

        if (!normalizedBase.includes("://")) {
          if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
            setCustomModelsError(
              "Enter a full base URL including protocol (e.g. https://server/v1)."
            );
            setCustomModelsLoading(false);
          }
          return;
        }

        if (!isSecureEndpoint(normalizedBase)) {
          if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
            setCustomModelsError("HTTPS required (HTTP allowed for local network only).");
            setCustomModelsLoading(false);
          }
          return;
        }

        const headers: Record<string, string> = {};
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
        }

        const modelsUrl = buildApiUrl(normalizedBase, "/models");
        const response = await fetch(modelsUrl, { method: "GET", headers });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const summary = errorText
            ? `${response.status} ${errorText.slice(0, 200)}`
            : `${response.status} ${response.statusText}`;
          throw new Error(summary.trim());
        }

        const payload = await response.json().catch(() => ({}));
        const rawModels = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.models)
            ? payload.models
            : [];

        const mappedModels = (rawModels as Array<Record<string, unknown>>)
          .map((item) => {
            const value = (item?.id || item?.name) as string | undefined;
            if (!value) return null;
            const ownedBy = typeof item?.owned_by === "string" ? item.owned_by : undefined;
            const icon = resolveOwnedByIcon(ownedBy);
            return {
              value,
              label: (item?.id || item?.name || value) as string,
              description:
                (item?.description as string) || (ownedBy ? `Owner: ${ownedBy}` : undefined),
              icon,
              ownedBy,
            } as CloudModelOption;
          })
          .filter(Boolean) as CloudModelOption[];

        if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
          setCustomModelOptions(mappedModels);
          if (
            reasoningModel &&
            mappedModels.length > 0 &&
            !mappedModels.some((model) => model.value === reasoningModel)
          ) {
            setReasoningModel("");
          }
          setCustomModelsError(null);
          lastLoadedBaseRef.current = normalizedBase;
        }
      } catch (error) {
        if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
          const message = (error as Error).message || "Unable to load models from endpoint.";
          const unauthorized = /\b(401|403)\b/.test(message);
          if (unauthorized && !apiKey) {
            setCustomModelsError(
              "Endpoint rejected the request (401/403). Add an API key or adjust server auth settings."
            );
          } else {
            setCustomModelsError(message);
          }
          setCustomModelOptions([]);
        }
      } finally {
        if (pendingBaseRef.current === normalizedBase) {
          pendingBaseRef.current = null;
        }
        if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
          setCustomModelsLoading(false);
        }
      }
    },
    [cloudReasoningBaseUrl, openaiApiKey, reasoningModel, setReasoningModel]
  );

  const trimmedCustomBase = customBaseInput.trim();
  const hasSavedCustomBase = Boolean((cloudReasoningBaseUrl || "").trim());
  const isCustomBaseDirty = trimmedCustomBase !== (cloudReasoningBaseUrl || "").trim();

  const displayedCustomModels = useMemo<CloudModelOption[]>(() => {
    if (isCustomBaseDirty) return [];
    return customModelOptions;
  }, [isCustomBaseDirty, customModelOptions]);

  const cloudProviderIds = ["openai", "anthropic", "gemini", "groq", "custom"];
  const cloudProviders = cloudProviderIds.map((id) => ({
    id,
    name:
      id === "custom"
        ? t("common.custom")
        : REASONING_PROVIDERS[id as keyof typeof REASONING_PROVIDERS]?.name || id,
  }));



  const openaiModelOptions = useMemo<CloudModelOption[]>(() => {
    const iconUrl = getProviderIcon("openai");
    return REASONING_PROVIDERS.openai.models.map((model) => ({
      ...model,
      icon: iconUrl,
    }));
  }, []);

  const selectedCloudModels = useMemo<CloudModelOption[]>(() => {
    if (selectedCloudProvider === "openai") return openaiModelOptions;
    if (selectedCloudProvider === "custom") return displayedCustomModels;

    const provider = REASONING_PROVIDERS[selectedCloudProvider as keyof typeof REASONING_PROVIDERS];
    if (!provider?.models) return [];

    const iconUrl = getProviderIcon(selectedCloudProvider);
    return provider.models.map((model) => ({
      ...model,
      icon: iconUrl,
    }));
  }, [selectedCloudProvider, openaiModelOptions, displayedCustomModels]);

  const handleApplyCustomBase = useCallback(() => {
    const trimmedBase = customBaseInput.trim();
    const normalized = trimmedBase ? normalizeBaseUrl(trimmedBase) : trimmedBase;
    setCustomBaseInput(normalized);
    setCloudReasoningBaseUrl(normalized);
    lastLoadedBaseRef.current = null;
    loadRemoteModels(normalized, true);
  }, [customBaseInput, setCloudReasoningBaseUrl, loadRemoteModels]);

  const handleBaseUrlBlur = useCallback(() => {
    const trimmedBase = customBaseInput.trim();
    if (!trimmedBase) return;

    // Auto-apply on blur if changed
    if (trimmedBase !== (cloudReasoningBaseUrl || "").trim()) {
      handleApplyCustomBase();
    }
  }, [customBaseInput, cloudReasoningBaseUrl, handleApplyCustomBase]);

  const handleResetCustomBase = useCallback(() => {
    const defaultBase = API_ENDPOINTS.OPENAI_BASE;
    setCustomBaseInput(defaultBase);
    setCloudReasoningBaseUrl(defaultBase);
    lastLoadedBaseRef.current = null;
    loadRemoteModels(defaultBase, true);
  }, [setCloudReasoningBaseUrl, loadRemoteModels]);

  const handleRefreshCustomModels = useCallback(() => {
    if (isCustomBaseDirty) {
      handleApplyCustomBase();
      return;
    }
    if (!trimmedCustomBase) return;
    loadRemoteModels(undefined, true);
  }, [handleApplyCustomBase, isCustomBaseDirty, trimmedCustomBase, loadRemoteModels]);

  useEffect(() => {
    if (cloudProviderIds.includes(localReasoningProvider)) {
      setSelectedCloudProvider(localReasoningProvider);
    }
  }, [localReasoningProvider]);

  useEffect(() => {
    if (selectedCloudProvider !== "custom") return;
    if (!hasCustomBase) {
      setCustomModelsError(null);
      setCustomModelOptions([]);
      setCustomModelsLoading(false);
      lastLoadedBaseRef.current = null;
      return;
    }

    const normalizedBase = normalizedCustomReasoningBase;
    if (!normalizedBase) return;
    if (pendingBaseRef.current === normalizedBase || lastLoadedBaseRef.current === normalizedBase)
      return;

    loadRemoteModels();
  }, [selectedCloudProvider, hasCustomBase, normalizedCustomReasoningBase, loadRemoteModels]);



  const handleCloudProviderChange = (provider: string) => {
    setSelectedCloudProvider(provider);
    setLocalReasoningProvider(provider);

    if (provider === "custom") {
      setCustomBaseInput(cloudReasoningBaseUrl);
      lastLoadedBaseRef.current = null;
      pendingBaseRef.current = null;

      if (customModelOptions.length > 0) {
        setReasoningModel(customModelOptions[0].value);
      } else if (hasCustomBase) {
        loadRemoteModels();
      }
      return;
    }

    const providerData = REASONING_PROVIDERS[provider as keyof typeof REASONING_PROVIDERS];
    if (providerData?.models?.length > 0) {
      setReasoningModel(providerData.models[0].value);
    }
  };



  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-neutral-50 border border-neutral-900 rounded-xl">
        <div>
          <label className="text-sm font-medium text-neutral-900">{t("reasoning.enable")}</label>
          <p className="text-xs text-neutral-700">
            {t("reasoning.enableDesc")}
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only"
            checked={useReasoningModel}
            onChange={(e) => setUseReasoningModel(e.target.checked)}
          />
          <div
            className={`w-11 h-6 bg-gray-200 rounded-full transition-colors duration-200 ${useReasoningModel ? "bg-neutral-900" : "bg-gray-300"
              }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform duration-200 ${useReasoningModel ? "translate-x-5" : "translate-x-0"
                }`}
            />
          </div>
        </label>
      </div>

      {useReasoningModel && (
        <>
          <div className="grid grid-cols-1 gap-3">
            <div
              className="p-4 border-2 rounded-xl text-left border-neutral-900 bg-neutral-50"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Cloud className="w-6 h-6 text-neutral-900" />
                  <h4 className="font-medium text-neutral-900">{t("reasoning.cloudAI")}</h4>
                </div>
                <span className="text-xs text-neutral-900 bg-neutral-100 px-2 py-1 rounded-full">
                  {t("reasoning.powerful")}
                </span>
              </div>
              <p className="text-sm text-neutral-600">
                {t("reasoning.cloudDesc")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <ProviderTabs
                providers={cloudProviders}
                selectedId={selectedCloudProvider}
                onSelect={handleCloudProviderChange}
                colorScheme="indigo"
              />

              <div className="p-4">
                {selectedCloudProvider === "custom" ? (
                  <>
                    {/* 1. Endpoint URL - TOP */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-gray-900">{t("reasoning.endpointUrl")}</h4>
                      <Input
                        value={customBaseInput}
                        onChange={(event) => setCustomBaseInput(event.target.value)}
                        onBlur={handleBaseUrlBlur}
                        placeholder="https://api.openai.com/v1"
                        className="text-sm"
                      />
                      <p className="text-xs text-gray-500">
                        {t("transcription.examples")}{" "}
                        <code className="text-neutral-700">http://localhost:11434/v1</code>{" "}
                        (Ollama),{" "}
                        <code className="text-neutral-700">http://localhost:8080/v1</code>{" "}
                        (LocalAI).
                      </p>
                    </div>

                    {/* 2. API Key - SECOND */}
                    <div className="space-y-3 pt-4">
                      <h4 className="font-medium text-gray-900">{t("transcription.apiKeyOptional")}</h4>
                      <ApiKeyInput
                        apiKey={openaiApiKey}
                        setApiKey={setOpenaiApiKey}
                        label=""
                        helpText={t("transcription.apiKeyHelp")}
                      />
                    </div>

                    {/* 3. Model Selection - THIRD */}
                    <div className="space-y-2 pt-4">
                      <label className="block text-sm font-medium text-gray-700">{t("transcription.modelName")}</label>
                      <div className="flex gap-2">
                        <Input
                          value={reasoningModel}
                          onChange={(e) => setReasoningModel(e.target.value)}
                          placeholder="deepseek-reasoner"
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

                    <div className="space-y-3 pt-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-700">{t("reasoning.availableModels")}</h4>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleResetCustomBase}
                            className="text-xs"
                          >
                            {t("common.reset")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleRefreshCustomModels}
                            disabled={
                              customModelsLoading || (!trimmedCustomBase && !hasSavedCustomBase)
                            }
                            className="text-xs"
                          >
                            {customModelsLoading
                              ? t("common.loading")
                              : isCustomBaseDirty
                                ? t("common.applyRefresh")
                                : t("common.refresh")}
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {t("reasoning.queryingModels", {
                          url: hasCustomBase ? effectiveReasoningBase : defaultOpenAIBase
                        })}
                      </p>
                      {isCustomBaseDirty && (
                        <p className="text-xs text-neutral-600">
                          {t("reasoning.reloadInfo")}
                        </p>
                      )}
                      {!hasCustomBase && (
                        <p className="text-xs text-amber-600">
                          {t("reasoning.enterUrlInfo")}
                        </p>
                      )}
                      {hasCustomBase && (
                        <>
                          {customModelsLoading && (
                            <p className="text-xs text-neutral-600">
                              {t("reasoning.fetchingModels")}
                            </p>
                          )}
                          {customModelsError && (
                            <p className="text-xs text-red-600">{customModelsError}</p>
                          )}
                          {!customModelsLoading &&
                            !customModelsError &&
                            customModelOptions.length === 0 && (
                              <p className="text-xs text-amber-600">
                                {t("reasoning.noModels")}
                              </p>
                            )}
                        </>
                      )}
                      <ModelCardList
                        models={selectedCloudModels}
                        selectedModel={reasoningModel}
                        onModelSelect={setReasoningModel}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {/* 1. API Key - TOP */}
                    {selectedCloudProvider === "openai" && (
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <h4 className="font-medium text-gray-900">{t("reasoning.apiKey")}</h4>
                          <a
                            href="https://platform.openai.com/api-keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={createExternalLinkHandler(
                              "https://platform.openai.com/api-keys"
                            )}
                            className="text-xs text-neutral-600 hover:text-neutral-800 underline cursor-pointer"
                          >
                            {t("reasoning.getKey")}
                          </a>
                        </div>
                        <ApiKeyInput
                          apiKey={openaiApiKey}
                          setApiKey={setOpenaiApiKey}
                          label=""
                          helpText=""
                        />
                      </div>
                    )}

                    {selectedCloudProvider === "anthropic" && (
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <h4 className="font-medium text-gray-900">{t("reasoning.apiKey")}</h4>
                          <a
                            href="https://console.anthropic.com/settings/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={createExternalLinkHandler(
                              "https://console.anthropic.com/settings/keys"
                            )}
                            className="text-xs text-neutral-600 hover:text-neutral-800 underline cursor-pointer"
                          >
                            {t("reasoning.getKey")}
                          </a>
                        </div>
                        <ApiKeyInput
                          apiKey={anthropicApiKey}
                          setApiKey={setAnthropicApiKey}
                          placeholder="sk-ant-..."
                          label=""
                          helpText=""
                        />
                      </div>
                    )}

                    {selectedCloudProvider === "gemini" && (
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <h4 className="font-medium text-gray-900">{t("reasoning.apiKey")}</h4>
                          <a
                            href="https://aistudio.google.com/app/api-keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={createExternalLinkHandler(
                              "https://aistudio.google.com/app/api-keys"
                            )}
                            className="text-xs text-neutral-600 hover:text-neutral-800 underline cursor-pointer"
                          >
                            {t("reasoning.getKey")}
                          </a>
                        </div>
                        <ApiKeyInput
                          apiKey={geminiApiKey}
                          setApiKey={setGeminiApiKey}
                          placeholder="AIza..."
                          label=""
                          helpText=""
                        />
                      </div>
                    )}

                    {selectedCloudProvider === "groq" && (
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <h4 className="font-medium text-gray-900">{t("reasoning.apiKey")}</h4>
                          <a
                            href="https://console.groq.com/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={createExternalLinkHandler("https://console.groq.com/keys")}
                            className="text-xs text-neutral-600 hover:text-neutral-800 underline cursor-pointer"
                          >
                            {t("reasoning.getKey")}
                          </a>
                        </div>
                        <ApiKeyInput
                          apiKey={groqApiKey}
                          setApiKey={setGroqApiKey}
                          placeholder="gsk_..."
                          label=""
                          helpText=""
                        />
                      </div>
                    )}

                    {/* 2. Model Selection - BOTTOM */}
                    <div className="pt-4 space-y-3">
                      <h4 className="text-sm font-medium text-gray-700">{t("reasoning.selectModel")}</h4>
                      <ModelCardList
                        models={selectedCloudModels}
                        selectedModel={reasoningModel}
                        onModelSelect={setReasoningModel}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
