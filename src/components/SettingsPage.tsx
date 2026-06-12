import React, { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { RefreshCw, Download, Command, Mic, Shield, FolderOpen } from "lucide-react";
import MarkdownRenderer from "./ui/MarkdownRenderer";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import MicrophoneSettings from "./ui/MicrophoneSettings";
import TranscriptionModelPicker from "./TranscriptionModelPicker";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../hooks/useDialogs";
import { useAgentName } from "../utils/agentName";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";
import { useUpdater } from "../hooks/useUpdater";
import { getTranscriptionProviders } from "../models/ModelRegistry";
import { formatHotkeyLabel } from "../utils/hotkeys";
import PromptStudio from "./ui/PromptStudio";
import ReasoningModelSelector from "./ReasoningModelSelector";
import ClipboardSettings from "./ClipboardSettings";
import VocabularySettings from "./VocabularySettings";
import type { UpdateInfoResult } from "../types/electron";
import { HotkeyInput } from "./ui/HotkeyInput";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import DeveloperSection from "./DeveloperSection";
import { useI18n, normalizeUILanguage, UI_LANGUAGE_OPTIONS } from "../i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Toggle } from "./ui/toggle";
import { API_ENDPOINTS, normalizeBaseUrl } from "../config/constants";
import { PROCESSING_MODES, type ProcessingModeId } from "../config/processingModes";
import { setSetting } from "../utils/tauriAPI";

export type SettingsSectionType =
  | "general"
  | "transcription"
  | "clipboard"
  | "vocabulary"
  | "aiModels"
  | "agentConfig"
  | "prompts"
  | "developer";

interface SettingsPageProps {
  activeSection?: SettingsSectionType;
}

export default function SettingsPage({ activeSection = "general" }: SettingsPageProps) {
  const { language: uiLanguage, setLanguage: setUiLanguage, t } = useI18n();
  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const {
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl,
    useReasoningModel,
    reasoningModel,
    processingModeId,
    recordingOverlayVisualStyle,
    reasoningProvider,
    assemblyaiApiKey,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    deepseekApiKey,
    zaiApiKey,
    volcengineAppId,
    volcengineAccessToken,
    customReasoningApiKey,
    customTranscriptionApiKey,
    dictationKey,
    dictationTriggerMode,
    clipboardHotkey,
    activationMode,
    setActivationMode,
    launchAtStartup,
    setLaunchAtStartup,
    preferBuiltInMic,
    selectedMicDeviceId,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setUseReasoningModel,
    setReasoningModel,
    setProcessingModeId,
    setRecordingOverlayVisualStyle,
    setReasoningProvider,
    setAssemblyAIApiKey,
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setDeepseekApiKey,
    setZaiApiKey,
    setVolcengineAppId,
    setVolcengineAccessToken,
    setCustomReasoningApiKey,
    setCustomTranscriptionApiKey,
    setDictationKey,
    setDictationTriggerMode,
    setClipboardHotkey,
    updateTranscriptionSettings,
    updateReasoningSettings,
  } = useSettings();

  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [isUpdatingAutostart, setIsUpdatingAutostart] = useState(false);

  // Use centralized updater hook to prevent EventEmitter memory leaks
  const {
    status: updateStatus,
    info: updateInfo,
    downloadProgress: updateDownloadProgress,
    isChecking: checkingForUpdates,
    isDownloading: downloadingUpdate,
    isInstalling: installInitiated,
    checkForUpdates,
    downloadUpdate,
    installUpdate: installUpdateAction,
    getAppVersion,
    error: updateError,
  } = useUpdater();

  const isUpdateAvailable =
    !updateStatus.isDevelopment && (updateStatus.updateAvailable || updateStatus.updateDownloaded);

  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog);
  const { agentName, setAgentName } = useAgentName();
  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared hotkey registration hook
  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: true,
    showAlert: showAlertDialog,
  });

  const { registerHotkey: registerClipboardHotkey, isRegistering: isClipboardHotkeyRegistering } =
    useHotkeyRegistration({
      registerFn: async (hotkey) => {
        if (!window.electronAPI?.updateClipboardHotkey) {
          return { success: true };
        }
        return window.electronAPI.updateClipboardHotkey(hotkey);
      },
      onSuccess: (registeredHotkey) => {
        setClipboardHotkey(registeredHotkey);
      },
      showSuccessToast: false,
      showErrorToast: true,
      showAlert: showAlertDialog,
    });

  const [localReasoningProvider, setLocalReasoningProvider] = useState(() => {
    const stored = localStorage.getItem("reasoningProvider");
    if (stored) return stored;

    // Migration / first run default:
    // - If a non-default reasoning base URL is configured, assume user intended "custom".
    // - Otherwise fall back to the provider inferred from the selected model.
    const normalizedBase = normalizeBaseUrl(cloudReasoningBaseUrl);
    const normalizedDefault = normalizeBaseUrl(API_ENDPOINTS.OPENAI_BASE);
    if (normalizedBase && normalizedBase !== normalizedDefault) {
      return "custom";
    }

    return reasoningProvider;
  });

  useEffect(() => {
    localStorage.setItem("reasoningProvider", localReasoningProvider);
    void setSetting("reasoningProvider", localReasoningProvider);
  }, [localReasoningProvider]);

  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(async () => {
      if (!mounted) return;

      const version = await getAppVersion();
      if (version && mounted) setCurrentVersion(version);
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [getAppVersion]);

  // Show alert dialog on update errors
  useEffect(() => {
    if (updateError) {
      showAlertDialog({
        title: t("settings.updateErrorTitle"),
        description: updateError.message || t("settings.updateErrorDesc"),
      });
    }
  }, [updateError, showAlertDialog, t]);

  useEffect(() => {
    if (installInitiated) {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
      }
      installTimeoutRef.current = setTimeout(() => {
        showAlertDialog({
          title: t("settings.update.manualRestartTitle"),
          description: t("settings.update.manualRestartDesc"),
        });
      }, 10000);
    } else if (installTimeoutRef.current) {
      clearTimeout(installTimeoutRef.current);
      installTimeoutRef.current = null;
    }

    return () => {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
        installTimeoutRef.current = null;
      }
    };
  }, [installInitiated, showAlertDialog, t]);

  useEffect(() => {
    let mounted = true;

    const syncAutostart = async () => {
      try {
        const enabled = await window.electronAPI?.getAutoStartEnabled?.();
        if (!mounted || typeof enabled !== "boolean") return;
        setLaunchAtStartup(enabled);
      } catch {
        // ignore
      }
    };

    syncAutostart();
    return () => {
      mounted = false;
    };
  }, [setLaunchAtStartup]);

  const handleLaunchAtStartupChange = useCallback(
    async (checked: boolean) => {
      const previous = launchAtStartup;
      setLaunchAtStartup(checked);
      setIsUpdatingAutostart(true);

      try {
        const result = await window.electronAPI?.setAutoStartEnabled?.(checked);
        if (!result?.success) {
          throw new Error("Autostart update failed");
        }
      } catch (error: any) {
        setLaunchAtStartup(previous);
        showAlertDialog({
          title: t("settings.launchAtStartup.errorTitle"),
          description: t("settings.launchAtStartup.errorDesc"),
        });
      } finally {
        setIsUpdatingAutostart(false);
      }
    },
    [launchAtStartup, setLaunchAtStartup, showAlertDialog, t]
  );

  const handleDictationTriggerModeChange = useCallback(
    async (mode: "single" | "double") => {
      setDictationTriggerMode(mode);
      if (mode === "double" && activationMode !== "tap") {
        setActivationMode("tap");
      }

      try {
        const result = await window.electronAPI?.updateDictationTriggerMode?.(mode);
        if (result && !result.success) {
          showAlertDialog({
            title: t("settings.dictationHotkey"),
            description: result.message || t("settings.dictationTriggerMode.error"),
          });
        }
      } catch (error: any) {
        showAlertDialog({
          title: t("settings.dictationHotkey"),
          description: error?.message || t("settings.dictationTriggerMode.error"),
        });
      }
    },
    [activationMode, setActivationMode, setDictationTriggerMode, showAlertDialog, t]
  );

  const resetAccessibilityPermissions = () => {
    const message = `🔄 RESET ACCESSIBILITY PERMISSIONS\n\nIf you've rebuilt or reinstalled Typefree and automatic inscription isn't functioning, you may have obsolete permissions from the previous version.\n\n📋 STEP-BY-STEP RESTORATION:\n\n1️⃣ Open System Settings (or System Preferences)\n   • macOS Ventura+: Apple Menu → System Settings\n   • Older macOS: Apple Menu → System Preferences\n\n2️⃣ Navigate to Privacy & Security → Accessibility\n\n3️⃣ Look for obsolete Typefree entries:\n   • Any entries named "Typefree"\n   • Any entries named "Electron"\n   • Any entries with unclear or generic names\n   • Entries pointing to old application locations\n\n4️⃣ Remove ALL obsolete entries:\n   • Select each old entry\n   • Click the minus (-) button\n   • Enter your password if prompted\n\n5️⃣ Add the current Typefree:\n   • Click the plus (+) button\n   • Navigate to and select the CURRENT Typefree app\n   • Ensure the checkbox is ENABLED\n\n6️⃣ Restart Typefree completely\n\n💡 This is very common during development when rebuilding applications!\n\nClick OK when you're ready to open System Settings.`;

    showConfirmDialog({
      title: "Reset Accessibility Permissions",
      description: message,
      onConfirm: () => {
        showAlertDialog({
          title: "Opening System Settings",
          description:
            "Opening System Settings... Look for the Accessibility section under Privacy & Security.",
        });

        permissionsHook.openAccessibilitySettings();
      },
    });
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-8">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.appUpdates")}
                </h3>
                <p className="text-sm text-gray-600 mb-4">{t("settings.appUpdates.desc")}</p>
              </div>
              <div className="flex items-center justify-between p-5 bg-white border border-neutral-200 shadow-sm rounded-xl transition-shadow hover:shadow-md">
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {t("settings.currentVersion")}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {currentVersion || t("settings.loading")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {updateStatus.isDevelopment ? (
                    <span className="text-xs font-medium text-neutral-700 bg-neutral-100 px-2.5 py-1 rounded-full ring-1 ring-neutral-200">
                      {t("settings.devMode")}
                    </span>
                  ) : updateStatus.updateAvailable ? (
                    <span className="text-xs font-medium text-neutral-900 bg-neutral-100 px-2.5 py-1 rounded-full ring-1 ring-neutral-300">
                      {t("settings.updateAvailable")}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-neutral-700 bg-neutral-100 px-2.5 py-1 rounded-full ring-1 ring-neutral-200">
                      {t("settings.upToDate")}
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <Button
                  onClick={async () => {
                    try {
                      const result = await checkForUpdates();
                      if (result?.updateAvailable) {
                        showAlertDialog({
                          title: t("settings.updateAvailable"),
                          description: t("settings.updateAvailableDesc", {
                            version: result.version || t("settings.newVersion"),
                          }),
                        });
                      } else {
                        showAlertDialog({
                          title: t("dialog.noUpdates"),
                          description: result?.message || t("settings.noUpdatesDesc"),
                        });
                      }
                    } catch (error: any) {
                      showAlertDialog({
                        title: t("dialog.updateCheckFailed"),
                        description: t("settings.updateCheckFailedDesc", {
                          error: error.message,
                        }),
                      });
                    }
                  }}
                  disabled={checkingForUpdates || updateStatus.isDevelopment}
                  className="w-full"
                >
                  {checkingForUpdates ? (
                    <>
                      <RefreshCw size={16} className="animate-spin mr-2" />
                      {t("settings.checkingUpdates")}
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} className="mr-2" />
                      {t("settings.checkUpdates")}
                    </>
                  )}
                </Button>

                {isUpdateAvailable && !updateStatus.updateDownloaded && (
                  <div className="space-y-2">
                    <Button
                      onClick={async () => {
                        try {
                          await downloadUpdate();
                        } catch (error: any) {
                          showAlertDialog({
                            title: t("dialog.downloadFailed"),
                            description: t("settings.downloadFailedDesc", {
                              error: error.message,
                            }),
                          });
                        }
                      }}
                      disabled={downloadingUpdate}
                      className="w-full bg-neutral-950 hover:bg-neutral-900"
                    >
                      {downloadingUpdate ? (
                        <>
                          <Download size={16} className="animate-pulse mr-2" />
                          {t("settings.downloading")} {Math.round(updateDownloadProgress)}%
                        </>
                      ) : (
                        <>
                          <Download size={16} className="mr-2" />
                          {t("settings.downloadUpdate")}
                          {updateInfo?.version ? ` v${updateInfo.version}` : ""}
                        </>
                      )}
                    </Button>

                    {downloadingUpdate && (
                      <div className="space-y-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                          <div
                            className="h-full bg-neutral-950 transition-all duration-200"
                            style={{
                              width: `${Math.min(100, Math.max(0, updateDownloadProgress))}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-neutral-600 text-right">
                          {Math.round(updateDownloadProgress)}% {t("settings.downloaded")}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {updateStatus.updateDownloaded && (
                  <Button
                    onClick={() => {
                      showConfirmDialog({
                        title: t("settings.installUpdate"),
                        description: t("settings.installUpdateDesc", {
                          version: updateInfo?.version ? ` v${updateInfo.version}` : "",
                        }),
                        confirmText: t("settings.installRestart"),
                        onConfirm: async () => {
                          try {
                            await installUpdateAction();
                            showAlertDialog({
                              title: t("dialog.installingUpdate"),
                              description: t("settings.installingUpdateDesc"),
                            });
                          } catch (error: any) {
                            showAlertDialog({
                              title: t("dialog.installFailed"),
                              description: t("settings.installFailedDesc", {
                                error: error.message,
                              }),
                            });
                          }
                        },
                      });
                    }}
                    disabled={installInitiated}
                    className="w-full bg-neutral-950 hover:bg-neutral-900"
                  >
                    {installInitiated ? (
                      <>
                        <RefreshCw size={16} className="animate-spin mr-2" />
                        {t("settings.restartingToFinish")}
                      </>
                    ) : (
                      <>
                        <span className="mr-2">🚀</span>
                        {t("settings.quitInstallUpdate")}
                      </>
                    )}
                  </Button>
                )}

                {updateInfo?.version && (
                  <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
                    <h4 className="font-medium text-neutral-900 mb-2">
                      {t("settings.updateVersion", { version: updateInfo.version })}
                    </h4>
                    {updateInfo.releaseDate && (
                      <p className="text-sm text-neutral-700 mb-2">
                        {t("settings.released")}:{" "}
                        {new Date(updateInfo.releaseDate).toLocaleDateString()}
                      </p>
                    )}
                    {updateInfo.releaseNotes && (
                      <div className="text-sm text-neutral-800">
                        <p className="font-medium mb-1">{t("settings.whatsNew")}:</p>
                        <MarkdownRenderer content={updateInfo.releaseNotes} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.uiLanguage.label")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.uiLanguage.help")}</p>
              </div>

              <div className="max-w-sm">
                <Select
                  value={uiLanguage}
                  onValueChange={(value) => setUiLanguage(normalizeUILanguage(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UI_LANGUAGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.overlayVisualStyle.title")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  {t("settings.overlayVisualStyle.desc")}
                </p>
              </div>

              <div className="max-w-sm">
                <Select
                  value={recordingOverlayVisualStyle}
                  onValueChange={(value) =>
                    setRecordingOverlayVisualStyle(value as "classic" | "dual" | "timeline")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="timeline">
                      {t("settings.overlayVisualStyle.timeline")}
                    </SelectItem>
                    <SelectItem value="classic">
                      {t("settings.overlayVisualStyle.classic")}
                    </SelectItem>
                    <SelectItem value="dual">{t("settings.overlayVisualStyle.dual")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.launchAtStartup.title")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.launchAtStartup.desc")}</p>
              </div>

              <div className="flex items-center justify-between p-5 bg-white border border-neutral-200 shadow-sm rounded-xl transition-shadow hover:shadow-md">
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {t("settings.launchAtStartup.label")}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t("settings.launchAtStartup.help")}
                  </p>
                </div>
                <Toggle
                  checked={launchAtStartup}
                  onChange={handleLaunchAtStartupChange}
                  disabled={isUpdatingAutostart}
                />
              </div>
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.dictationHotkey")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.dictationHotkey.desc")}</p>
              </div>
              <HotkeyInput
                value={dictationKey}
                onChange={async (newHotkey) => {
                  await registerHotkey(newHotkey);
                }}
                disabled={isHotkeyRegistering || isClipboardHotkeyRegistering}
              />

              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t("settings.dictationTriggerMode")}
                </label>
                <p className="text-sm text-gray-600 mb-3">
                  {t("settings.dictationTriggerMode.desc")}
                </p>
                <Select
                  value={dictationTriggerMode}
                  onValueChange={(value) =>
                    void handleDictationTriggerModeChange(value as "single" | "double")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">{t("settings.singlePress")}</SelectItem>
                    <SelectItem value="double">{t("settings.doublePress")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t("settings.activationMode")}
                </label>
                <ActivationModeSelector
                  value={activationMode}
                  onChange={setActivationMode}
                  allowPushToTalk={dictationTriggerMode !== "double"}
                />
              </div>

              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-900 mb-2">
                  {t("settings.clipboardHotkey")}
                </h4>
                <p className="text-sm text-gray-600 mb-3">{t("settings.clipboardHotkey.desc")}</p>
                <HotkeyInput
                  value={clipboardHotkey}
                  onChange={async (newHotkey) => {
                    await registerClipboardHotkey(newHotkey);
                  }}
                  captureMode="single"
                  disabled={isHotkeyRegistering || isClipboardHotkeyRegistering}
                />
                <p className="mt-3 text-xs text-amber-700">{t("settings.singleKeyWarning")}</p>
              </div>
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.permissions")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.permissions.desc")}</p>
              </div>
              <div className="space-y-3">
                <Button
                  onClick={permissionsHook.requestMicPermission}
                  variant="outline"
                  className="w-full"
                >
                  <Mic className="mr-2 h-4 w-4" />
                  {t("settings.testMicPermission")}
                </Button>
                <Button
                  onClick={permissionsHook.testAccessibilityPermission}
                  variant="outline"
                  className="w-full"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  {t("settings.testAccessibility")}
                </Button>
                <Button
                  onClick={resetAccessibilityPermissions}
                  variant="secondary"
                  className="w-full"
                >
                  <span className="mr-2">⚙️</span>
                  {t("settings.fixPermissions")}
                </Button>
                {!permissionsHook.micPermissionGranted && (
                  <MicPermissionWarning
                    error={permissionsHook.micPermissionError}
                    onOpenSoundSettings={permissionsHook.openSoundInputSettings}
                    onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
                  />
                )}
              </div>
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.microphoneInput")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.microphoneInput.desc")}</p>
              </div>
              <MicrophoneSettings
                preferBuiltInMic={preferBuiltInMic}
                selectedMicDeviceId={selectedMicDeviceId}
                onPreferBuiltInChange={setPreferBuiltInMic}
                onDeviceSelect={setSelectedMicDeviceId}
              />
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("settings.about")}</h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.about.desc")}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-sm mb-6">
                <div className="text-center p-5 border border-neutral-200 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all group">
                  <div className="w-10 h-10 mx-auto mb-3 bg-neutral-100 text-neutral-900 rounded-xl flex items-center justify-center group-hover:scale-110 group-hover:bg-neutral-200 transition-all">
                    <Command className="w-5 h-5" />
                  </div>
                  <p className="font-medium text-neutral-900 mb-1">{t("settings.defaultHotkey")}</p>
                  <p className="text-neutral-500 font-mono text-xs bg-neutral-50 inline-block px-2 py-0.5 rounded">
                    {formatHotkeyLabel(dictationKey)}
                  </p>
                </div>
                <div className="text-center p-5 border border-neutral-200 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all group">
                  <div className="w-10 h-10 mx-auto mb-3 bg-neutral-100 text-neutral-900 rounded-xl flex items-center justify-center group-hover:scale-110 group-hover:bg-neutral-200 transition-all">
                    <span className="text-[18px]">🏷️</span>
                  </div>
                  <p className="font-medium text-neutral-900 mb-1">{t("settings.version")}</p>
                  <p className="text-neutral-500 text-xs">{currentVersion || "0.1.0"}</p>
                </div>
                <div className="text-center p-5 border border-neutral-200 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all group">
                  <div className="w-10 h-10 mx-auto mb-3 bg-neutral-100 text-neutral-900 rounded-xl flex items-center justify-center group-hover:scale-110 group-hover:bg-neutral-200 transition-all">
                    <span className="text-[18px]">✨</span>
                  </div>
                  <p className="font-medium text-neutral-900 mb-1">{t("settings.status")}</p>
                  <p className="text-neutral-600 text-xs font-medium">{t("settings.active")}</p>
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={() => {
                    showConfirmDialog({
                      title: t("settings.cleanupDanger"),
                      description: t("settings.cleanupWarning"),
                      onConfirm: () => {
                        window.electronAPI
                          ?.cleanupApp()
                          .then((result) => {
                            if (!result?.success) {
                              throw new Error(result?.message || t("settings.cleanupFailed"));
                            }
                            showAlertDialog({
                              title: t("settings.cleanupCompleted"),
                              description: t("settings.cleanupSuccess"),
                            });
                            setTimeout(() => {
                              window.location.reload();
                            }, 1000);
                          })
                          .catch((error) => {
                            showAlertDialog({
                              title: t("settings.cleanupFailed"),
                              description: `❌ ${t("settings.cleanupFailed")}: ${error.message}`,
                            });
                          });
                      },
                      variant: "destructive",
                    });
                  }}
                  variant="outline"
                  className="w-full text-neutral-900 border-neutral-300 hover:bg-neutral-50 hover:border-neutral-400"
                >
                  <span className="mr-2">🗑️</span>
                  {t("settings.cleanupData")}
                </Button>
              </div>
            </div>
          </div>
        );

      case "transcription":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t("settings.speechToText")}
              </h3>
              <p className="text-sm text-gray-600 mb-4">{t("settings.speechToText.desc")}</p>
            </div>

            <TranscriptionModelPicker
              selectedCloudProvider={cloudTranscriptionProvider}
              onCloudProviderSelect={setCloudTranscriptionProvider}
              selectedCloudModel={cloudTranscriptionModel}
              onCloudModelSelect={setCloudTranscriptionModel}
              assemblyaiApiKey={assemblyaiApiKey}
              setAssemblyAIApiKey={setAssemblyAIApiKey}
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              zaiApiKey={zaiApiKey}
              setZaiApiKey={setZaiApiKey}
              customTranscriptionApiKey={customTranscriptionApiKey}
              setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
              volcengineAppId={volcengineAppId}
              setVolcengineAppId={setVolcengineAppId}
              volcengineAccessToken={volcengineAccessToken}
              setVolcengineAccessToken={setVolcengineAccessToken}
              cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
              setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
              variant="settings"
            />
          </div>
        );

      case "clipboard":
        return <ClipboardSettings />;

      case "vocabulary":
        return <VocabularySettings />;

      case "aiModels":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t("settings.aiEnhancement")}
              </h3>
              <p className="text-sm text-gray-600 mb-6">{t("settings.aiEnhancement.desc")}</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-neutral-900">
                  {t("processingMode.title")}
                </h4>
                <p className="mt-1 text-xs text-neutral-500">{t("processingMode.desc")}</p>
              </div>
              <Select
                value={processingModeId}
                onValueChange={(value) => {
                  const next = value as ProcessingModeId;
                  setProcessingModeId(next);
                  updateReasoningSettings({ processingModeId: next });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROCESSING_MODES.map((mode) => (
                    <SelectItem key={mode.id} value={mode.id}>
                      {t(`processingMode.${mode.id}.name`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-3 text-xs text-neutral-500">
                {t(`processingMode.${processingModeId}.desc`)}
              </p>
            </div>

            <ReasoningModelSelector
              useReasoningModel={useReasoningModel}
              setUseReasoningModel={(value) => {
                setUseReasoningModel(value);
                updateReasoningSettings({ useReasoningModel: value });
              }}
              setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
              cloudReasoningBaseUrl={cloudReasoningBaseUrl}
              reasoningModel={reasoningModel}
              setReasoningModel={setReasoningModel}
              localReasoningProvider={localReasoningProvider}
              setLocalReasoningProvider={setLocalReasoningProvider}
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              customReasoningApiKey={customReasoningApiKey}
              setCustomReasoningApiKey={setCustomReasoningApiKey}
              anthropicApiKey={anthropicApiKey}
              setAnthropicApiKey={setAnthropicApiKey}
              geminiApiKey={geminiApiKey}
              setGeminiApiKey={setGeminiApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              deepseekApiKey={deepseekApiKey}
              setDeepseekApiKey={setDeepseekApiKey}
              showAlertDialog={showAlertDialog}
            />
          </div>
        );

      case "agentConfig":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Agent Configuration</h3>
              <p className="text-sm text-gray-600 mb-6">
                Customize your AI assistant's name and behavior to make interactions more personal
                and effective.
              </p>
            </div>

            <div className="space-y-4 p-4 bg-linear-to-r from-neutral-50 to-neutral-100 border border-neutral-200 rounded-xl">
              <h4 className="font-medium text-neutral-900 mb-3">
                {t("settings.agentConfig.howTo")}
              </h4>
              <ul className="text-sm text-neutral-700 space-y-2">
                <li>• {t("settings.agentConfig.tip1", { agentName })}</li>
                <li>• {t("settings.agentConfig.tip2", { agentName })}</li>
                <li>• {t("settings.agentConfig.tip3")}</li>
                <li>• {t("settings.agentConfig.tip4")}</li>
              </ul>
            </div>

            <div className="space-y-4 p-4 bg-gray-50 border border-gray-200 rounded-xl">
              <h4 className="font-medium text-gray-900">{t("settings.currentAgentName")}</h4>
              <div className="flex gap-3">
                <Input
                  placeholder={t("settings.agentConfig.inputPlaceholder")}
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="flex-1 text-center text-lg font-mono"
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0 px-3 text-sm"
                  onClick={() => {
                    setAgentName(agentName.trim());
                    showAlertDialog({
                      title: t("settings.agentConfig.saveName"),
                      description: t("settings.agentConfig.saveNameDesc", {
                        name: agentName.trim(),
                      }),
                    });
                  }}
                  disabled={!agentName.trim()}
                >
                  {t("settings.save")}
                </Button>
              </div>
              <p className="text-xs text-gray-600 mt-2">{t("settings.agentConfig.nameAdvice")}</p>
            </div>

            <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200">
              <h4 className="font-medium text-neutral-900 mb-2">
                {t("settings.agentConfig.exampleTitle")}
              </h4>
              <div className="text-sm text-neutral-700 space-y-1">
                <p>• {t("settings.agentConfig.example1", { agentName })}</p>
                <p>• {t("settings.agentConfig.example2", { agentName })}</p>
                <p>• {t("settings.agentConfig.example3", { agentName })}</p>
                <p>• {t("settings.agentConfig.example4")}</p>
              </div>
            </div>
          </div>
        );

      case "prompts":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t("promptStudio.title")}
              </h3>
              <p className="text-sm text-gray-600 mb-6">{t("promptStudio.desc")}</p>
            </div>

            <PromptStudio />
          </div>
        );

      case "developer":
        return <DeveloperSection />;

      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {renderSectionContent()}
    </>
  );
}
