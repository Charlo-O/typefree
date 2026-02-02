import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
import TitleBar from "./TitleBar";
import SupportDropdown from "./ui/SupportDropdown";
import TranscriptionItem from "./ui/TranscriptionItem";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/Toast";
import { useUpdater } from "../hooks/useUpdater";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  clearTranscriptions as clearStoreTranscriptions,
} from "../stores/transcriptionStore";
import { useI18n } from "../i18n";

type NavigationSection = SettingsSectionType | "history";

interface SidebarItem {
  id: NavigationSection;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

export default function ControlPanel() {
  const { t } = useI18n();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<NavigationSection>("history");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("controlPanel.sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const { hotkey } = useHotkey();
  const { toast } = useToast();

  // Platform detection - macOS uses native window decorations
  // Use navigator.platform for immediate detection (sync)
  const isMacOS = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

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

  // Use centralized updater hook to prevent EventEmitter memory leaks
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

  // Sidebar navigation items
  const sidebarItems: SidebarItem[] = [
    { id: "general", label: t("settings.general"), icon: Settings },
    { id: "transcription", label: t("settings.transcription"), icon: Mic },
    { id: "aiModels", label: t("settings.aiModels"), icon: Brain },
    { id: "agentConfig", label: t("settings.agentConfig"), icon: User },
    { id: "prompts", label: t("settings.promptStudio"), icon: Sparkles },
    { id: "developer", label: t("settings.developer"), icon: Wrench },
    { id: "history", label: t("controlPanel.history"), icon: Clock },
  ];

  useEffect(() => {
    loadTranscriptions();
  }, []);

  // Show toast when update is ready
  useEffect(() => {
    if (updateStatus.updateDownloaded && !isDownloading) {
      toast({
        title: t("controlPanel.updateReady"),
        description: t("controlPanel.updateReadyDesc"),
        variant: "success",
      });
    }
  }, [updateStatus.updateDownloaded, isDownloading, toast]);

  // Show toast on update error
  useEffect(() => {
    if (updateError) {
      toast({
        title: t("toast.error"),
        description: t("controlPanel.updateError"),
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
          const result = await window.electronAPI.clearTranscriptions();
          clearStoreTranscriptions();
          showAlertDialog({
            title: t("controlPanel.historyCleared"),
            description: `${t("controlPanel.clearedCount")} ${result.cleared}`,
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
          if (result.success) {
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
      // Show confirmation dialog before installing
      showConfirmDialog({
        title: t("settings.installUpdate"),
        description: t("controlPanel.installUpdateConfirm"),
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
      // Start download
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
          <span>{t("controlPanel.installing")}</span>
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
            {t("controlPanel.history")}
          </h2>
          {history.length > 0 && (
            <Button
              onClick={clearHistory}
              variant="ghost"
              size="icon"
              className="text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100"
            >
              <Trash2 size={16} />
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 mx-auto mb-3 bg-neutral-950 rounded-lg flex items-center justify-center">
                <span className="text-white text-sm">📝</span>
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
                  {t("controlPanel.quickStart")}:
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
        onOk={() => { }}
      />

      {/* Only show custom TitleBar on non-macOS platforms */}
      {!isMacOS && (
        <TitleBar
          actions={
            <>
              {/* Update button */}
              {!updateStatus.isDevelopment &&
                (updateStatus.updateAvailable ||
                  updateStatus.updateDownloaded ||
                  isDownloading ||
                  isInstalling) && (
                  <Button
                    variant={updateStatus.updateDownloaded ? "default" : "outline"}
                    size="sm"
                    onClick={handleUpdateClick}
                    disabled={isInstalling || isDownloading}
                    className={`gap-1.5 text-xs ${updateStatus.updateDownloaded
                      ? "bg-neutral-950 hover:bg-neutral-900 text-white"
                      : "border-neutral-300 text-neutral-900 hover:bg-neutral-50"
                      }`}
                  >
                    {getUpdateButtonContent()}
                  </Button>
                )}
              <SupportDropdown />
            </>
          }
        />
      )}

      {/* Main layout with sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Fixed Left Sidebar */}
        <div
          className={`bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-200 ${isSidebarCollapsed ? "w-14" : "w-48"
            }`}
        >
          <div className="p-3 pb-1 flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebarCollapsed}
              className="h-8 w-8 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </Button>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={`w-full flex items-center rounded-lg transition-all duration-200 ${isSidebarCollapsed
                    ? "justify-center px-2 py-2"
                    : "gap-2.5 px-3 py-2.5 text-left text-sm"
                    } ${isActive
                      ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                >
                  <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-neutral-900" : ""}`} />
                  {!isSidebarCollapsed && <span className="font-medium">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="p-6 h-full flex justify-center">
            <div className="w-full max-w-3xl h-full">{renderContent()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
