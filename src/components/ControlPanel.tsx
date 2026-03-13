import { useState, useEffect } from "react";
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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
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

  const sidebarItems: SidebarItem[] = [
    { id: "general", label: "General", icon: Settings },
    { id: "transcription", label: "Transcription Mode", icon: Mic },
    { id: "clipboard", label: "Clipboard", icon: Clipboard },
    { id: "aiModels", label: "AI Text Cleanup", icon: Brain },
    { id: "agentConfig", label: "Agent Configuration", icon: User },
    { id: "prompts", label: "AI Prompts", icon: Sparkles },
    { id: "developer", label: "Troubleshooting", icon: Wrench },
    { id: "history", label: "Recent Transcriptions", icon: Clock },
  ];

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
        title: "Unable to load history",
        description: "Please try again in a moment.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: "Text copied to your clipboard",
        variant: "success",
        duration: 2000,
      });
    } catch (err) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy text to clipboard",
        variant: "destructive",
      });
    }
  };

  const clearHistory = async () => {
    showConfirmDialog({
      title: "Clear History",
      description:
        "Are you certain you wish to clear all inscribed records? This action cannot be undone.",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          clearStoreTranscriptions();
          showAlertDialog({
            title: "History Cleared",
            description: `Successfully cleared ${result.cleared} transcriptions from your chronicles.`,
          });
        } catch (error) {
          showAlertDialog({
            title: "Error",
            description: "Failed to clear history. Please try again.",
          });
        }
      },
      variant: "destructive",
    });
  };

  const deleteTranscription = async (id: number) => {
    showConfirmDialog({
      title: "Delete Transcription",
      description: "Are you certain you wish to remove this inscription from your records?",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.deleteTranscriptions?.(id);
          if (result?.success) {
            removeFromStore(id);
          } else {
            showAlertDialog({
              title: "Delete Failed",
              description: "Failed to delete transcription. It may have already been removed.",
            });
          }
        } catch (error) {
          showAlertDialog({
            title: "Delete Failed",
            description: "Failed to delete transcription. Please try again.",
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
              title: "Install Failed",
              description: "Failed to install update. Please try again.",
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
          title: "Download Failed",
          description: "Failed to download update. Please try again.",
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
          <span>Install Update</span>
        </>
      );
    }
    if (updateStatus.updateAvailable) {
      return (
        <>
          <Download size={14} />
          <span>Update Available</span>
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
            Recent Transcriptions
          </h2>
          {history.length > 0 && (
            <Button
              onClick={clearHistory}
              variant="ghost"
              size="icon"
              className="text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100"
              title="Clear history"
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
              <p className="text-neutral-600">Loading transcriptions...</p>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-neutral-100 rounded-full flex items-center justify-center">
                <Mic className="w-8 h-8 text-neutral-400" />
              </div>
              <h3 className="text-lg font-medium text-neutral-900 mb-2">
                No transcriptions yet
              </h3>
              <p className="text-neutral-600 mb-4 max-w-sm mx-auto">
                Press your hotkey to start recording and create your first transcription.
              </p>
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 max-w-md mx-auto">
                <h4 className="font-medium text-neutral-800 mb-2">Quick Start:</h4>
                <ol className="text-sm text-neutral-600 text-left space-y-1">
                  <li>1. Click in any text field</li>
                  <li>
                    2. Press{" "}
                    <kbd className="bg-white px-2 py-1 rounded text-xs font-mono border border-neutral-300">
                      {hotkey}
                    </kbd>{" "}
                    to start recording
                  </li>
                  <li>3. Speak your text</li>
                  <li>
                    4. Press{" "}
                    <kbd className="bg-white px-2 py-1 rounded text-xs font-mono border border-neutral-300">
                      {hotkey}
                    </kbd>{" "}
                    again to stop
                  </li>
                  <li>5. Your text will appear automatically!</li>
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
          className={`bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-200 ${
            isSidebarCollapsed ? "w-14" : "w-48"
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
                  className={`w-full flex items-center rounded-lg transition-all duration-200 ${
                    isSidebarCollapsed
                      ? "justify-center px-2 py-2"
                      : "gap-2.5 px-3 py-2.5 text-left text-sm"
                  } ${
                    isActive
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

        <div className="flex-1 overflow-y-auto bg-white">
          <div className="p-6 h-full flex justify-center">
            <div className="w-full max-w-3xl h-full">{renderContent()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
