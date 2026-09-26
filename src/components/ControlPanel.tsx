import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  lazy,
  Suspense,
  type ComponentType,
} from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Layout } from "@astryxdesign/core/Layout";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Stack } from "@astryxdesign/core/Stack";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
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
  Timer,
} from "lucide-react";
import type { SettingsSectionType } from "../features/settings/ui/SettingsPage";
import TranscriptionItem from "./ui/TranscriptionItem";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useI18n } from "../i18n";
import { useToast } from "./ui/toast-context";
import { useUpdater } from "../features/appUpdate/hooks/useUpdater";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  clearTranscriptions as clearStoreTranscriptions,
} from "../stores/transcriptionStore";
import { platform } from "../shared/platform";
import type { TranscriptionItem as TranscriptionItemType } from "../types/desktop";

type NavigationSection = SettingsSectionType | "history";
type SettingsPageComponent = ComponentType<{ activeSection?: SettingsSectionType }>;
type LazyDefaultSettingsPage = { default: SettingsPageComponent };

const SettingsPage = lazy(
  () => import("../features/settings/ui/SettingsPage") as Promise<LazyDefaultSettingsPage>
);

interface SidebarItem {
  id: NavigationSection;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

const typefreeIconUrl = new URL("../assets/icon.png", import.meta.url).href;
const HEATMAP_WEEK_COUNT = 26;
const RUNTIME_PROBE_AUTORUN_ENV = "VITE_TYPEFREE_RUNTIME_PROBE_AUTORUN";
const NATIVE_RECORDING_SMOKE_AUTORUN_ENV = "VITE_TYPEFREE_NATIVE_RECORDING_SMOKE_AUTORUN";
const DICTATION_PIPELINE_SMOKE_AUTORUN_ENV = "VITE_TYPEFREE_DICTATION_PIPELINE_SMOKE_AUTORUN";
const CLOUD_TRANSCRIPTION_SMOKE_AUTORUN_ENV = "VITE_TYPEFREE_CLOUD_TRANSCRIPTION_SMOKE_AUTORUN";
const CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN_ENV = "VITE_TYPEFREE_CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN";

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

function SettingsPageFallback() {
  return (
    <Stack gap={4} padding={1}>
      <Section variant="muted" minHeight={28} width={192} />
      <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
        <Section variant="muted" minHeight={112} />
        <Section variant="muted" minHeight={112} />
      </Grid>
      <Section variant="muted" minHeight={176} />
    </Stack>
  );
}

function parseInitialSection(): NavigationSection {
  try {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    const runtimeProbeAutorun =
      import.meta.env[RUNTIME_PROBE_AUTORUN_ENV] === "1" || params.has("runtimeProbe");
    const nativeRecordingSmokeAutorun =
      import.meta.env[NATIVE_RECORDING_SMOKE_AUTORUN_ENV] === "1" ||
      params.has("nativeRecordingSmoke");
    const dictationPipelineSmokeAutorun =
      import.meta.env[DICTATION_PIPELINE_SMOKE_AUTORUN_ENV] === "1" ||
      params.has("dictationPipelineSmoke");
    const cloudTranscriptionSmokeAutorun =
      import.meta.env[CLOUD_TRANSCRIPTION_SMOKE_AUTORUN_ENV] === "1" ||
      params.has("cloudTranscriptionSmoke");
    const cloudCredentialPreflightAutorun =
      import.meta.env[CLOUD_CREDENTIAL_PREFLIGHT_AUTORUN_ENV] === "1" ||
      params.has("cloudCredentialPreflight");

    if (
      runtimeProbeAutorun ||
      nativeRecordingSmokeAutorun ||
      dictationPipelineSmokeAutorun ||
      cloudTranscriptionSmokeAutorun ||
      cloudCredentialPreflightAutorun
    ) {
      return "developer";
    }

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

  const handleSidebarCollapsedChange = useCallback((next: boolean) => {
    setIsSidebarCollapsed(next);
    try {
      localStorage.setItem("controlPanel.sidebarCollapsed", String(next));
    } catch {
      // ignore
    }
  }, []);

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

  const loadTranscriptions = useCallback(async () => {
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
  }, [showAlertDialog, t]);

  useEffect(() => {
    loadTranscriptions();
  }, [loadTranscriptions]);

  useEffect(() => {
    let cancelled = false;
    let unlistenClipboardPanel: undefined | (() => void);
    let unlistenControlPanel: undefined | (() => void);
    const dispose = (cleanup: unknown) => {
      if (typeof cleanup === "function") {
        cleanup();
      }
    };

    (async () => {
      try {
        const clipboardCleanup = await platform.events.onOpenClipboardPanel(() => {
          setActiveSection("clipboard");
          setIsClipboardOnly(true);
        });
        if (cancelled) {
          dispose(clipboardCleanup);
        } else if (typeof clipboardCleanup === "function") {
          unlistenClipboardPanel = clipboardCleanup;
        }

        const controlCleanup = await platform.events.onOpenControlPanel(() => {
          setIsClipboardOnly(false);
        });
        if (cancelled) {
          dispose(controlCleanup);
        } else if (typeof controlCleanup === "function") {
          unlistenControlPanel = controlCleanup;
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
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
          const result = await platform.history.clearTranscriptions();
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
          const result = await platform.history.deleteTranscription(id);
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
          <Text type="label">Installing...</Text>
        </>
      );
    }
    if (isDownloading) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <Text type="label">{downloadProgress}%</Text>
        </>
      );
    }
    if (updateStatus.updateDownloaded) {
      return (
        <>
          <RefreshCw size={14} />
          <Text type="label">{t("settings.installUpdate")}</Text>
        </>
      );
    }
    if (updateStatus.updateAvailable) {
      return (
        <>
          <Download size={14} />
          <Text type="label">{t("settings.updateAvailable")}</Text>
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
      <Stack gap={5} paddingBlockEnd={6} width="100%">
        <Heading level={1}>{getGreeting(t)}</Heading>

        <Grid columns={{ minWidth: 180, max: 4, repeat: "fit" }} gap={3}>
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label} minHeight={128} padding={4}>
                <Stack height="100%" gap={6} justify="between">
                  <Stack direction="horizontal" justify="between" align="start" gap={2}>
                    <Stack direction="horizontal" align="center" gap={1}>
                      <Text type="display-2" weight="bold" maxLines={1}>
                        {card.value}
                      </Text>
                      <Text type="label">{card.unit}</Text>
                    </Stack>
                    <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
                  </Stack>
                  <Text type="label">{card.label}</Text>
                </Stack>
              </Card>
            );
          })}
        </Grid>

        <Card padding={4}>
          <Stack gap={4}>
            <Stack direction="horizontal" justify="between" align="start" gap={4}>
              <Heading level={2}>{t("controlPanel.stats.usage")}</Heading>
              <Stack align="end" gap={0.5}>
                <Text type="supporting">{t("controlPanel.stats.recentWindow")}</Text>
                <Text type="supporting">
                  {t("controlPanel.stats.totalInput", {
                    count: formatCompactNumber(historyStats.totalCharacters),
                  })}
                </Text>
              </Stack>
            </Stack>
            <Stack direction="horizontal" align="end" gap={3} isScrollable paddingBlockEnd={1}>
              <Stack gap={1} paddingBlockStart={5} className="shrink-0">
                {weekdayLabels.map((label, index) => (
                  <Text key={`${label}-${index}`} type="supporting" className="h-2.5 w-4">
                    {label}
                  </Text>
                ))}
              </Stack>
              <Stack direction="horizontal" gap={1} className="min-w-max">
                {heatmapWeeks.map((week, index) => (
                  <Stack key={`${week.label}-${index}`} gap={1} className="shrink-0">
                    <Text type="supporting" className="h-4 min-w-10 whitespace-nowrap">
                      {week.label}
                    </Text>
                    <Stack gap={1}>
                      {week.days.map((day) => (
                        <Stack
                          as="span"
                          key={day.key}
                          className={`h-2.5 w-2.5 rounded-sm border ${getHeatmapCellClass(
                            day.count,
                            day.isFuture
                          )}`}
                          aria-label={`${day.key}: ${day.count}`}
                        />
                      ))}
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          </Stack>
        </Card>

        <Card padding={4}>
          <Stack gap={4}>
            <Stack direction="horizontal" justify="between" align="center" gap={3}>
              <Stack direction="horizontal" align="center" gap={2}>
                <FileText size={16} className="text-neutral-700" />
                <Heading level={2}>{t("sidebar.recentTranscriptions")}</Heading>
              </Stack>
              {history.length > 0 && (
                <AstryxButton
                  label={t("controlPanel.clearHistory")}
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  icon={<Trash2 size={15} />}
                  onClick={clearHistory}
                  tooltip={t("controlPanel.clearHistory")}
                />
              )}
            </Stack>

            {isLoading ? (
              <Stack align="center" gap={3} paddingBlock={8}>
                <Stack
                  align="center"
                  justify="center"
                  className="h-8 w-8 rounded-lg bg-neutral-950"
                >
                  <FileText className="h-4 w-4 text-white" />
                </Stack>
                <Text type="supporting">{t("common.loading")}</Text>
              </Stack>
            ) : history.length === 0 ? (
              <Section variant="muted" padding={6} minHeight={96}>
                <Stack direction="horizontal" align="center" justify="center" gap={3}>
                  <Mic className="h-5 w-5 text-neutral-400" />
                  <Stack gap={1}>
                    <Text type="label">{t("controlPanel.emptyHistory")}</Text>
                    <Text type="supporting">{t("controlPanel.emptyHistoryDesc")}</Text>
                  </Stack>
                </Stack>
              </Section>
            ) : (
              <Stack gap={3}>
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
              </Stack>
            )}
          </Stack>
        </Card>
      </Stack>
    );
  };

  const renderContent = () => {
    if (activeSection === "history") {
      return (
        <Layout height="auto" contentWidth={960} padding={4}>
          {renderHistoryContent()}
        </Layout>
      );
    }

    return (
      <Suspense fallback={<SettingsPageFallback />}>
        <SettingsPage activeSection={activeSection as SettingsSectionType} />
      </Suspense>
    );
  };

  if (isClipboardOnly) {
    return (
      <AppShell height="fill" contentPadding={0} variant="surface">
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
        <Suspense fallback={<SettingsPageFallback />}>
          <SettingsPage activeSection="clipboard" />
        </Suspense>
      </AppShell>
    );
  }

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      variant="elevated"
      sideNav={
        <SideNav
          aria-label="TypeFree navigation"
          header={
            <SideNavHeading
              icon={<img src={typefreeIconUrl} alt="" className="h-7 w-7 rounded-md" />}
              heading="TypeFree"
            />
          }
          collapsible={{
            isCollapsed: isSidebarCollapsed,
            onCollapsedChange: handleSidebarCollapsedChange,
            buttonLabel: isSidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse"),
          }}
        >
          <SideNavSection title={t("sidebar.home")} isHeaderHidden>
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              return (
                <SideNavItem
                  key={item.id}
                  label={item.label}
                  icon={<Icon size={16} />}
                  isSelected={activeSection === item.id}
                  onClick={() => setActiveSection(item.id)}
                />
              );
            })}
          </SideNavSection>
        </SideNav>
      }
    >
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
      {renderContent()}
    </AppShell>
  );
}
