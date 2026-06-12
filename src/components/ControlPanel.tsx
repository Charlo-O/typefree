import { useState, useEffect, useMemo } from "react";
import { Button } from "./ui/button";
import {
  Trash2,
  Settings,
  FileText,
  Mic,
  Download,
  RefreshCw,
  Loader2,
  Brain,
  User,
  Sparkles,
  Wrench,
  Clock,
  Clipboard,
  BookOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
import TranscriptionItem from "./ui/TranscriptionItem";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useI18n } from "../i18n";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/Toast";
import { useUpdater } from "../hooks/useUpdater";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  clearTranscriptions as clearStoreTranscriptions,
} from "../stores/transcriptionStore";

type NavigationSection = SettingsSectionType | "history";

interface SidebarItem {
  id: NavigationSection;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
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
  const { hotkey } = useHotkey();
  const { toast } = useToast();

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

  const { t } = useI18n();

  const sidebarItems: SidebarItem[] = useMemo(
    () => [
      { id: "general", label: t("sidebar.general"), icon: Settings },
      { id: "transcription", label: t("sidebar.transcription"), icon: Mic },
      { id: "clipboard", label: t("sidebar.clipboard"), icon: Clipboard },
      { id: "vocabulary", label: t("sidebar.vocabulary"), icon: BookOpen },
      { id: "aiModels", label: t("sidebar.aiTextCleanup"), icon: Brain },
      { id: "agentConfig", label: t("sidebar.agentConfig"), icon: User },
      { id: "prompts", label: t("sidebar.aiPrompts"), icon: Sparkles },
      { id: "history", label: t("sidebar.recentTranscriptions"), icon: Clock },
      { id: "developer", label: t("sidebar.troubleshooting"), icon: Wrench },
    ],
    [t]
  );

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
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <FileText size={20} className="text-neutral-900" />
            {t("sidebar.recentTranscriptions")}
          </h2>
          {history.length > 0 && (
            <Button
              onClick={clearHistory}
              variant="ghost"
              size="icon"
              className="text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100"
              title={t("controlPanel.clearHistory")}
            >
              <Trash2 size={16} />
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 mx-auto mb-3 bg-neutral-950 rounded-lg flex items-center justify-center">
                <FileText className="w-4 h-4 text-white" />
              </div>
              <p className="text-neutral-600">{t("common.loading")}</p>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-neutral-100 rounded-full flex items-center justify-center">
                <Mic className="w-8 h-8 text-neutral-400" />
              </div>
              <h3 className="text-lg font-medium text-neutral-900 mb-2">
                {t("controlPanel.emptyHistory")}
              </h3>
              <p className="text-neutral-600 mb-4 max-w-sm mx-auto">
                {t("controlPanel.emptyHistoryDesc")}
              </p>
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 max-w-md mx-auto">
                <h4 className="font-medium text-neutral-800 mb-2">
                  {t("controlPanel.quickStart")}
                </h4>
                <ol className="text-sm text-neutral-600 text-left space-y-1">
                  <li>1. {t("controlPanel.quickStart.step1")}</li>
                  <li>2. {t("controlPanel.quickStart.step2", { hotkey })}</li>
                  <li>3. {t("controlPanel.quickStart.step3")}</li>
                  <li>4. {t("controlPanel.quickStart.step4", { hotkey })}</li>
                  <li>5. {t("controlPanel.quickStart.step5")}</li>
                </ol>
              </div>
            </div>
          ) : (
            <div className="space-y-3 h-full overflow-y-auto pr-2">
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
            isSidebarCollapsed ? "w-16" : "w-56"
          }`}
        >
          <div className="p-3 pb-2 flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebarCollapsed}
              className="h-10 w-10 text-neutral-500 hover:text-neutral-950 hover:bg-neutral-200/60 rounded-full transition-colors"
              title={isSidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            >
              {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </Button>
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
                        : "gap-3 px-3 py-2 text-left text-sm"
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
                    {!isSidebarCollapsed && <span className="tracking-tight">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          <div className="p-8 h-full flex justify-center">
            <div className="w-full max-w-4xl h-full animate-in fade-in duration-300 slide-in-from-bottom-2">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
