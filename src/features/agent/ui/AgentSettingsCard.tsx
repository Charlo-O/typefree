import { useCallback, useEffect, useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { HotkeyInput } from "../../../components/ui/HotkeyInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useI18n } from "../../../i18n";
import { platform } from "../../../shared/platform";
import type { AgentBackendStatus } from "../../../shared/platform";
import type { AgentSafetyLevel } from "../../settings/schema/settingsSchema";

interface AgentSettingsCardProps {
  hotkey: string;
  onHotkeyChange: (hotkey: string) => void;
  hotkeyDisabled: boolean;
  agentCodexPath: string;
  setAgentCodexPath: (value: string) => void;
  agentWorkingDirectory: string;
  setAgentWorkingDirectory: (value: string) => void;
  agentSafetyLevel: AgentSafetyLevel;
  setAgentSafetyLevel: (value: AgentSafetyLevel) => void;
}

export default function AgentSettingsCard({
  hotkey,
  onHotkeyChange,
  hotkeyDisabled,
  agentCodexPath,
  setAgentCodexPath,
  agentWorkingDirectory,
  setAgentWorkingDirectory,
  agentSafetyLevel,
  setAgentSafetyLevel,
}: AgentSettingsCardProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AgentBackendStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const checkBackend = useCallback(async () => {
    setIsChecking(true);
    setCheckError(null);
    try {
      setStatus(await platform.agent.getStatus());
    } catch (error: unknown) {
      setStatus(null);
      setCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (platform.runtime.isTauri()) void checkBackend();
  }, [checkBackend]);

  const statusText = checkError
    ? checkError
    : status
      ? status.available
        ? t("agent.settings.statusReady", {
            version: status.version || "codex",
            path: status.executablePath || "",
          })
        : status.error || t("agent.settings.statusUnavailable")
      : t("agent.settings.statusUnknown");
  const statusOk = Boolean(status?.available) && !checkError;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-2">
        <Bot size={16} className="mt-0.5 shrink-0 text-neutral-700" aria-hidden />
        <div>
          <h4 className="text-sm font-semibold text-neutral-900">{t("agent.settings.title")}</h4>
          <p className="mt-1 text-xs text-neutral-500">{t("agent.settings.desc")}</p>
        </div>
      </div>

      <div className="divide-y divide-neutral-100">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(200px,42%)] items-center gap-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-neutral-900">{t("agent.settings.hotkey")}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{t("agent.settings.hotkeyDesc")}</p>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <HotkeyInput value={hotkey} onChange={onHotkeyChange} disabled={hotkeyDisabled} />
            </div>
            {hotkey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onHotkeyChange("")}
                disabled={hotkeyDisabled}
              >
                {t("settings.processingModeHotkeys.clear")}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(200px,42%)] items-center gap-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-neutral-900">{t("agent.settings.safety")}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {t(`agent.settings.safety.${agentSafetyLevel}.desc`)}
            </p>
          </div>
          <Select
            value={agentSafetyLevel}
            onValueChange={(value) => setAgentSafetyLevel(value as AgentSafetyLevel)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balanced">{t("agent.settings.safety.balanced")}</SelectItem>
              <SelectItem value="strict">{t("agent.settings.safety.strict")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(200px,42%)] items-center gap-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-neutral-900">
              {t("agent.settings.workingDirectory")}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {t("agent.settings.workingDirectoryDesc")}
            </p>
          </div>
          <Input
            value={agentWorkingDirectory}
            placeholder="~/TypeFree Agent"
            onChange={(event) => setAgentWorkingDirectory(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(200px,42%)] items-center gap-4 py-3 last:pb-0">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-neutral-900">
              {t("agent.settings.codexPath")}
            </p>
            <p
              className={`mt-0.5 break-all text-xs ${statusOk ? "text-emerald-700" : "text-neutral-500"}`}
            >
              {statusText}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <Input
              className="min-w-0 flex-1"
              value={agentCodexPath}
              placeholder={t("agent.settings.codexPathPlaceholder")}
              onChange={(event) => setAgentCodexPath(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void checkBackend()}
              disabled={isChecking}
              aria-label={t("agent.settings.check")}
            >
              <RefreshCw size={14} className={isChecking ? "animate-spin" : undefined} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
