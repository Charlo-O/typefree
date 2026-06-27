import React, { useState, useEffect, useMemo } from "react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
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
  History,
  Trash2,
} from "lucide-react";
import { AlertDialog } from "../../../components/ui/dialog";
import { useDialogs } from "../../../hooks/useDialogs";
import { useAgentName } from "../../../utils/agentName";
import ReasoningService from "../../../services/ReasoningService";
import { getModelProvider } from "../../../models/ModelRegistry";
import { UNIFIED_SYSTEM_PROMPT, getCurrentUnifiedPromptTemplate } from "../../../config/prompts";
import {
  CUSTOM_UNIFIED_PROMPT_STORAGE_KEY,
  LEGACY_CUSTOM_PROMPTS_STORAGE_KEY,
} from "../../../config/promptStorage";
import { scorePromptTemplate, type PromptQualityReport } from "../../../config/promptQuality";
import type { PromptRuntimeContext } from "../../../config/promptContext";
import { useI18n } from "../../../i18n";
import {
  clearCurrentPrompt,
  readActivePromptVersionId,
  readCurrentPromptRaw,
  readPromptVersions,
  restoreCurrentPromptRaw,
  savePromptVersion,
  writeCurrentPrompt,
  type PromptVersion,
} from "../promptVersions";
import {
  deletePromptTestSample,
  readPromptTestSamples,
  savePromptTestSample,
  type PromptTestSample,
} from "../promptTestSamples";
import {
  deletePromptTestRun,
  readPromptTestRuns,
  savePromptTestRun,
  type PromptTestRun,
} from "../promptTestRuns";
import { readAppSetting } from "../../settings/schema/settingsSchema";
import { platform } from "../../../shared/platform";

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
  return getCurrentUnifiedPromptTemplate();
}

function readProviderEndpoint(providerConfig: ProviderConfig): string {
  if (!providerConfig.baseStorageKey) return "";

  if (providerConfig.baseStorageKey === "cloudReasoningBaseUrl") {
    return readAppSetting("cloudReasoningBaseUrl").trim();
  }

  return (localStorage.getItem(providerConfig.baseStorageKey) || "").trim();
}

export default function PromptStudio({ className = "" }: PromptStudioProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"current" | "edit" | "test">("current");
  const [currentPromptTemplate, setCurrentPromptTemplate] = useState(getCurrentPrompt);
  const [editedPrompt, setEditedPrompt] = useState(UNIFIED_SYSTEM_PROMPT);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [activePromptVersionId, setActivePromptVersionIdState] = useState<string | null>(null);
  const [testSamples, setTestSamples] = useState<PromptTestSample[]>([]);
  const [testRuns, setTestRuns] = useState<PromptTestRun[]>([]);
  const [compareLeftVersionId, setCompareLeftVersionId] = useState("");
  const [compareRightVersionId, setCompareRightVersionId] = useState("");
  const [compareRuns, setCompareRuns] = useState<PromptTestRun[]>([]);
  const [testText, setTestText] = useState(
    "um so like I was thinking we should probably you know schedule a meeting for next week to discuss the the project timeline"
  );
  const [testResult, setTestResult] = useState("");
  const [testSelectedContext, setTestSelectedContext] = useState("");
  const [testClipboardContext, setTestClipboardContext] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isComparing, setIsComparing] = useState(false);

  const { alertDialog, showAlertDialog, hideAlertDialog } = useDialogs();
  const { agentName } = useAgentName();
  const currentPromptScore = useMemo(
    () => scorePromptTemplate(currentPromptTemplate),
    [currentPromptTemplate]
  );
  const editedPromptScore = useMemo(() => scorePromptTemplate(editedPrompt), [editedPrompt]);

  // Load saved custom prompt from localStorage
  useEffect(() => {
    // Migrate legacy two-prompt system (customPrompts -> customUnifiedPrompt)
    const legacyPrompts = localStorage.getItem(LEGACY_CUSTOM_PROMPTS_STORAGE_KEY);
    if (legacyPrompts && !localStorage.getItem(CUSTOM_UNIFIED_PROMPT_STORAGE_KEY)) {
      try {
        const parsed = JSON.parse(legacyPrompts);
        // Use agent prompt as base (it's more comprehensive than regular prompt)
        if (typeof parsed.agent === "string" && parsed.agent.trim()) {
          writeCurrentPrompt(parsed.agent);
          localStorage.removeItem(LEGACY_CUSTOM_PROMPTS_STORAGE_KEY);
          const { version, versions } = savePromptVersion(parsed.agent, {
            source: "migration",
            score: scorePromptTemplate(parsed.agent).score,
          });
          setPromptVersions(versions);
          setActivePromptVersionIdState(version.id);
          console.log("Migrated legacy custom prompts to unified format");
        }
      } catch (e) {
        console.error("Failed to migrate legacy custom prompts:", e);
      }
    }

    // Load current custom prompt
    const currentPrompt = getCurrentUnifiedPromptTemplate();
    const versions = readPromptVersions();
    const activeVersionId = readActivePromptVersionId();
    const fallbackRightVersion = versions.find((version) => version.id !== activeVersionId);
    setCurrentPromptTemplate(currentPrompt);
    setEditedPrompt(currentPrompt);
    setPromptVersions(versions);
    setActivePromptVersionIdState(activeVersionId);
    setCompareLeftVersionId(activeVersionId ?? versions[0]?.id ?? "");
    setCompareRightVersionId(fallbackRightVersion?.id ?? versions[1]?.id ?? "");
    setTestSamples(readPromptTestSamples());
    setTestRuns(readPromptTestRuns());
  }, []);

  const savePrompt = () => {
    writeCurrentPrompt(editedPrompt);
    const { version, versions } = savePromptVersion(editedPrompt, {
      score: editedPromptScore.score,
    });
    setCurrentPromptTemplate(editedPrompt);
    setPromptVersions(versions);
    setActivePromptVersionIdState(version.id);
    setCompareLeftVersionId(version.id);
    setCompareRightVersionId(versions.find((candidate) => candidate.id !== version.id)?.id ?? "");
    showAlertDialog({
      title: t("promptStudio.alert.savedTitle"),
      description: t("promptStudio.alert.savedDesc"),
    });
  };

  const resetToDefault = () => {
    setEditedPrompt(UNIFIED_SYSTEM_PROMPT);
    setCurrentPromptTemplate(UNIFIED_SYSTEM_PROMPT);
    clearCurrentPrompt();
    const { version, versions } = savePromptVersion(UNIFIED_SYSTEM_PROMPT, {
      source: "reset",
      score: scorePromptTemplate(UNIFIED_SYSTEM_PROMPT).score,
    });
    setPromptVersions(versions);
    setActivePromptVersionIdState(version.id);
    setCompareLeftVersionId(version.id);
    setCompareRightVersionId(versions.find((candidate) => candidate.id !== version.id)?.id ?? "");
    showAlertDialog({
      title: t("promptStudio.alert.resetTitle"),
      description: t("promptStudio.alert.resetDesc"),
    });
  };

  const restorePromptVersion = (version: PromptVersion) => {
    if (version.prompt === UNIFIED_SYSTEM_PROMPT) {
      clearCurrentPrompt();
    } else {
      writeCurrentPrompt(version.prompt);
    }

    const rollback = savePromptVersion(version.prompt, {
      source: "rollback",
      score: version.score,
    });
    setCurrentPromptTemplate(version.prompt);
    setEditedPrompt(version.prompt);
    setPromptVersions(rollback.versions);
    setActivePromptVersionIdState(rollback.version.id);
    setCompareLeftVersionId(rollback.version.id);
    showAlertDialog({
      title: t("promptStudio.alert.versionRestoredTitle"),
      description: t("promptStudio.alert.versionRestoredDesc"),
    });
  };

  const saveCurrentTestSample = () => {
    if (!testText.trim()) return;

    const { samples } = savePromptTestSample({
      input: testText,
      selectedText: testSelectedContext,
      clipboardText: testClipboardContext,
    });
    setTestSamples(samples);
    showAlertDialog({
      title: t("promptStudio.alert.sampleSavedTitle"),
      description: t("promptStudio.alert.sampleSavedDesc"),
    });
  };

  const loadTestSample = (sample: PromptTestSample) => {
    setTestText(sample.input);
    setTestSelectedContext(sample.selectedText);
    setTestClipboardContext(sample.clipboardText);
  };

  const removeTestSample = (id: string) => {
    setTestSamples(deletePromptTestSample(id));
  };

  const getReasoningRuntime = () => {
    const useReasoningModel = readAppSetting("useReasoningModel");
    const reasoningModel = readAppSetting("reasoningModel");
    const reasoningProvider = reasoningModel ? getModelProvider(reasoningModel) : "openai";
    const providerConfig = PROVIDER_CONFIG[reasoningProvider] || {
      label: reasoningProvider.charAt(0).toUpperCase() + reasoningProvider.slice(1),
    };

    return {
      useReasoningModel,
      reasoningModel,
      reasoningProvider,
      providerConfig,
      providerLabel: providerConfig.label,
    };
  };

  const createTestPromptContext = (): PromptRuntimeContext | null =>
    testSelectedContext.trim() || testClipboardContext.trim()
      ? {
          selectedText: testSelectedContext,
          clipboardText: testClipboardContext,
          capturedAt: new Date().toISOString(),
        }
      : null;

  const runTextWithPromptTemplate = async (
    promptTemplate: string,
    runtime: ReturnType<typeof getReasoningRuntime>
  ): Promise<string> => {
    const promptContext = createTestPromptContext();
    const reasoningConfig = promptContext ? { promptContext } : {};
    const currentCustomPrompt = readCurrentPromptRaw();
    writeCurrentPrompt(promptTemplate);

    try {
      if (runtime.reasoningProvider === "local") {
        const result = await platform.reasoning.processLocal(
          testText,
          runtime.reasoningModel,
          agentName,
          reasoningConfig
        );

        if (result.success) {
          return result.text || "";
        }

        throw new Error(`Local model error: ${result.error}`);
      }

      return ReasoningService.processText(
        testText,
        runtime.reasoningModel,
        agentName,
        reasoningConfig
      );
    } finally {
      restoreCurrentPromptRaw(currentCustomPrompt);
    }
  };

  const nowMs = () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  const findPromptVersionId = (prompt: string): string | null => {
    const matchingVersion = promptVersions.find((version) => version.prompt === prompt);
    if (matchingVersion) return matchingVersion.id;
    return prompt === currentPromptTemplate ? activePromptVersionId : null;
  };

  const saveTestRunRecord = ({
    prompt,
    promptVersionId,
    output,
    error,
    durationMs,
    runtime,
    comparisonId,
  }: {
    prompt: string;
    promptVersionId: string | null;
    output: string;
    error: string | null;
    durationMs: number;
    runtime: ReturnType<typeof getReasoningRuntime>;
    comparisonId?: string;
  }): PromptTestRun => {
    const promptScore = scorePromptTemplate(prompt).score;
    const { run, runs } = savePromptTestRun({
      input: testText,
      selectedText: testSelectedContext,
      clipboardText: testClipboardContext,
      promptVersionId,
      promptScore,
      promptCharCount: prompt.length,
      provider: runtime.reasoningProvider,
      model: runtime.reasoningModel,
      output,
      error,
      durationMs,
      comparisonId,
    });
    setTestRuns(runs);
    return run;
  };

  const testPrompt = async () => {
    if (!testText.trim()) return;

    setIsLoading(true);
    setTestResult("");

    try {
      const runtime = getReasoningRuntime();

      if (!runtime.useReasoningModel) {
        setTestResult(t("promptStudio.aiDisabledDesc"));
        return;
      }

      if (!runtime.reasoningModel) {
        setTestResult(t("reasoning.noModelSelected"));
        return;
      }

      if (runtime.providerConfig.baseStorageKey) {
        const baseUrl = readProviderEndpoint(runtime.providerConfig);
        if (!baseUrl) {
          setTestResult(t("reasoning.baseUrlMissing", { provider: runtime.providerLabel }));
          return;
        }
      }

      const startedAt = nowMs();
      try {
        const result = await runTextWithPromptTemplate(editedPrompt, runtime);
        const durationMs = Math.round(nowMs() - startedAt);
        setTestResult(result);
        saveTestRunRecord({
          prompt: editedPrompt,
          promptVersionId: findPromptVersionId(editedPrompt),
          output: result,
          error: null,
          durationMs,
          runtime,
        });
      } catch (error) {
        const message = (error as Error).message || String(error);
        const durationMs = Math.round(nowMs() - startedAt);
        saveTestRunRecord({
          prompt: editedPrompt,
          promptVersionId: findPromptVersionId(editedPrompt),
          output: "",
          error: message,
          durationMs,
          runtime,
        });
        throw error;
      }
    } catch (error) {
      console.error("Test failed:", error);
      setTestResult(
        `${t("promptStudio.alert.testFailed")}: ${(error as Error).message || String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const comparePromptVersions = async () => {
    if (!testText.trim() || !compareLeftVersionId || !compareRightVersionId) return;
    if (compareLeftVersionId === compareRightVersionId) {
      showAlertDialog({
        title: t("promptStudio.compareSameVersionTitle"),
        description: t("promptStudio.compareSameVersionDesc"),
      });
      return;
    }

    const leftVersion = promptVersions.find((version) => version.id === compareLeftVersionId);
    const rightVersion = promptVersions.find((version) => version.id === compareRightVersionId);
    if (!leftVersion || !rightVersion) return;

    setIsComparing(true);
    setCompareRuns([]);

    try {
      const runtime = getReasoningRuntime();

      if (!runtime.useReasoningModel) {
        setTestResult(t("promptStudio.aiDisabledDesc"));
        return;
      }

      if (!runtime.reasoningModel) {
        setTestResult(t("reasoning.noModelSelected"));
        return;
      }

      if (runtime.providerConfig.baseStorageKey) {
        const baseUrl = readProviderEndpoint(runtime.providerConfig);
        if (!baseUrl) {
          setTestResult(t("reasoning.baseUrlMissing", { provider: runtime.providerLabel }));
          return;
        }
      }

      const comparisonId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const nextCompareRuns: PromptTestRun[] = [];

      for (const version of [leftVersion, rightVersion]) {
        const startedAt = nowMs();
        try {
          const output = await runTextWithPromptTemplate(version.prompt, runtime);
          const run = saveTestRunRecord({
            prompt: version.prompt,
            promptVersionId: version.id,
            output,
            error: null,
            durationMs: Math.round(nowMs() - startedAt),
            runtime,
            comparisonId,
          });
          nextCompareRuns.push(run);
        } catch (error) {
          const message = (error as Error).message || String(error);
          const run = saveTestRunRecord({
            prompt: version.prompt,
            promptVersionId: version.id,
            output: "",
            error: message,
            durationMs: Math.round(nowMs() - startedAt),
            runtime,
            comparisonId,
          });
          nextCompareRuns.push(run);
        }
      }

      setCompareRuns(nextCompareRuns);
    } finally {
      setIsComparing(false);
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

  const renderPromptScore = (report: PromptQualityReport) => {
    const statusBorder =
      report.percentage >= 85
        ? "border-l-green-600"
        : report.percentage >= 70
          ? "border-l-amber-500"
          : "border-l-red-600";

    return (
      <div
        className={`rounded-lg border border-neutral-200 border-l-4 bg-neutral-50 p-4 mb-4 text-neutral-900 ${statusBorder}`}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{t("promptStudio.qualityScore")}</p>
            <p className="text-xs opacity-80">
              {t("promptStudio.qualityPassed", {
                passed: report.passed,
                total: report.total,
              })}
            </p>
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {report.score}/{report.maxScore}
          </div>
        </div>
        {report.issues.length > 0 && (
          <div className="mt-3 text-xs opacity-90">
            {t("promptStudio.qualityMissing")}:{" "}
            {report.issues
              .slice(0, 3)
              .map((issue) => issue.label)
              .join(", ")}
          </div>
        )}
      </div>
    );
  };

  const renderCurrentPrompt = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5 text-neutral-900" />
          {t("promptStudio.currentPromptTitle")}
        </h3>
        <p className="text-sm text-gray-600 mb-6">{t("promptStudio.currentPromptDesc")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-neutral-900" />
            {t("promptStudio.unifiedPrompt")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-neutral-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-neutral-800">
                <p className="font-medium mb-1">{t("promptStudio.howItWorks")}</p>
                <ul className="list-disc list-inside space-y-1 text-neutral-700">
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

          {renderPromptScore(currentPromptScore)}

          <div className="bg-gray-50 border rounded-lg p-4 font-mono text-sm max-h-96 overflow-y-auto">
            <pre className="whitespace-pre-wrap">
              {currentPromptTemplate.replace(/\{\{agentName\}\}/g, agentName)}
            </pre>
          </div>
          <Button
            onClick={() => copyPrompt(currentPromptTemplate)}
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

  const formatPromptVersionTime = (createdAt: string): string => {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return createdAt;
    return date.toLocaleString();
  };

  const formatPromptVersionLabel = (version: PromptVersion): string =>
    `${formatPromptVersionTime(version.createdAt)} · ${version.score}/100`;

  const getRunVersionLabel = (run: PromptTestRun): string => {
    const version = promptVersions.find((candidate) => candidate.id === run.promptVersionId);
    if (version) return formatPromptVersionLabel(version);
    return t("promptStudio.unsavedPrompt");
  };

  const renderPromptVersions = () => {
    if (promptVersions.length === 0) return null;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4 text-neutral-900" />
            {t("promptStudio.versionsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {promptVersions.slice(0, 6).map((version) => {
              const isActive = version.id === activePromptVersionId;
              return (
                <div
                  key={version.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {formatPromptVersionTime(version.createdAt)}
                      </p>
                      {isActive && (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                          {t("promptStudio.versionActive")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {t("promptStudio.versionMeta", {
                        score: String(version.score),
                        chars: String(version.charCount),
                      })}
                    </p>
                  </div>
                  <Button
                    onClick={() => restorePromptVersion(version)}
                    variant={isActive ? "secondary" : "outline"}
                    size="sm"
                    disabled={isActive}
                    aria-label={t("promptStudio.restoreVersion")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderEditPrompt = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Edit3 className="w-5 h-5 text-neutral-900" />
          {t("promptStudio.customizeTitle")}
        </h3>
        <p className="text-sm text-gray-600 mb-2">{t("promptStudio.customizeDesc")}</p>
        <p className="text-sm text-amber-600 mb-6">
          <strong>{t("promptStudio.cautionDesc")}</strong>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("promptStudio.systemPrompt")}</CardTitle>
        </CardHeader>
        <CardContent>
          {renderPromptScore(editedPromptScore)}
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

      {renderPromptVersions()}
    </div>
  );

  const renderTestRunCard = (run: PromptTestRun, label?: string) => (
    <div className="rounded-lg border border-neutral-200 bg-white p-3" key={run.id}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900">
            {label || getRunVersionLabel(run)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t("promptStudio.runMeta", {
              model: run.model || "n/a",
              duration: String(run.durationMs),
            })}
          </p>
        </div>
        <Button onClick={() => copyPrompt(run.output || run.error || "")} variant="ghost" size="sm">
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <div
        className={`max-h-56 overflow-y-auto rounded-md border p-3 text-sm ${
          run.error
            ? "border-red-200 bg-red-50 text-red-900"
            : "border-neutral-200 bg-neutral-50 text-neutral-900"
        }`}
      >
        <pre className="whitespace-pre-wrap">{run.error || run.output}</pre>
      </div>
    </div>
  );

  const renderRecentTestRuns = () => {
    if (testRuns.length === 0) return null;

    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-neutral-900">{t("promptStudio.runsTitle")}</p>
          <span className="text-xs text-neutral-500">
            {t("promptStudio.runsCount", { count: String(testRuns.length) })}
          </span>
        </div>
        <div className="space-y-2">
          {testRuns.slice(0, 3).map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between gap-3 rounded-md bg-white p-2"
            >
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm text-neutral-900">{run.error || run.output}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatPromptVersionTime(run.createdAt)}
                </p>
              </div>
              <Button
                onClick={() => setTestRuns(deletePromptTestRun(run.id))}
                variant="ghost"
                size="sm"
                aria-label={t("promptStudio.deleteRun")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTestPlayground = () => {
    const useReasoningModel = readAppSetting("useReasoningModel");
    const reasoningModel = readAppSetting("reasoningModel");
    const reasoningProvider = reasoningModel ? getModelProvider(reasoningModel) : "openai";
    const providerConfig = PROVIDER_CONFIG[reasoningProvider] || {
      label: reasoningProvider.charAt(0).toUpperCase() + reasoningProvider.slice(1),
    };
    const providerLabel = providerConfig.label;
    const providerEndpoint = providerConfig.baseStorageKey
      ? readProviderEndpoint(providerConfig)
      : "";

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TestTube className="w-5 h-5 text-neutral-900" />
            {t("promptStudio.testTitle")}
          </h3>
          <p className="text-sm text-gray-600 mb-6">{t("promptStudio.testDesc")}</p>
        </div>

        {!useReasoningModel && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-800 font-medium">{t("promptStudio.aiDisabled")}</p>
                <p className="text-sm text-amber-700 mt-1">{t("promptStudio.aiDisabledDesc")}</p>
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
              <label className="block text-sm font-medium mb-2">
                {t("promptStudio.testInput")}
              </label>
              <Textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                rows={4}
                placeholder={t("promptStudio.testPlaceholder")}
              />
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-gray-500 space-y-1">
                  <p>{t("promptStudio.tryCleanup")}</p>
                  <p>{t("promptStudio.tryInstruction", { agentName })}</p>
                </div>
                {testText && (
                  <span
                    className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ml-4 ${
                      isAgentAddressed
                        ? "bg-neutral-100 text-neutral-900"
                        : "bg-neutral-100 text-neutral-700"
                    }`}
                  >
                    {isAgentAddressed
                      ? t("promptStudio.activeInstruction")
                      : t("promptStudio.activeCleanup")}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("promptStudio.testSelectedContext")}
                </label>
                <Textarea
                  value={testSelectedContext}
                  onChange={(e) => setTestSelectedContext(e.target.value)}
                  rows={3}
                  placeholder={t("promptStudio.testSelectedPlaceholder")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("promptStudio.testClipboardContext")}
                </label>
                <Textarea
                  value={testClipboardContext}
                  onChange={(e) => setTestClipboardContext(e.target.value)}
                  rows={3}
                  placeholder={t("promptStudio.testClipboardPlaceholder")}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  onClick={saveCurrentTestSample}
                  variant="outline"
                  size="sm"
                  disabled={!testText.trim()}
                >
                  <Save className="h-4 w-4" />
                  {t("promptStudio.saveSample")}
                </Button>
              </div>

              {testSamples.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="mb-2 text-sm font-medium text-neutral-900">
                    {t("promptStudio.samplesTitle")}
                  </div>
                  <div className="space-y-2">
                    {testSamples.slice(0, 4).map((sample) => (
                      <div
                        key={sample.id}
                        className="flex items-center justify-between gap-3 rounded-md bg-white p-2"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => loadTestSample(sample)}
                        >
                          <p className="truncate text-sm text-neutral-900">{sample.input}</p>
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {formatPromptVersionTime(sample.createdAt)}
                          </p>
                        </button>
                        <Button
                          onClick={() => removeTestSample(sample.id)}
                          variant="ghost"
                          size="sm"
                          aria-label={t("promptStudio.deleteSample")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {promptVersions.length >= 2 && (
              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <TestTube className="h-4 w-4 text-neutral-900" />
                  <p className="text-sm font-medium text-neutral-900">
                    {t("promptStudio.compareTitle")}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <select
                    value={compareLeftVersionId}
                    onChange={(event) => setCompareLeftVersionId(event.target.value)}
                    className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
                    aria-label={t("promptStudio.compareVersionA")}
                  >
                    {promptVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {formatPromptVersionLabel(version)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={compareRightVersionId}
                    onChange={(event) => setCompareRightVersionId(event.target.value)}
                    className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
                    aria-label={t("promptStudio.compareVersionB")}
                  >
                    {promptVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {formatPromptVersionLabel(version)}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={comparePromptVersions}
                    disabled={
                      !testText.trim() ||
                      isComparing ||
                      !useReasoningModel ||
                      !compareLeftVersionId ||
                      !compareRightVersionId
                    }
                  >
                    <Play className="h-4 w-4" />
                    {isComparing ? t("common.processing") : t("promptStudio.compareRun")}
                  </Button>
                </div>
              </div>
            )}

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

            {compareRuns.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {compareRuns.map((run, index) =>
                  renderTestRunCard(
                    run,
                    index === 0
                      ? t("promptStudio.compareVersionA")
                      : t("promptStudio.compareVersionB")
                  )
                )}
              </div>
            )}

            {renderRecentTestRuns()}
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
        onOk={() => {}}
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
              className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-neutral-900 text-neutral-900"
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
