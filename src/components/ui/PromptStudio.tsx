import React, { useState, useEffect } from "react";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import {
  Eye,
  Edit3,
  Play,
  Save,
  RotateCcw,
  Copy,
  Sparkles,
  TestTube,
  AlertTriangle,
  Info,
} from "lucide-react";
import { AlertDialog } from "./dialog";
import { useDialogs } from "../../hooks/useDialogs";
import { useAgentName } from "../../utils/agentName";
import ReasoningService from "../../services/ReasoningService";
import { getModelProvider } from "../../models/ModelRegistry";
import { UNIFIED_SYSTEM_PROMPT, LEGACY_PROMPTS } from "../../config/prompts";
import { useI18n } from "../../i18n";

interface PromptStudioProps {
  className?: string;
}

type ProviderConfig = {
  label: string;
  apiKeyStorageKey?: string;
  baseStorageKey?: string;
};

const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  openai: { label: "OpenAI", apiKeyStorageKey: "openaiApiKey" },
  anthropic: { label: "Anthropic", apiKeyStorageKey: "anthropicApiKey" },
  gemini: { label: "Gemini", apiKeyStorageKey: "geminiApiKey" },
  custom: {
    label: "Custom endpoint",
    apiKeyStorageKey: "openaiApiKey",
    baseStorageKey: "cloudReasoningBaseUrl",
  },
  local: { label: "Local" },
};

/**
 * Get the current prompt being used - either custom or default unified prompt
 */
function getCurrentPrompt(): string {
  const customPrompt = localStorage.getItem("customUnifiedPrompt");
  if (customPrompt) {
    try {
      return JSON.parse(customPrompt);
    } catch {
      return UNIFIED_SYSTEM_PROMPT;
    }
  }
  return UNIFIED_SYSTEM_PROMPT;
}

export default function PromptStudio({ className = "" }: PromptStudioProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"current" | "edit" | "test">("current");
  const [editedPrompt, setEditedPrompt] = useState(UNIFIED_SYSTEM_PROMPT);
  const [testText, setTestText] = useState(
    "um so like I was thinking we should probably you know schedule a meeting for next week to discuss the the project timeline"
  );
  const [testResult, setTestResult] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { alertDialog, showAlertDialog, hideAlertDialog } = useDialogs();
  const { agentName } = useAgentName();

  // Load saved custom prompt from localStorage
  useEffect(() => {
    // Migrate legacy two-prompt system (customPrompts → customUnifiedPrompt)
    const legacyPrompts = localStorage.getItem("customPrompts");
    if (legacyPrompts && !localStorage.getItem("customUnifiedPrompt")) {
      try {
        const parsed = JSON.parse(legacyPrompts);
        // Use agent prompt as base (it's more comprehensive than regular prompt)
        if (parsed.agent) {
          localStorage.setItem("customUnifiedPrompt", JSON.stringify(parsed.agent));
          localStorage.removeItem("customPrompts");
          console.log("Migrated legacy custom prompts to unified format");
        }
      } catch (e) {
        console.error("Failed to migrate legacy custom prompts:", e);
      }
    }

    // Load current custom prompt
    const customPrompt = localStorage.getItem("customUnifiedPrompt");
    if (customPrompt) {
      try {
        setEditedPrompt(JSON.parse(customPrompt));
      } catch (error) {
        console.error("Failed to load custom prompt:", error);
      }
    }
  }, []);

  const savePrompt = () => {
    localStorage.setItem("customUnifiedPrompt", JSON.stringify(editedPrompt));
    showAlertDialog({
      title: t("promptStudio.alert.savedTitle"),
      description: t("promptStudio.alert.savedDesc"),
    });
  };

  const resetToDefault = () => {
    setEditedPrompt(UNIFIED_SYSTEM_PROMPT);
    localStorage.removeItem("customUnifiedPrompt");
    showAlertDialog({
      title: t("promptStudio.alert.resetTitle"),
      description: t("promptStudio.alert.resetDesc"),
    });
  };

  const testPrompt = async () => {
    if (!testText.trim()) return;

    setIsLoading(true);
    setTestResult("");

    try {
      const useReasoningModel = localStorage.getItem("useReasoningModel") === "true";
      const reasoningModel = localStorage.getItem("reasoningModel") || "";
      const reasoningProvider = reasoningModel ? getModelProvider(reasoningModel) : "openai";

      if (!useReasoningModel) {
        setTestResult(t("promptStudio.aiDisabledDesc"));
        return;
      }

      if (!reasoningModel) {
        setTestResult(t("reasoning.noModelSelected"));
        return;
      }

      const providerConfig = PROVIDER_CONFIG[reasoningProvider] || {
        label: reasoningProvider.charAt(0).toUpperCase() + reasoningProvider.slice(1),
      };
      const providerLabel = providerConfig.label;

      if (providerConfig.baseStorageKey) {
        const baseUrl = (localStorage.getItem(providerConfig.baseStorageKey) || "").trim();
        if (!baseUrl) {
          setTestResult(t("reasoning.baseUrlMissing", { provider: providerLabel }));
          return;
        }
      }

      // Save the current edited prompt temporarily for the test
      const currentCustomPrompt = localStorage.getItem("customUnifiedPrompt");
      localStorage.setItem("customUnifiedPrompt", JSON.stringify(editedPrompt));

      try {
        if (reasoningProvider === "local") {
          const result = await window.electronAPI.processLocalReasoning(
            testText,
            reasoningModel,
            agentName,
            {}
          );

          if (result.success) {
            setTestResult(result.text || "");
          } else {
            setTestResult(`Local model error: ${result.error}`);
          }
        } else {
          const result = await ReasoningService.processText(
            testText,
            reasoningModel,
            agentName,
            {}
          );
          setTestResult(result);
        }
      } finally {
        // Restore original prompt
        if (currentCustomPrompt) {
          localStorage.setItem("customUnifiedPrompt", currentCustomPrompt);
        } else {
          localStorage.removeItem("customUnifiedPrompt");
        }
      }
    } catch (error) {
      console.error("Test failed:", error);
      setTestResult(`${t("promptStudio.alert.testFailed")}: ${(error as Error).message || String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    showAlertDialog({
      title: t("promptStudio.alert.copied"),
      description: t("promptStudio.alert.copiedDesc"),
    });
  };

  // Check if the test text contains the agent name
  const isAgentAddressed = testText.toLowerCase().includes(agentName.toLowerCase());

  const renderCurrentPrompt = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5 text-blue-600" />
          {t("promptStudio.currentPromptTitle")}
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          {t("promptStudio.currentPromptDesc")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-purple-600" />
            {t("promptStudio.unifiedPrompt")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">{t("promptStudio.howItWorks")}</p>
                <ul className="list-disc list-inside space-y-1 text-blue-700">
                  <li>
                    <strong>{t("promptStudio.cleanupModeDesc")}</strong>
                  </li>
                  <li>
                    <strong>{t("promptStudio.agentModeDesc")}</strong>
                  </li>
                  <li>{t("promptStudio.intelligentDetection")}</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 border rounded-lg p-4 font-mono text-sm max-h-96 overflow-y-auto">
            <pre className="whitespace-pre-wrap">
              {getCurrentPrompt().replace(/\{\{agentName\}\}/g, agentName)}
            </pre>
          </div>
          <Button
            onClick={() => copyPrompt(getCurrentPrompt())}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            <Copy className="w-4 h-4 mr-2" />
            {t("promptStudio.copyPrompt")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const renderEditPrompt = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Edit3 className="w-5 h-5 text-indigo-600" />
          {t("promptStudio.customizeTitle")}
        </h3>
        <p className="text-sm text-gray-600 mb-2">
          {t("promptStudio.customizeDesc")}
        </p>
        <p className="text-sm text-amber-600 mb-6">
          <strong>{t("promptStudio.cautionDesc")}</strong>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("promptStudio.systemPrompt")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            rows={20}
            className="font-mono text-sm"
            placeholder={t("promptStudio.placeholder")}
          />
          <p className="text-xs text-gray-500 mt-2">
            {t("promptStudio.agentNameIs")} <strong>{agentName}</strong>
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={savePrompt} className="flex-1">
          <Save className="w-4 h-4 mr-2" />
          {t("promptStudio.saveCustom")}
        </Button>
        <Button onClick={resetToDefault} variant="outline">
          <RotateCcw className="w-4 h-4 mr-2" />
          {t("promptStudio.resetDefault")}
        </Button>
      </div>
    </div>
  );

  const renderTestPlayground = () => {
    const useReasoningModel = localStorage.getItem("useReasoningModel") === "true";
    const reasoningModel = localStorage.getItem("reasoningModel") || "";
    const reasoningProvider = reasoningModel ? getModelProvider(reasoningModel) : "openai";
    const providerConfig = PROVIDER_CONFIG[reasoningProvider] || {
      label: reasoningProvider.charAt(0).toUpperCase() + reasoningProvider.slice(1),
    };
    const providerLabel = providerConfig.label;
    const providerEndpoint = providerConfig.baseStorageKey
      ? (localStorage.getItem(providerConfig.baseStorageKey) || "").trim()
      : "";

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TestTube className="w-5 h-5 text-green-600" />
            {t("promptStudio.testTitle")}
          </h3>
          <p className="text-sm text-gray-600 mb-6">
            {t("promptStudio.testDesc")}
          </p>
        </div>

        {!useReasoningModel && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-800 font-medium">{t("promptStudio.aiDisabled")}</p>
                <p className="text-sm text-amber-700 mt-1">
                  {t("promptStudio.aiDisabledDesc")}
                </p>
              </div>
            </div>
          </div>
        )}

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">{t("promptStudio.currentModel")}:</span>
                <span className="ml-2 font-medium">{reasoningModel || "None selected"}</span>
              </div>
              <div>
                <span className="text-gray-600">{t("promptStudio.provider")}:</span>
                <span className="ml-2 font-medium capitalize">{providerLabel}</span>
                {providerConfig.baseStorageKey && (
                  <div className="text-xs text-gray-500 mt-1 break-all">
                    {t("promptStudio.endpoint")}: {providerEndpoint || "Not configured"}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">{t("promptStudio.testInput")}</label>
              <Textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                rows={4}
                placeholder={t("promptStudio.testPlaceholder")}
              />
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-gray-500 space-y-1">
                  <p>{t("promptStudio.tryCleanup")}</p>
                  <p>
                    {t("promptStudio.tryInstruction", { agentName })}
                  </p>
                </div>
                {testText && (
                  <span
                    className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ml-4 ${isAgentAddressed
                      ? "bg-purple-100 text-purple-700"
                      : "bg-green-100 text-green-700"
                      }`}
                  >
                    {isAgentAddressed ? t("promptStudio.activeInstruction") : t("promptStudio.activeCleanup")}
                  </span>
                )}
              </div>
            </div>

            <Button
              onClick={testPrompt}
              disabled={!testText.trim() || isLoading || !useReasoningModel}
              className="w-full"
            >
              <Play className="w-4 h-4 mr-2" />
              {isLoading ? t("common.processing") : t("promptStudio.runTest")}
            </Button>

            {testResult && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">{t("promptStudio.aiOutput")}</label>
                  <Button onClick={() => copyPrompt(testResult)} variant="ghost" size="sm">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <div className="border rounded-lg p-4 text-sm max-h-60 overflow-y-auto bg-gray-50 border-gray-200">
                  <pre className="whitespace-pre-wrap">{testResult}</pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className={className}>
      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => { }}
      />

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 mb-6">
        {[
          { id: "current", label: t("promptStudio.current"), icon: Eye },
          { id: "edit", label: t("promptStudio.customize"), icon: Edit3 },
          { id: "test", label: t("promptStudio.test"), icon: TestTube },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${activeTab === tab.id
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "current" && renderCurrentPrompt()}
      {activeTab === "edit" && renderEditPrompt()}
      {activeTab === "test" && renderTestPlayground()}
    </div>
  );
}
