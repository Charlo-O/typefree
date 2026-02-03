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
import type { UpdateInfoResult } from "../types/electron";
import { HotkeyInput } from "./ui/HotkeyInput";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import DeveloperSection from "./DeveloperSection";
import { useI18n, normalizeUILanguage, UI_LANGUAGE_OPTIONS } from "../i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Toggle } from "./ui/toggle";
import { API_ENDPOINTS, normalizeBaseUrl } from "../config/constants";

export type SettingsSectionType =
  | "general"
  | "transcription"
  | "clipboard"
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
    reasoningProvider,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    zaiApiKey,
    customReasoningApiKey,
    customTranscriptionApiKey,
    dictationKey,
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
    setReasoningProvider,
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setZaiApiKey,
    setCustomReasoningApiKey,
    setCustomTranscriptionApiKey,
    setDictationKey,
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
        title: "Update Error",
        description:
          updateError.message ||
          "The updater encountered a problem. Please try again or download the latest release manually.",
      });
    }
  }, [updateError, showAlertDialog]);

  useEffect(() => {
    if (installInitiated) {
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
      }
      installTimeoutRef.current = setTimeout(() => {
        showAlertDialog({
          title: "Still Running",
          description:
            "OpenWhispr didn't restart automatically. Please quit the app manually to finish installing the update.",
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
  }, [installInitiated, showAlertDialog]);

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

  const resetAccessibilityPermissions = () => {
    const message = `🔄 RESET ACCESSIBILITY PERMISSIONS\n\nIf you've rebuilt or reinstalled OpenWhispr and automatic inscription isn't functioning, you may have obsolete permissions from the previous version.\n\n📋 STEP-BY-STEP RESTORATION:\n\n1️⃣ Open System Settings (or System Preferences)\n   • macOS Ventura+: Apple Menu → System Settings\n   • Older macOS: Apple Menu → System Preferences\n\n2️⃣ Navigate to Privacy & Security → Accessibility\n\n3️⃣ Look for obsolete OpenWhispr entries:\n   • Any entries named "OpenWhispr"\n   • Any entries named "Electron"\n   • Any entries with unclear or generic names\n   • Entries pointing to old application locations\n\n4️⃣ Remove ALL obsolete entries:\n   • Select each old entry\n   • Click the minus (-) button\n   • Enter your password if prompted\n\n5️⃣ Add the current OpenWhispr:\n   • Click the plus (+) button\n   • Navigate to and select the CURRENT OpenWhispr app\n   • Ensure the checkbox is ENABLED\n\n6️⃣ Restart OpenWhispr completely\n\n💡 This is very common during development when rebuilding applications!\n\nClick OK when you're ready to open System Settings.`;

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
              <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-neutral-800">
                    {t("settings.currentVersion")}
                  </p>
                  <p className="text-xs text-neutral-600">
                    {currentVersion || t("settings.loading")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {updateStatus.isDevelopment ? (
                    <span className="text-xs text-neutral-700 bg-neutral-100 px-2 py-1 rounded-full">
                      {t("settings.devMode")}
                    </span>
                  ) : updateStatus.updateAvailable ? (
                    <span className="text-xs text-neutral-900 bg-neutral-100 px-2 py-1 rounded-full">
                      {t("settings.updateAvailable")}
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-600 bg-neutral-100 px-2 py-1 rounded-full">
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
                          title: "Update Available",
                          description: `Update available: v${result.version || "new version"}`,
                        });
                      } else {
                        showAlertDialog({
                          title: "No Updates",
                          description: result?.message || "No updates available",
                        });
                      }
                    } catch (error: any) {
                      showAlertDialog({
                        title: "Update Check Failed",
                        description: `Error checking for updates: ${error.message}`,
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
                            title: "Download Failed",
                            description: `Failed to download update: ${error.message}`,
                          });
                        }
                      }}
                      disabled={downloadingUpdate}
                      className="w-full bg-neutral-950 hover:bg-neutral-900"
                    >
                      {downloadingUpdate ? (
                        <>
                          <Download size={16} className="animate-pulse mr-2" />
                          Downloading... {Math.round(updateDownloadProgress)}%
                        </>
                      ) : (
                        <>
                          <Download size={16} className="mr-2" />
                          Download Update{updateInfo?.version ? ` v${updateInfo.version}` : ""}
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
                          {Math.round(updateDownloadProgress)}% downloaded
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {updateStatus.updateDownloaded && (
                  <Button
                    onClick={() => {
                      showConfirmDialog({
                        title: "Install Update",
                        description: `Ready to install update${updateInfo?.version ? ` v${updateInfo.version}` : ""}. The app will restart to complete installation.`,
                        confirmText: "Install & Restart",
                        onConfirm: async () => {
                          try {
                            await installUpdateAction();
                            showAlertDialog({
                              title: "Installing Update",
                              description:
                                "OpenWhispr will restart automatically to finish installing the newest version.",
                            });
                          } catch (error: any) {
                            showAlertDialog({
                              title: "Install Failed",
                              description: `Failed to install update: ${error.message}`,
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
                        Restarting to Finish Update...
                      </>
                    ) : (
                      <>
                        <span className="mr-2">🚀</span>
                        Quit & Install Update
                      </>
                    )}
                  </Button>
                )}

                {updateInfo?.version && (
                  <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
                    <h4 className="font-medium text-neutral-900 mb-2">
                      Update v{updateInfo.version}
                    </h4>
                    {updateInfo.releaseDate && (
                      <p className="text-sm text-neutral-700 mb-2">
                        Released: {new Date(updateInfo.releaseDate).toLocaleDateString()}
                      </p>
                    )}
                    {updateInfo.releaseNotes && (
                      <div className="text-sm text-neutral-800">
                        <p className="font-medium mb-1">What's New:</p>
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
                  {t("settings.launchAtStartup.title")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.launchAtStartup.desc")}</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-neutral-800">
                    {t("settings.launchAtStartup.label")}
                  </p>
                  <p className="text-xs text-neutral-600">{t("settings.launchAtStartup.help")}</p>
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
                disabled={isHotkeyRegistering}
              />

              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Activation Mode
                </label>
                <ActivationModeSelector value={activationMode} onChange={setActivationMode} />
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-6">
                <div className="text-center p-4 border border-gray-200 rounded-xl bg-white">
                  <div className="w-8 h-8 mx-auto mb-2 bg-neutral-950 rounded-lg flex items-center justify-center">
                    <Command className="w-4 h-4 text-white" />
                  </div>
                  <p className="font-medium text-gray-800 mb-1">{t("settings.defaultHotkey")}</p>
                  <p className="text-gray-600 font-mono text-xs">
                    {formatHotkeyLabel(dictationKey)}
                  </p>
                </div>
                <div className="text-center p-4 border border-gray-200 rounded-xl bg-white">
                  <div className="w-8 h-8 mx-auto mb-2 bg-neutral-950 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">🏷️</span>
                  </div>
                  <p className="font-medium text-gray-800 mb-1">{t("settings.version")}</p>
                  <p className="text-gray-600 text-xs">{currentVersion || "0.1.0"}</p>
                </div>
                <div className="text-center p-4 border border-gray-200 rounded-xl bg-white">
                  <div className="w-8 h-8 mx-auto mb-2 bg-neutral-950 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">✓</span>
                  </div>
                  <p className="font-medium text-gray-800 mb-1">{t("settings.status")}</p>
                  <p className="text-neutral-900 text-xs font-medium">{t("settings.active")}</p>
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
                          .then(() => {
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
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              zaiApiKey={zaiApiKey}
              setZaiApiKey={setZaiApiKey}
              customTranscriptionApiKey={customTranscriptionApiKey}
              setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
              cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
              setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
              variant="settings"
            />
          </div>
        );

      case "clipboard":
        return <ClipboardSettings />;

      case "aiModels":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t("settings.aiEnhancement")}
              </h3>
              <p className="text-sm text-gray-600 mb-6">{t("settings.aiEnhancement.desc")}</p>
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
