import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Trash2, Settings, FileText, Mic, Download, RefreshCw, Loader2 } from "lucide-react";
import SettingsModal from "./SettingsModal";
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

export default function ControlPanel() {
  const { t } = useI18n();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const { hotkey } = useHotkey();
  const { toast } = useToast();

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

  return (
    <div className="min-h-screen bg-white">
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
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "border-blue-300 text-blue-600 hover:bg-blue-50"
                    }`}
                >
                  {getUpdateButtonContent()}
                </Button>
              )}
            <SupportDropdown />
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)}>
              <Settings size={16} />
            </Button>
          </>
        }
      />

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />

      {/* Main content */}
      <div className="p-6">
        <div className="space-y-6 max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText size={18} className="text-indigo-600" />
                  {t("controlPanel.history")}
                </CardTitle>
                <div className="flex gap-2">
                  {history.length > 0 && (
                    <Button
                      onClick={clearHistory}
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">
                  <div className="w-8 h-8 mx-auto mb-3 bg-indigo-600 rounded-lg flex items-center justify-center">
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
                    <h4 className="font-medium text-neutral-800 mb-2">{t("controlPanel.quickStart")}:</h4>
                    <ol className="text-sm text-neutral-600 text-left space-y-1">
                      <li>1. {t("controlPanel.quickStart.step1")}</li>
                      <li>
                        2. {t("controlPanel.quickStart.step2", { hotkey })}
                      </li>
                      <li>3. {t("controlPanel.quickStart.step3")}</li>
                      <li>
                        4. {t("controlPanel.quickStart.step4", { hotkey })}
                      </li>
                      <li>5. {t("controlPanel.quickStart.step5")}</li>
                    </ol>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
