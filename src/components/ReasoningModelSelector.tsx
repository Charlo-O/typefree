import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Clipboard, Loader2, RefreshCw, TextCursorInput } from "lucide-react";
import ApiKeyInput from "./ui/ApiKeyInput";
import ModelCardList from "./ui/ModelCardList";
import { useToast } from "./ui/Toast";

import { ProviderTabs } from "./ui/ProviderTabs";
import { API_ENDPOINTS, API_VERSIONS, buildApiUrl, normalizeBaseUrl } from "../config/constants";
import { REASONING_PROVIDERS } from "../models/ModelRegistry";

import { getProviderIcon } from "../utils/providerIcons";
import { isSecureEndpoint } from "../utils/urlUtils";
import { createExternalLinkHandler } from "../utils/externalLinks";
import { useI18n } from "../i18n";
import { readPromptContextSettings, writePromptContextSetting } from "../config/promptContext";

type CloudModelOption = {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  ownedBy?: string;
};

const OWNED_BY_ICON_RULES: Array<{ match: RegExp; provider: string }> = [
  { match: /(openai|system|default|gpt|davinci)/, provider: "openai" },
  { match: /(deepseek)/, provider: "deepseek" },
  { match: /(azure)/, provider: "openai" },
  { match: /(anthropic|claude)/, provider: "anthropic" },
  { match: /(google|gemini)/, provider: "gemini" },
  { match: /(meta|llama)/, provider: "llama" },
  { match: /(mistral)/, provider: "mistral" },
  { match: /(qwen|ali|tongyi)/, provider: "qwen" },
  { match: /(openrouter|oss)/, provider: "openai-oss" },
];

const CLOUD_PROVIDER_IDS = ["deepseek", "openai", "anthropic", "gemini", "groq", "custom"];

const resolveOwnedByIcon = (ownedBy?: string): string | undefined => {
  if (!ownedBy) return undefined;
  const normalized = ownedBy.toLowerCase();
  const rule = OWNED_BY_ICON_RULES.find(({ match }) => match.test(normalized));
  if (rule) {
    return getProviderIcon(rule.provider);
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const parseRemoteModelOptions = (payload: unknown, provider: string): CloudModelOption[] => {
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
        return { value: item, label: item, icon: getProviderIcon(provider) };
      }

      if (!isRecord(item)) return null;

      const rawId = item.id || item.name || item.model;
      if (typeof rawId !== "string" || !rawId.trim()) return null;

      const id = provider === "gemini" ? rawId.trim().replace(/^models\//, "") : rawId.trim();
      const ownedBy = typeof item.owned_by === "string" ? item.owned_by : undefined;
      const description = typeof item.description === "string" ? item.description : undefined;
      const icon = resolveOwnedByIcon(ownedBy) || getProviderIcon(provider);
      const displayName =
        typeof item.display_name === "string"
          ? item.display_name
          : typeof item.displayName === "string"
            ? item.displayName
            : undefined;

      return {
        value: id,
        label: displayName?.trim() || id,
        description: description || (ownedBy ? `Owner: ${ownedBy}` : undefined),
        icon,
        ownedBy,
      };
    })
    .filter((model): model is CloudModelOption => {
      if (!model || seen.has(model.value)) return false;
      seen.add(model.value);
      return true;
    });
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
  customReasoningApiKey: string;
  setCustomReasoningApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  deepseekApiKey: string;
  setDeepseekApiKey: (key: string) => void;
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
  customReasoningApiKey,
  setCustomReasoningApiKey,
  anthropicApiKey,
  setAnthropicApiKey,
  geminiApiKey,
  setGeminiApiKey,
  groqApiKey,
  setGroqApiKey,
  deepseekApiKey,
  setDeepseekApiKey,
  showAlertDialog,
}: ReasoningModelSelectorProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [selectedCloudProvider, setSelectedCloudProvider] = useState(
    localReasoningProvider && CLOUD_PROVIDER_IDS.includes(localReasoningProvider)
      ? localReasoningProvider
      : CLOUD_PROVIDER_IDS[0]
  );
  const [customModelOptions, setCustomModelOptions] = useState<CloudModelOption[]>([]);
  const [remoteModelOptions, setRemoteModelOptions] = useState<Record<string, CloudModelOption[]>>(
    {}
  );
  const [customModelsLoading, setCustomModelsLoading] = useState(false);
  const [customModelsError, setCustomModelsError] = useState<string | null>(null);
  const [modelFetchLoading, setModelFetchLoading] = useState(false);
  const [speedTestLoading, setSpeedTestLoading] = useState(false);
  const [customBaseInput, setCustomBaseInput] = useState(cloudReasoningBaseUrl);
  const lastLoadedBaseRef = useRef<string | null>(null);
  const pendingBaseRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  // Model currently selected in the UI for the active tab.
  // This does NOT necessarily equal the default model used for enhancement.
  const [draftModel, setDraftModel] = useState("");
  const [promptContextEnabled, setPromptContextEnabled] = useState(
    () => readPromptContextSettings().enabled
  );
  const [promptSelectedContextEnabled, setPromptSelectedContextEnabled] = useState(
    () => readPromptContextSettings().selectedEnabled
  );
  const [promptClipboardContextEnabled, setPromptClipboardContextEnabled] = useState(
    () => readPromptContextSettings().clipboardEnabled
  );

  const getModelStorageKey = useCallback((provider: string): string => {
    return provider === "custom" ? "customReasoningModel" : `reasoningModel_${provider}`;
  }, []);

  const updatePromptContextEnabled = useCallback((value: boolean) => {
    setPromptContextEnabled(value);
    writePromptContextSetting("enabled", value);
  }, []);

  const updatePromptSelectedContextEnabled = useCallback((value: boolean) => {
    setPromptSelectedContextEnabled(value);
    writePromptContextSetting("selectedEnabled", value);
  }, []);

  const updatePromptClipboardContextEnabled = useCallback((value: boolean) => {
    setPromptClipboardContextEnabled(value);
    writePromptContextSetting("clipboardEnabled", value);
  }, []);

  const readStoredModel = useCallback(
    (provider: string): string => {
      if (typeof window === "undefined" || !window.localStorage) return "";
      return window.localStorage.getItem(getModelStorageKey(provider)) || "";
    },
    [getModelStorageKey]
  );

  const writeStoredModel = useCallback(
    (provider: string, modelId: string) => {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(getModelStorageKey(provider), modelId);
    },
    [getModelStorageKey]
  );

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

  const canFetchProviderModels = CLOUD_PROVIDER_IDS.includes(selectedCloudProvider);

  const getProviderBaseUrl = useCallback(
    (provider: string): string => {
      if (provider === "deepseek") return API_ENDPOINTS.DEEPSEEK_BASE;
      if (provider === "groq") return API_ENDPOINTS.GROQ_BASE;
      if (provider === "anthropic") return "https://api.anthropic.com/v1";
      if (provider === "gemini") return API_ENDPOINTS.GEMINI;
      if (provider === "custom") return customBaseInput.trim() || cloudReasoningBaseUrl;
      return API_ENDPOINTS.OPENAI_BASE;
    },
    [cloudReasoningBaseUrl, customBaseInput]
  );

  const getProviderApiKey = useCallback(
    (provider: string): string => {
      if (provider === "deepseek") return deepseekApiKey;
      if (provider === "groq") return groqApiKey;
      if (provider === "anthropic") return anthropicApiKey;
      if (provider === "gemini") return geminiApiKey;
      if (provider === "custom") return customReasoningApiKey || openaiApiKey;
      return openaiApiKey;
    },
    [anthropicApiKey, customReasoningApiKey, deepseekApiKey, geminiApiKey, groqApiKey, openaiApiKey]
  );

  const readModelsFromProvider = useCallback(
    async (provider: string, signal?: AbortSignal): Promise<CloudModelOption[]> => {
      const rawBase = getProviderBaseUrl(provider);
      const normalizedBase = normalizeBaseUrl(rawBase);
      const apiKey = getProviderApiKey(provider).trim();

      if (!normalizedBase || !normalizedBase.includes("://")) {
        throw new Error("请先填写完整的请求地址。");
      }

      if (!isSecureEndpoint(normalizedBase)) {
        throw new Error("仅支持 HTTPS，局域网或本机 HTTP 除外。");
      }

      if (provider !== "custom" && !apiKey) {
        throw new Error("请先填写 API Key。");
      }

      const headers: Record<string, string> = { Accept: "application/json" };
      if (provider === "anthropic" && apiKey) {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = API_VERSIONS.ANTHROPIC;
      } else if (provider === "gemini" && apiKey) {
        headers["x-goog-api-key"] = apiKey;
      } else if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(buildApiUrl(normalizedBase, "/models"), {
        method: "GET",
        headers,
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `${response.status} ${response.statusText}${errorText ? `: ${errorText.slice(0, 160)}` : ""}`
        );
      }

      const payload = (await response.json().catch(() => ({}))) as unknown;
      return parseRemoteModelOptions(payload, provider);
    },
    [getProviderApiKey, getProviderBaseUrl]
  );

  const fetchModelsForCurrentProvider = useCallback(async () => {
    const provider = selectedCloudProvider;
    if (!canFetchProviderModels) {
      toast({
        title: "暂不支持获取模型",
        description: "这个供应商没有 OpenAI 兼容的 /models 接口。",
        variant: "default",
      });
      return;
    }

    setModelFetchLoading(true);
    if (provider === "custom") {
      setCustomModelsLoading(true);
      setCustomModelsError(null);
    }

    try {
      const models = await readModelsFromProvider(provider);
      if (!models.length) {
        throw new Error("没有读取到可用模型。");
      }

      if (provider === "custom") {
        const normalizedBase = normalizeBaseUrl(getProviderBaseUrl(provider));
        setCloudReasoningBaseUrl(normalizedBase);
        setCustomBaseInput(normalizedBase);
        latestReasoningBaseRef.current = normalizedBase;
        lastLoadedBaseRef.current = normalizedBase;
        setCustomModelOptions(models);
        setCustomModelsError(null);
      } else {
        setRemoteModelOptions((prev) => ({ ...prev, [provider]: models }));
      }

      const nextModel = models.some((model) => model.value === draftModel)
        ? draftModel
        : models[0].value;
      setDraftModel(nextModel);
      writeStoredModel(provider, nextModel);

      toast({
        title: "模型列表已更新",
        description: `获取到 ${models.length} 个模型，选中后点击启用。`,
        variant: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (provider === "custom") {
        setCustomModelsError(message);
        setCustomModelOptions([]);
      }
      toast({
        title: "获取模型失败",
        description: message,
        variant: "destructive",
      });
    } finally {
      setModelFetchLoading(false);
      if (provider === "custom") {
        setCustomModelsLoading(false);
      }
    }
  }, [
    canFetchProviderModels,
    draftModel,
    getProviderBaseUrl,
    readModelsFromProvider,
    selectedCloudProvider,
    setCloudReasoningBaseUrl,
    toast,
    writeStoredModel,
  ]);

  const testCurrentProviderConnection = useCallback(async () => {
    const provider = selectedCloudProvider;
    if (!canFetchProviderModels) {
      toast({
        title: "暂不支持测速",
        description: "这个供应商不使用 OpenAI 兼容的 /models 测速方式。",
        variant: "default",
      });
      return;
    }

    setSpeedTestLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    const startedAt = performance.now();

    try {
      const models = await readModelsFromProvider(provider, controller.signal);
      const elapsed = Math.round(performance.now() - startedAt);
      toast({
        title: "连接可用",
        description: `${REASONING_PROVIDERS[provider as keyof typeof REASONING_PROVIDERS]?.name || provider} 响应 ${elapsed}ms，模型 ${models.length} 个。`,
        variant: "success",
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      toast({
        title: "连接不可用",
        description: isTimeout
          ? "请求超时，请检查网络、Base URL 或 API Key。"
          : error instanceof Error
            ? error.message
            : String(error),
        variant: "destructive",
      });
    } finally {
      window.clearTimeout(timeoutId);
      setSpeedTestLoading(false);
    }
  }, [canFetchProviderModels, readModelsFromProvider, selectedCloudProvider, toast]);

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
        const keyFromState = customReasoningApiKey?.trim();
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
          if (!draftModel && mappedModels.length > 0) {
            const firstModel = mappedModels[0].value;
            setDraftModel(firstModel);
            writeStoredModel("custom", firstModel);
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
    [cloudReasoningBaseUrl, customReasoningApiKey, draftModel, writeStoredModel]
  );

  const trimmedCustomBase = customBaseInput.trim();
  const isCustomBaseDirty = trimmedCustomBase !== (cloudReasoningBaseUrl || "").trim();

  const displayedCustomModels = useMemo<CloudModelOption[]>(() => {
    if (isCustomBaseDirty) return [];
    return customModelOptions;
  }, [isCustomBaseDirty, customModelOptions]);

  const cloudProviders = CLOUD_PROVIDER_IDS.map((id) => ({
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
    const fetchedModels = remoteModelOptions[selectedCloudProvider] || [];
    if (selectedCloudProvider !== "custom" && fetchedModels.length > 0) {
      return fetchedModels;
    }

    if (selectedCloudProvider === "openai") return openaiModelOptions;
    if (selectedCloudProvider === "custom") return displayedCustomModels;

    const provider = REASONING_PROVIDERS[selectedCloudProvider as keyof typeof REASONING_PROVIDERS];
    if (!provider?.models) return [];

    const iconUrl = getProviderIcon(selectedCloudProvider);
    return provider.models.map((model) => ({
      ...model,
      icon: iconUrl,
    }));
  }, [selectedCloudProvider, remoteModelOptions, openaiModelOptions, displayedCustomModels]);

  const resolveModelForProvider = useCallback(
    (provider: string): string => {
      const stored = readStoredModel(provider);

      if (provider === "custom") {
        if (stored) return stored;
        if (customModelOptions.length > 0) return customModelOptions[0].value;
        return "";
      }

      const providerData = REASONING_PROVIDERS[provider as keyof typeof REASONING_PROVIDERS];
      const models = providerData?.models || [];

      if (stored && models.some((m) => m.value === stored)) {
        return stored;
      }

      return models[0]?.value || "";
    },
    [customModelOptions, readStoredModel]
  );

  const applyProviderModel = useCallback(
    (provider: string) => {
      const next = resolveModelForProvider(provider);
      setDraftModel(next);
      // Persist even defaults so reopening is stable.
      if (next) {
        writeStoredModel(provider, next);
      }
    },
    [resolveModelForProvider, writeStoredModel]
  );

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

  useEffect(() => {
    if (CLOUD_PROVIDER_IDS.includes(localReasoningProvider)) {
      setSelectedCloudProvider(localReasoningProvider);
    }
  }, [localReasoningProvider]);

  useEffect(() => {
    applyProviderModel(selectedCloudProvider);
  }, [selectedCloudProvider, applyProviderModel]);

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

    if (provider === "custom") {
      setCustomBaseInput(cloudReasoningBaseUrl);
      lastLoadedBaseRef.current = null;
      pendingBaseRef.current = null;

      applyProviderModel("custom");

      if (customModelOptions.length === 0 && hasCustomBase) {
        loadRemoteModels();
      }
      return;
    }

    applyProviderModel(provider);
  };

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setDraftModel(modelId);
      writeStoredModel(selectedCloudProvider, modelId);
    },
    [selectedCloudProvider, writeStoredModel]
  );

  const isCurrentDefault =
    selectedCloudProvider === localReasoningProvider &&
    !!draftModel &&
    draftModel === reasoningModel;

  const commitDefaultModel = useCallback(
    (modelOverride?: string) => {
      const modelId = (modelOverride || draftModel || "").trim();
      if (!modelId) {
        showAlertDialog({
          title: t("common.error"),
          description: t("reasoning.noModelSelected"),
        });
        return;
      }

      setLocalReasoningProvider(selectedCloudProvider);
      setReasoningModel(modelId);

      toast({
        title: t("common.success"),
        description: t("reasoning.defaultModelSet") || `已启用 ${modelId}`,
        variant: "success",
      });
    },
    [
      draftModel,
      selectedCloudProvider,
      setLocalReasoningProvider,
      setReasoningModel,
      showAlertDialog,
      t,
      toast,
    ]
  );

  const handleSetDefaultModel = useCallback(() => {
    commitDefaultModel();
  }, [commitDefaultModel]);

  const handleActivateModel = useCallback(
    (modelId: string) => {
      setDraftModel(modelId);
      writeStoredModel(selectedCloudProvider, modelId);
      commitDefaultModel(modelId);
    },
    [commitDefaultModel, selectedCloudProvider, writeStoredModel]
  );

  const speedTestAction = canFetchProviderModels ? (
    <button
      type="button"
      onClick={testCurrentProviderConnection}
      disabled={speedTestLoading || modelFetchLoading}
      className="text-xs font-medium text-neutral-500 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline disabled:pointer-events-none disabled:opacity-45"
    >
      {speedTestLoading ? "测速中..." : "测速"}
    </button>
  ) : null;

  const fetchModelsButton = canFetchProviderModels ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={fetchModelsForCurrentProvider}
      disabled={
        modelFetchLoading ||
        speedTestLoading ||
        (selectedCloudProvider === "custom" && !customBaseInput.trim())
      }
      className="h-7 rounded-md border-neutral-200 px-2 text-[11px] shadow-none hover:border-neutral-300 hover:bg-neutral-50 [&_svg]:size-3"
    >
      {modelFetchLoading ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
      )}
      获取模型列表
    </Button>
  ) : null;

  const renderApiKeySection = ({
    apiKey,
    setApiKey,
    apiKeyUrl,
    placeholder,
  }: {
    apiKey: string;
    setApiKey: (key: string) => void;
    apiKeyUrl: string;
    placeholder?: string;
  }) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-base font-semibold text-gray-900">{t("reasoning.apiKey")}</h4>
          <a
            href={apiKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={createExternalLinkHandler(apiKeyUrl)}
            className="block text-xs text-neutral-500 underline underline-offset-4 transition-colors hover:text-neutral-900"
          >
            {t("reasoning.getKey")}
          </a>
        </div>
        {speedTestAction}
      </div>
      <ApiKeyInput
        apiKey={apiKey}
        setApiKey={setApiKey}
        placeholder={placeholder}
        label=""
        helpText=""
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div
        className={`flex items-center justify-between p-5 border rounded-xl transition-all duration-300 ${
          useReasoningModel
            ? "bg-white border-neutral-200 shadow-sm"
            : "bg-white border-neutral-200 shadow-sm hover:border-neutral-300"
        }`}
      >
        <div>
          <label className="text-sm font-medium text-neutral-900">{t("reasoning.enable")}</label>
          <p className="text-xs text-neutral-500 mt-1">{t("reasoning.enableDesc")}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only"
            checked={useReasoningModel}
            onChange={(e) => setUseReasoningModel(e.target.checked)}
          />
          <div
            className={`w-11 h-6 rounded-full transition-colors duration-300 shadow-inner ${
              useReasoningModel ? "bg-neutral-950" : "bg-neutral-300"
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 bg-white border border-neutral-200 rounded-full h-5 w-5 transition-transform duration-300 shadow-sm ${
                useReasoningModel ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </div>
        </label>
      </div>

      {useReasoningModel && (
        <>
          <div className="p-5 border border-neutral-200 rounded-xl bg-white shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-medium text-neutral-900">{t("reasoning.promptContext")}</h4>
                <p className="text-sm text-neutral-500 mt-1">{t("reasoning.promptContextDesc")}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={promptContextEnabled}
                  onChange={(e) => updatePromptContextEnabled(e.target.checked)}
                />
                <div
                  className={`w-11 h-6 rounded-full transition-colors duration-300 shadow-inner ${
                    promptContextEnabled ? "bg-neutral-950" : "bg-neutral-300"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 bg-white border border-neutral-200 rounded-full h-5 w-5 transition-transform duration-300 shadow-sm ${
                      promptContextEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </div>
              </label>
            </div>

            {promptContextEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
                <label
                  className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-all duration-300 ${
                    promptSelectedContextEnabled
                      ? "bg-neutral-50 border-neutral-300 ring-1 ring-neutral-900/10 shadow-sm"
                      : "bg-white border-neutral-200 hover:border-neutral-300 hover:shadow-sm"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 text-neutral-950 focus:ring-neutral-500 rounded border-neutral-300"
                    checked={promptSelectedContextEnabled}
                    onChange={(e) => updatePromptSelectedContextEnabled(e.target.checked)}
                  />
                  <TextCursorInput
                    className={`w-4 h-4 mt-0.5 shrink-0 ${promptSelectedContextEnabled ? "text-neutral-950" : "text-neutral-500"}`}
                  />
                  <span>
                    <span
                      className={`block text-sm font-medium ${promptSelectedContextEnabled ? "text-neutral-950" : "text-neutral-700"}`}
                    >
                      {t("reasoning.promptContextSelected")}
                    </span>
                    <span
                      className={`block text-xs mt-1 ${promptSelectedContextEnabled ? "text-neutral-700" : "text-neutral-500"}`}
                    >
                      {t("reasoning.promptContextSelectedDesc")}
                    </span>
                  </span>
                </label>

                <label
                  className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-all duration-300 ${
                    promptClipboardContextEnabled
                      ? "bg-neutral-50 border-neutral-300 ring-1 ring-neutral-900/10 shadow-sm"
                      : "bg-white border-neutral-200 hover:border-neutral-300 hover:shadow-sm"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 text-neutral-950 focus:ring-neutral-500 rounded border-neutral-300"
                    checked={promptClipboardContextEnabled}
                    onChange={(e) => updatePromptClipboardContextEnabled(e.target.checked)}
                  />
                  <Clipboard
                    className={`w-4 h-4 mt-0.5 shrink-0 ${promptClipboardContextEnabled ? "text-neutral-950" : "text-neutral-500"}`}
                  />
                  <span>
                    <span
                      className={`block text-sm font-medium ${promptClipboardContextEnabled ? "text-neutral-950" : "text-neutral-700"}`}
                    >
                      {t("reasoning.promptContextClipboard")}
                    </span>
                    <span
                      className={`block text-xs mt-1 ${promptClipboardContextEnabled ? "text-neutral-700" : "text-neutral-500"}`}
                    >
                      {t("reasoning.promptContextClipboardDesc")}
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <ProviderTabs
              providers={cloudProviders}
              selectedId={selectedCloudProvider}
              onSelect={handleCloudProviderChange}
              colorScheme="indigo"
              labelMode="hover"
            />

            <div className="p-5 bg-white border border-neutral-200 shadow-sm rounded-xl">
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
                      <code className="text-neutral-700">http://localhost:11434/v1</code> (Ollama),{" "}
                      <code className="text-neutral-700">http://localhost:8080/v1</code> (LocalAI).
                    </p>
                  </div>

                  {/* 2. API Key - SECOND */}
                  <div className="space-y-3 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-base font-semibold text-gray-900">
                        {t("transcription.apiKeyOptional")}
                      </h4>
                      {speedTestAction}
                    </div>
                    <ApiKeyInput
                      apiKey={customReasoningApiKey}
                      setApiKey={setCustomReasoningApiKey}
                      label=""
                      helpText={t("transcription.apiKeyHelp")}
                    />
                  </div>

                  <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 mt-4">
                    <label className="block text-sm font-medium text-gray-700">
                      {t("transcription.modelName")}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={draftModel}
                        onChange={(e) => handleModelSelect(e.target.value)}
                        placeholder="deepseek-reasoner"
                        className="flex-1 bg-white text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleSetDefaultModel}
                        disabled={isCurrentDefault || !(draftModel || "").trim()}
                        className="h-9 shrink-0 px-3 text-xs shadow-none"
                      >
                        {isCurrentDefault ? t("reasoning.defaultModel") : "启用"}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">{t("transcription.modelNameDesc")}</p>
                  </div>

                  <div className="space-y-3 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h4 className="text-sm font-medium text-gray-700">
                          {t("reasoning.availableModels")}
                        </h4>
                        <p className="text-xs text-gray-500">
                          {t("reasoning.queryingModels", {
                            url: hasCustomBase ? effectiveReasoningBase : defaultOpenAIBase,
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleResetCustomBase}
                          className="h-8 px-2.5 text-xs"
                        >
                          {t("common.reset")}
                        </Button>
                        {fetchModelsButton}
                      </div>
                    </div>
                    {isCustomBaseDirty && (
                      <p className="text-xs text-neutral-600">{t("reasoning.reloadInfo")}</p>
                    )}
                    {!hasCustomBase && (
                      <p className="text-xs text-amber-600">{t("reasoning.enterUrlInfo")}</p>
                    )}
                    {customModelsLoading && (
                      <p className="text-xs text-neutral-600">{t("reasoning.fetchingModels")}</p>
                    )}
                    {customModelsError && (
                      <p className="text-xs text-red-600">{customModelsError}</p>
                    )}
                    {!customModelsLoading &&
                      !customModelsError &&
                      customModelOptions.length === 0 && (
                        <p className="text-xs text-amber-600">{t("reasoning.noModels")}</p>
                      )}
                    <ModelCardList
                      models={selectedCloudModels}
                      selectedModel={draftModel}
                      onModelSelect={handleModelSelect}
                      activeModel={
                        selectedCloudProvider === localReasoningProvider ? reasoningModel : ""
                      }
                      activationMode="confirm"
                      onModelActivate={handleActivateModel}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* 1. API Key - TOP */}
                  {selectedCloudProvider === "openai" &&
                    renderApiKeySection({
                      apiKey: openaiApiKey,
                      setApiKey: setOpenaiApiKey,
                      apiKeyUrl: "https://platform.openai.com/api-keys",
                    })}

                  {selectedCloudProvider === "deepseek" &&
                    renderApiKeySection({
                      apiKey: deepseekApiKey,
                      setApiKey: setDeepseekApiKey,
                      apiKeyUrl: "https://platform.deepseek.com/api_keys",
                      placeholder: "sk-...",
                    })}

                  {selectedCloudProvider === "anthropic" &&
                    renderApiKeySection({
                      apiKey: anthropicApiKey,
                      setApiKey: setAnthropicApiKey,
                      apiKeyUrl: "https://console.anthropic.com/settings/keys",
                      placeholder: "sk-ant-...",
                    })}

                  {selectedCloudProvider === "gemini" &&
                    renderApiKeySection({
                      apiKey: geminiApiKey,
                      setApiKey: setGeminiApiKey,
                      apiKeyUrl: "https://aistudio.google.com/app/api-keys",
                      placeholder: "AIza...",
                    })}

                  {selectedCloudProvider === "groq" &&
                    renderApiKeySection({
                      apiKey: groqApiKey,
                      setApiKey: setGroqApiKey,
                      apiKeyUrl: "https://console.groq.com/keys",
                      placeholder: "gsk_...",
                    })}

                  {/* 2. Model Selection - BOTTOM */}
                  <div className="pt-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-medium text-gray-700">
                        {t("reasoning.selectModel")}
                      </h4>
                      {fetchModelsButton}
                    </div>
                    <ModelCardList
                      models={selectedCloudModels}
                      selectedModel={draftModel}
                      onModelSelect={handleModelSelect}
                      activeModel={
                        selectedCloudProvider === localReasoningProvider ? reasoningModel : ""
                      }
                      activationMode="confirm"
                      onModelActivate={handleActivateModel}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
