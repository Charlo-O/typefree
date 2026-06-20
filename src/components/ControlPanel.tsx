import { useState, useEffect, useMemo } from "react";
import { Button } from "./ui/button";
import {
  Activity,
  CalendarDays,
  Trash2,
  Settings,
  FileText,
  Hash,
  Mic,
  Download,
  RefreshCw,
  Loader2,
  Brain,
  User,
  Home,
  Sparkles,
  Wrench,
  Clipboard,
  BookOpen,
  ChevronLeft,
  Timer,
} from "lucide-react";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
import TranscriptionItem from "./ui/TranscriptionItem";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useI18n } from "../i18n";
import { useToast } from "./ui/Toast";
import { useUpdater } from "../hooks/useUpdater";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  clearTranscriptions as clearStoreTranscriptions,
} from "../stores/transcriptionStore";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";

type NavigationSection = SettingsSectionType | "history";

interface SidebarItem {
  id: NavigationSection;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

const typefreeIconUrl = new URL("../assets/icon.png", import.meta.url).href;
const HEATMAP_WEEK_COUNT = 26;

function parseHistoryDate(item: TranscriptionItemType): Date | null {
  const source = item.timestamp || item.created_at;
  if (!source) {
    return null;
  }
  const normalized = source.endsWith("Z") ? source : `${source}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const dayOffset = (date.getDay() + 6) % 7;
  const start = startOfLocalDay(date);
  start.setDate(start.getDate() - dayOffset);
  return start;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatCompactNumber(value: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
}

function formatDurationParts(seconds: number, t: (key: string) => string) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) {
    return { value: String(rounded), unit: t("controlPanel.statUnit.seconds") };
  }
  const minutes = Math.floor(rounded / 60);
  if (minutes < 60) {
    return { value: String(minutes), unit: t("controlPanel.statUnit.minutes") };
  }
  const hours = rounded / 3600;
  return {
    value: hours < 10 ? hours.toFixed(1) : String(Math.round(hours)),
    unit: t("controlPanel.statUnit.hours"),
  };
}

function getGreeting(t: (key: string) => string): string {
  const hour = new Date().getHours();
  if (hour < 6) return t("controlPanel.greeting.night");
  if (hour < 11) return t("controlPanel.greeting.morning");
  if (hour < 13) return t("controlPanel.greeting.noon");
  if (hour < 18) return t("controlPanel.greeting.afternoon");
  return t("controlPanel.greeting.evening");
}

function getHeatmapCellClass(count: number, isFuture: boolean): string {
  if (isFuture) return "bg-neutral-50 border-neutral-100";
  if (count <= 0) return "bg-neutral-100 border-neutral-100";
  if (count === 1) return "bg-neutral-300 border-neutral-300";
  if (count <= 3) return "bg-neutral-500 border-neutral-500";
  return "bg-neutral-900 border-neutral-900";
}

function parseInitialSection(): NavigationSection {
  try {
    const section = new URLSearchParams(window.location.search).get("section");
    if (
      section === "general" ||
      section === "transcription" ||
      section === "clipboard" ||
      section === "vocabulary" ||
      section === "aiModels" ||
      section === "agentConfig" ||
      section === "prompts" ||
      section === "developer" ||
      section === "history"
    ) {
      return section;
    }
  } catch {
    // ignore
  }
  return "history";
}

function parseClipboardOnlyMode(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("clipboardOnly") === "1";
  } catch {
    return false;
  }
}

export default function ControlPanel() {
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<NavigationSection>(() =>
    parseInitialSection()
  );
  const [isClipboardOnly, setIsClipboardOnly] = useState(() => parseClipboardOnlyMode());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("controlPanel.sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const { toast } = useToast();
  const { t } = useI18n();

  const toggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("controlPanel.sidebarCollapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const {
    status: updateStatus,
    downloadProgress,
    isDownloading,
    isInstalling,
    downloadUpdate,
    installUpdate,
    error: updateError,
  } = useUpdater();

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const sidebarItems: SidebarItem[] = useMemo(
    () => [
      { id: "history", label: t("sidebar.home"), icon: Home },
      { id: "general", label: t("sidebar.general"), icon: Settings },
      { id: "transcription", label: t("sidebar.transcription"), icon: Mic },
      { id: "clipboard", label: t("sidebar.clipboard"), icon: Clipboard },
      { id: "vocabulary", label: t("sidebar.vocabulary"), icon: BookOpen },
      { id: "aiModels", label: t("sidebar.aiTextCleanup"), icon: Brain },
      { id: "agentConfig", label: t("sidebar.agentConfig"), icon: User },
      { id: "prompts", label: t("sidebar.aiPrompts"), icon: Sparkles },
      { id: "developer", label: t("sidebar.troubleshooting"), icon: Wrench },
    ],
    [t]
  );

  const historyStats = useMemo(() => {
    const dailyCounts: Record<string, number> = {};
    let totalCharacters = 0;

    history.forEach((item) => {
      totalCharacters += item.text?.length || 0;
      const date = parseHistoryDate(item);
      if (!date) return;
      const key = toDateKey(date);
      dailyCounts[key] = (dailyCounts[key] || 0) + 1;
    });

    const daysUsed = Object.keys(dailyCounts).length;
    const saved = formatDurationParts(totalCharacters * 0.67, t);

    return {
      dailyCounts,
      daysUsed,
      totalSessions: history.length,
      totalCharacters,
      saved,
    };
  }, [history, t]);

  const heatmapWeeks = useMemo(() => {
    const today = startOfLocalDay(new Date());
    const firstWeekStart = addDays(startOfWeek(today), -(HEATMAP_WEEK_COUNT - 1) * 7);
    const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });

    return Array.from({ length: HEATMAP_WEEK_COUNT }, (_, weekIndex) => {
      const days = Array.from({ length: 7 }, (_, dayIndex) => {
        const date = addDays(firstWeekStart, weekIndex * 7 + dayIndex);
        const key = toDateKey(date);
        const isFuture = date > today;
        return {
          key,
          date,
          count: isFuture ? 0 : historyStats.dailyCounts[key] || 0,
          isFuture,
        };
      });
      const monthStartDay = days.find((day) => day.date.getDate() === 1);
      const labelDate = weekIndex === 0 ? days[0].date : monthStartDay?.date;
      const label = labelDate ? monthFormatter.format(labelDate) : "";
      return { label, days };
    });
  }, [historyStats.dailyCounts]);

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
    const monday = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, index) => {
      if (index !== 0 && index !== 2 && index !== 4) return "";
      return formatter.format(addDays(monday, index));
    });
  }, []);

  useEffect(() => {
    loadTranscriptions();
  }, []);

  useEffect(() => {
    let unlistenClipboardPanel: undefined | (() => void);
    let unlistenControlPanel: undefined | (() => void);

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenClipboardPanel = await listen("open-clipboard-panel", () => {
          setActiveSection("clipboard");
          setIsClipboardOnly(true);
        });
        unlistenControlPanel = await listen("open-control-panel", () => {
          setIsClipboardOnly(false);
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      try {
        unlistenClipboardPanel?.();
        unlistenControlPanel?.();
      } catch {
        // ignore
      }
    };
  }, []);

  // Show toast when update is ready
  useEffect(() => {
    if (updateStatus.updateDownloaded && !isDownloading) {
      toast({
        title: "Update Ready",
        description: "Click 'Install Update' to restart and apply the update.",
        variant: "success",
      });
    }
  }, [updateStatus.updateDownloaded, isDownloading, toast]);

  useEffect(() => {
    if (updateError) {
      toast({
        title: "Update Error",
        description: "Failed to update. Please try again later.",
        variant: "destructive",
      });
    }
  }, [updateError, toast]);

  const loadTranscriptions = async () => {
    try {
      setIsLoading(true);
      await initializeTranscriptions();
    } catch (error) {
      showAlertDialog({
        title: t("controlPanel.loadError"),
        description: t("controlPanel.loadErrorDesc"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: t("toast.copied"),
        description: t("controlPanel.copiedDesc"),
        variant: "success",
        duration: 2000,
      });
    } catch (err) {
      toast({
        title: t("controlPanel.copyFailed"),
        description: t("controlPanel.copyFailedDesc"),
        variant: "destructive",
      });
    }
  };

  const clearHistory = async () => {
    showConfirmDialog({
      title: t("controlPanel.clearHistory"),
      description: t("controlPanel.clearAllConfirm"),
      onConfirm: async () => {
        try {
          const clearedCount = history.length;
          const result = await window.electronAPI.clearTranscriptions();
          if (!result.success) {
            throw new Error(result.error || "Failed to clear transcriptions");
          }
          clearStoreTranscriptions();
          showAlertDialog({
            title: t("controlPanel.historyCleared"),
            description: `${t("controlPanel.clearedCount")} ${clearedCount}`,
          });
        } catch (error) {
          showAlertDialog({
            title: t("common.error"),
            description: t("controlPanel.clearFailed"),
          });
        }
      },
      variant: "destructive",
    });
  };

  const deleteTranscription = async (id: number) => {
    showConfirmDialog({
      title: t("controlPanel.deleteTranscription"),
      description: t("controlPanel.deleteConfirm"),
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.deleteTranscription(id);
          if (result?.success) {
            removeFromStore(id);
          } else {
            showAlertDialog({
              title: t("controlPanel.deleteFailed"),
              description: t("controlPanel.deleteFailedDesc"),
            });
          }
        } catch (error) {
          showAlertDialog({
            title: t("controlPanel.deleteFailed"),
            description: t("controlPanel.deleteFailedRetry"),
          });
        }
      },
      variant: "destructive",
    });
  };

  const handleUpdateClick = async () => {
    if (updateStatus.updateDownloaded) {
      showConfirmDialog({
        title: "Install Update",
        description:
          "The update will be installed and the app will restart. Make sure you've saved any work.",
        onConfirm: async () => {
          try {
            await installUpdate();
          } catch (error) {
            toast({
              title: t("dialog.installFailed"),
              description: t("controlPanel.installFailedDesc"),
              variant: "destructive",
            });
          }
        },
      });
    } else if (updateStatus.updateAvailable && !isDownloading) {
      try {
        await downloadUpdate();
      } catch (error) {
        toast({
          title: t("dialog.downloadFailed"),
          description: t("controlPanel.downloadFailedDesc"),
          variant: "destructive",
        });
      }
    }
  };

  const getUpdateButtonContent = () => {
    if (isInstalling) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>Installing...</span>
        </>
      );
    }
    if (isDownloading) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>{downloadProgress}%</span>
        </>
      );
    }
    if (updateStatus.updateDownloaded) {
      return (
        <>
          <RefreshCw size={14} />
          <span>{t("settings.installUpdate")}</span>
        </>
      );
    }
    if (updateStatus.updateAvailable) {
      return (
        <>
          <Download size={14} />
          <span>{t("settings.updateAvailable")}</span>
        </>
      );
    }
    return null;
  };

  const renderHistoryContent = () => {
    const statCards = [
      {
        label: t("controlPanel.stats.daysUsed"),
        value: formatCompactNumber(historyStats.daysUsed),
        unit: t("controlPanel.statUnit.days"),
        icon: CalendarDays,
      },
      {
        label: t("controlPanel.stats.sessions"),
        value: formatCompactNumber(historyStats.totalSessions),
        unit: t("controlPanel.statUnit.times"),
        icon: Activity,
      },
      {
        label: t("controlPanel.stats.characters"),
        value: formatCompactNumber(historyStats.totalCharacters),
        unit: t("controlPanel.statUnit.characters"),
        icon: Hash,
      },
      {
        label: t("controlPanel.stats.savedTime"),
        value: historyStats.saved.value,
        unit: historyStats.saved.unit,
        icon: Timer,
      },
    ];

    return (
      <div className="min-h-full pb-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold text-neutral-950">{getGreeting(t)}</h2>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="min-h-32 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <div className="flex h-full min-w-0 flex-col justify-between gap-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-1">
                      <span className="truncate text-2xl font-bold leading-none text-neutral-950">
                        {card.value}
                      </span>
                      <span className="shrink-0 text-sm font-medium text-neutral-800">
                        {card.unit}
                      </span>
                    </div>
                    <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
                  </div>
                  <div className="text-xs font-semibold text-neutral-800">{card.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-neutral-950">
              {t("controlPanel.stats.usage")}
            </h3>
            <div className="text-right text-xs leading-5 text-neutral-500">
              <div>{t("controlPanel.stats.recentWindow")}</div>
              <div>
                {t("controlPanel.stats.totalInput", {
                  count: formatCompactNumber(historyStats.totalCharacters),
                })}
              </div>
            </div>
          </div>
          <div className="flex items-end gap-3 overflow-x-auto pb-1">
            <div
              className="grid shrink-0 gap-1 pt-5"
              style={{ gridTemplateRows: "repeat(7, 10px)" }}
            >
              {weekdayLabels.map((label, index) => (
                <div
                  key={`${label}-${index}`}
                  className="h-2.5 text-[10px] leading-none text-neutral-400"
                >
                  {label}
                </div>
              ))}
            </div>
            <div className="grid min-w-max gap-1">
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${HEATMAP_WEEK_COUNT}, 10px)` }}
              >
                {heatmapWeeks.map((week, index) => (
                  <div
                    key={`${week.label}-${index}`}
                    className="h-4 w-10 -ml-1 whitespace-nowrap text-[10px] leading-none text-neutral-400"
                  >
                    {week.label}
                  </div>
                ))}
              </div>
              <div
                className="grid grid-flow-col gap-1"
                style={{
                  gridTemplateColumns: `repeat(${HEATMAP_WEEK_COUNT}, 10px)`,
                  gridTemplateRows: "repeat(7, 10px)",
                }}
              >
                {heatmapWeeks.flatMap((week) =>
                  week.days.map((day) => (
                    <div
                      key={day.key}
                      className={`h-2.5 w-2.5 rounded-[3px] border ${getHeatmapCellClass(
                        day.count,
                        day.isFuture
                      )}`}
                      title={`${day.key}: ${day.count}`}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
              <FileText size={16} className="text-neutral-700" />
              {t("sidebar.recentTranscriptions")}
            </h3>
            {history.length > 0 && (
              <Button
                onClick={clearHistory}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
                title={t("controlPanel.clearHistory")}
              >
                <Trash2 size={15} />
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="py-8 text-center">
              <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-950">
                <FileText className="h-4 w-4 text-white" />
              </div>
              <p className="text-sm text-neutral-600">{t("common.loading")}</p>
            </div>
          ) : history.length === 0 ? (
            <div className="flex min-h-24 items-center justify-center gap-3 rounded-lg bg-neutral-50 px-4 py-8 text-center">
              <Mic className="h-5 w-5 text-neutral-400" />
              <div>
                <h4 className="text-sm font-medium text-neutral-800">
                  {t("controlPanel.emptyHistory")}
                </h4>
                <p className="mt-1 text-xs text-neutral-500">
                  {t("controlPanel.emptyHistoryDesc")}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item, index) => (
                <TranscriptionItem
                  key={item.id}
                  item={item}
                  index={index}
                  total={history.length}
                  onCopy={copyToClipboard}
                  onDelete={deleteTranscription}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (activeSection === "history") {
      return renderHistoryContent();
    }
    return <SettingsPage activeSection={activeSection as SettingsSectionType} />;
  };

  if (isClipboardOnly) {
    return (
      <div className="h-screen overflow-hidden bg-white">
        <ConfirmDialog
          open={confirmDialog.open}
          onOpenChange={hideConfirmDialog}
          title={confirmDialog.title}
          description={confirmDialog.description}
          onConfirm={confirmDialog.onConfirm}
          variant={confirmDialog.variant}
        />

        <AlertDialog
          open={alertDialog.open}
          onOpenChange={hideAlertDialog}
          title={alertDialog.title}
          description={alertDialog.description}
          onOk={() => {}}
        />

        <div className="h-full overflow-y-auto bg-white">
          <div className="mx-auto flex h-full w-full max-w-5xl justify-center p-6">
            <div className="w-full h-full">
              <SettingsPage activeSection="clipboard" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      <div className="flex-1 flex overflow-hidden">
        <div
          className={`bg-neutral-50/80 backdrop-blur-md border-r border-neutral-200/70 flex flex-col transition-all duration-300 ease-in-out ${
            isSidebarCollapsed ? "w-16" : "w-16 md:w-56"
          }`}
        >
          <div
            className={`border-b border-neutral-200/70 px-2 py-2 ${
              isSidebarCollapsed
                ? "flex items-center justify-center"
                : "flex flex-col items-center gap-1.5 md:flex-row md:gap-2"
            }`}
          >
            {isSidebarCollapsed ? (
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                title={t("sidebar.expand")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-neutral-200/80 transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900/25"
              >
                <img src={typefreeIconUrl} alt="TypeFree" className="h-7 w-7 rounded-md" />
              </button>
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-neutral-200/80">
                <img src={typefreeIconUrl} alt="TypeFree" className="h-7 w-7 rounded-md" />
              </div>
            )}
            {!isSidebarCollapsed && (
              <div className="hidden min-w-0 flex-1 md:block">
                <div className="truncate text-sm font-semibold text-neutral-950">TypeFree</div>
              </div>
            )}
            {!isSidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebarCollapsed}
                className="h-8 w-8 shrink-0 rounded-full text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-950"
                title={t("sidebar.collapse")}
              >
                <ChevronLeft size={16} />
              </Button>
            )}
          </div>

          <nav className="flex-1 px-3 py-2 overflow-y-auto">
            <div className="space-y-1 rounded-2xl bg-neutral-100/80 p-1.5">
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    title={isSidebarCollapsed ? item.label : undefined}
                    className={`min-h-[40px] w-full flex items-center rounded-lg border transition-all duration-150 group ${
                      isSidebarCollapsed
                        ? "justify-center px-2 py-2"
                        : "justify-center px-2 py-2 md:justify-start md:gap-3 md:px-3 md:text-left md:text-sm"
                    } ${
                      isActive
                        ? "border-neutral-200/80 bg-white text-neutral-950 shadow-sm font-medium"
                        : "border-transparent text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/60 font-normal"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 flex-shrink-0 transition-colors duration-150 ${
                        isActive
                          ? "text-neutral-950"
                          : "text-neutral-500 group-hover:text-neutral-900"
                      }`}
                    />
                    {!isSidebarCollapsed && (
                      <span className="hidden tracking-tight md:inline">{item.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          <div className="flex min-h-full justify-center p-4 md:px-6 md:py-5">
            <div className="h-full w-full max-w-5xl animate-in fade-in duration-300 slide-in-from-bottom-2">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
