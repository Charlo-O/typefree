import React, { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import {
  RefreshCw,
  Download,
  Command,
  Mic,
  Shield,
  VolumeX,
  Upload,
  Bookmark,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import MarkdownRenderer from "../../../components/ui/MarkdownRenderer";
import MicPermissionWarning from "../../../components/ui/MicPermissionWarning";
import MicrophoneSettings from "../../../components/ui/MicrophoneSettings";
import TranscriptionModelPicker from "./TranscriptionModelPicker";
import { ConfirmDialog, AlertDialog } from "../../../components/ui/dialog";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../../../hooks/useDialogs";
import { useAgentName } from "../../../utils/agentName";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../../clipboardCenter/hooks/useClipboard";
import { pruneStoredClipboardHistoryWithImageCleanup } from "../../clipboardCenter/clipboardRetention";
import { useUpdater } from "../../appUpdate/hooks/useUpdater";
import { getTranscriptionProviders } from "../../../models/ModelRegistry";
import { formatHotkeyLabel } from "../../../utils/hotkeys";
import PromptStudio from "../../promptStudio/ui/PromptStudio";
import ReasoningModelSelector from "./ReasoningModelSelector";
import ClipboardSettings from "../../clipboardCenter/ui/ClipboardSettings";
import VocabularySettings from "../../vocabulary/ui/VocabularySettings";
import type { UpdateInfoResult } from "../../../types/desktop";
import { HotkeyInput } from "../../../components/ui/HotkeyInput";
import { useHotkeyRegistration } from "../../hotkeys/hooks/useHotkeyRegistration";
import { ActivationModeSelector } from "../../../components/ui/ActivationModeSelector";
import DeveloperSection from "./DeveloperSection";
import { useI18n, normalizeUILanguage, UI_LANGUAGE_OPTIONS } from "../../../i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Toggle } from "../../../components/ui/toggle";
import { API_ENDPOINTS, normalizeBaseUrl } from "../../../config/constants";
import { PROCESSING_MODES, type ProcessingModeId } from "../../../config/processingModes";
import {
  normalizeProcessingModeHotkeys,
  serializeProcessingModeHotkeys,
  type ProcessingModeHotkeys,
} from "../../../config/processingModeHotkeys";
import { platform } from "../../../shared/platform";
import {
  createAppSettingsExportPayload,
  getBackendSettingKey,
  importAppSettingsExportPayload,
  normalizeAppSettingValue,
  readAppSetting,
  readStoredAppSetting,
  shouldSyncSettingToBackend,
  writeAppSetting,
} from "../schema/settingsSchema";
import {
  normalizeApplicationKey,
  parsePrivacyApplicationBlacklist,
  serializePrivacyApplicationBlacklist,
} from "../../privacy/privacySettings";
import {
  deleteDictationProfile,
  readDictationProfiles,
  saveDictationProfile,
  type DictationProfile,
} from "../dictationProfiles";
import { loadVocabularySettings, saveVocabularySettings } from "../../../utils/vocabulary";
import { setVocabularyActiveProfile } from "../../vocabulary/vocabularyLayers";
import {
  readActivePromptVersionId,
  readCurrentPromptRaw,
  restoreCurrentPromptRaw,
  setActivePromptVersionId,
} from "../../promptStudio/promptVersions";

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

// Page titles mirror the sidebar labels so the header always names the pane you are in.
const SECTION_TITLE_KEYS: Record<SettingsSectionType, string> = {
  general: "sidebar.general",
  transcription: "sidebar.transcription",
  clipboard: "sidebar.clipboard",
  vocabulary: "sidebar.vocabulary",
  aiModels: "sidebar.aiTextCleanup",
  agentConfig: "sidebar.agentConfig",
  prompts: "sidebar.aiPrompts",
  developer: "sidebar.troubleshooting",
};

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
    preferredLanguage,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    localAsrSettings,
    updateLocalAsrSettings,
    cloudReasoningBaseUrl,
    useReasoningModel,
    reasoningModel,
    processingModeId,
    processingModeHotkeys,
    recordingOverlayVisualStyle,
    muteSystemAudioWhileRecording,
    audioQualityProcessingEnabled,
    audioQualityNoiseGateEnabled,
    audioQualityPreRollMs,
    recordingMaxDurationSeconds,
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
    privacyApplicationBlacklist,
    privacyPauseHistoryInBlacklistedApps,
    privacyPauseClipboardInBlacklistedApps,
    privacyAutoDeleteHistoryEnabled,
    privacyHistoryRetentionDays,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
    setPrivacyApplicationBlacklist,
    setPrivacyPauseHistoryInBlacklistedApps,
    setPrivacyPauseClipboardInBlacklistedApps,
    setPrivacyAutoDeleteHistoryEnabled,
    setPrivacyHistoryRetentionDays,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setUseReasoningModel,
    setReasoningModel,
    setProcessingModeId,
    setProcessingModeHotkeys,
    setRecordingOverlayVisualStyle,
    setMuteSystemAudioWhileRecording,
    setAudioQualityProcessingEnabled,
    setAudioQualityNoiseGateEnabled,
    setAudioQualityPreRollMs,
    setRecordingMaxDurationSeconds,
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
  const [isDetectingPrivacyApp, setIsDetectingPrivacyApp] = useState(false);
  const [detectedPrivacyAppLabel, setDetectedPrivacyAppLabel] = useState("");
  const [dictationProfiles, setDictationProfiles] = useState<DictationProfile[]>(() =>
    readDictationProfiles()
  );
  const [profileName, setProfileName] = useState("");
  const [isApplyingProfile, setIsApplyingProfile] = useState(false);
  const [isProcessingModeHotkeyRegistering, setIsProcessingModeHotkeyRegistering] = useState(false);
  const parsedProcessingModeHotkeys = normalizeProcessingModeHotkeys(processingModeHotkeys);

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
  const settingsImportInputRef = useRef<HTMLInputElement | null>(null);

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
        return platform.hotkeys.updateClipboard(hotkey);
      },
      onSuccess: (registeredHotkey) => {
        setClipboardHotkey(registeredHotkey);
      },
      showSuccessToast: false,
      showErrorToast: true,
      showAlert: showAlertDialog,
    });

  const [localReasoningProvider, setLocalReasoningProvider] = useState(() => {
    const stored = readStoredAppSetting("reasoningProvider");
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
    writeAppSetting("reasoningProvider", localReasoningProvider);
    void platform.settings.set(getBackendSettingKey("reasoningProvider"), localReasoningProvider);
  }, [localReasoningProvider]);

  const handleExportSettings = useCallback(() => {
    try {
      const payload = createAppSettingsExportPayload();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `typefree-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      showAlertDialog({
        title: t("settings.settingsExported"),
        description: t("settings.settingsExportedDesc", {
          count: String(Object.keys(payload.settings).length),
        }),
      });
    } catch (error) {
      showAlertDialog({
        title: t("settings.settingsExportFailed"),
        description: error instanceof Error ? error.message : t("settings.settingsExportFailed"),
      });
    }
  }, [showAlertDialog, t]);

  const handleImportSettingsFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        const payload = JSON.parse(await file.text());
        const result = importAppSettingsExportPayload(payload);

        if (result.applied === 0) {
          throw new Error(t("settings.settingsImportFailedDesc"));
        }

        await Promise.all(
          result.appliedKeys
            .filter((key) => shouldSyncSettingToBackend(key))
            .map((key) => platform.settings.set(getBackendSettingKey(key), readAppSetting(key)))
        );

        showAlertDialog({
          title: t("settings.settingsImportTitle"),
          description: t("settings.settingsImportDesc", {
            count: String(result.applied),
          }),
        });
      } catch (error) {
        showAlertDialog({
          title: t("settings.settingsImportFailed"),
          description:
            error instanceof Error ? error.message : t("settings.settingsImportFailedDesc"),
        });
      }
    },
    [showAlertDialog, t]
  );

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
        const enabled = await platform.app.getAutoStartEnabled();
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
        const result = await platform.app.setAutoStartEnabled(checked);
        if (!result?.success) {
          throw new Error("Autostart update failed");
        }
      } catch {
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
        const result = await platform.hotkeys.updateDictationTriggerMode(mode);
        if (result && !result.success) {
          showAlertDialog({
            title: t("settings.dictationHotkey"),
            description: result.message || t("settings.dictationTriggerMode.error"),
          });
        }
      } catch (error: unknown) {
        showAlertDialog({
          title: t("settings.dictationHotkey"),
          description:
            error instanceof Error ? error.message : t("settings.dictationTriggerMode.error"),
        });
      }
    },
    [activationMode, setActivationMode, setDictationTriggerMode, showAlertDialog, t]
  );

  const handleProcessingModeHotkeyChange = useCallback(
    async (modeId: ProcessingModeId, hotkey: string) => {
      if (isProcessingModeHotkeyRegistering) return;
      const previous = normalizeProcessingModeHotkeys(processingModeHotkeys);
      const next: ProcessingModeHotkeys = { ...previous };
      const normalized = hotkey.trim();
      if (normalized) next[modeId] = normalized;
      else delete next[modeId];

      setProcessingModeHotkeys(serializeProcessingModeHotkeys(next));
      setIsProcessingModeHotkeyRegistering(true);
      try {
        const result = await platform.hotkeys.updateProcessingModeHotkeys(next);
        if (!result.success) {
          setProcessingModeHotkeys(serializeProcessingModeHotkeys(previous));
          showAlertDialog({
            title: t("settings.processingModeHotkeys"),
            description: result.message || t("toast.hotkeyUnavailable"),
          });
        }
      } finally {
        setIsProcessingModeHotkeyRegistering(false);
      }
    },
    [
      isProcessingModeHotkeyRegistering,
      processingModeHotkeys,
      setProcessingModeHotkeys,
      showAlertDialog,
      t,
    ]
  );

  const handleAddCurrentAppToPrivacyBlacklist = useCallback(async () => {
    setIsDetectingPrivacyApp(true);
    try {
      const application = await platform.app.getForegroundApplication();
      if (!application?.id) {
        showAlertDialog({
          title: t("settings.privacy.detectFailed"),
          description: t("settings.privacy.detectFailedDesc"),
        });
        return;
      }

      const next = serializePrivacyApplicationBlacklist([
        ...parsePrivacyApplicationBlacklist(privacyApplicationBlacklist),
        normalizeApplicationKey(application.id),
      ]);
      setPrivacyApplicationBlacklist(next);
      setDetectedPrivacyAppLabel(`${application.name || application.id} (${application.id})`);
    } catch (error) {
      showAlertDialog({
        title: t("settings.privacy.detectFailed"),
        description:
          error instanceof Error ? error.message : t("settings.privacy.detectFailedDesc"),
      });
    } finally {
      setIsDetectingPrivacyApp(false);
    }
  }, [privacyApplicationBlacklist, setPrivacyApplicationBlacklist, showAlertDialog, t]);

  const handlePrivacyRetentionDaysChange = useCallback(
    (value: string) => {
      setPrivacyHistoryRetentionDays(
        normalizeAppSettingValue("privacyHistoryRetentionDays", value)
      );
    },
    [setPrivacyHistoryRetentionDays]
  );

  const handleRecordingMaxDurationChange = useCallback(
    (value: string) => {
      setRecordingMaxDurationSeconds(
        normalizeAppSettingValue("recordingMaxDurationSeconds", value)
      );
    },
    [setRecordingMaxDurationSeconds]
  );

  const handleAudioQualityPreRollChange = useCallback(
    (value: string) => {
      setAudioQualityPreRollMs(normalizeAppSettingValue("audioQualityPreRollMs", value));
    },
    [setAudioQualityPreRollMs]
  );

  const handleSaveDictationProfile = useCallback(async () => {
    const vocabularySettings = await loadVocabularySettings().catch(() => null);
    const { profile, profiles } = saveDictationProfile({
      name:
        profileName.trim() ||
        t("settings.profiles.defaultName", {
          provider: cloudTranscriptionProvider,
          model: cloudTranscriptionModel,
        }),
      settings: {
        preferredLanguage,
        cloudTranscriptionProvider,
        cloudTranscriptionModel,
        cloudTranscriptionBaseUrl,
        processingModeId,
        useReasoningModel,
        reasoningModel,
        cloudReasoningBaseUrl,
        dictationKey,
        dictationTriggerMode,
        activationMode,
        promptVersionId: readActivePromptVersionId(),
        customPromptRaw: readCurrentPromptRaw(),
        vocabularyProfileId: vocabularySettings?.layers.activeProfileId || null,
      },
    });

    setDictationProfiles(profiles);
    setProfileName("");
    showAlertDialog({
      title: t("settings.profiles.savedTitle"),
      description: t("settings.profiles.savedDesc", { name: profile.name }),
    });
  }, [
    activationMode,
    cloudReasoningBaseUrl,
    cloudTranscriptionBaseUrl,
    cloudTranscriptionModel,
    cloudTranscriptionProvider,
    dictationKey,
    dictationTriggerMode,
    preferredLanguage,
    processingModeId,
    profileName,
    reasoningModel,
    showAlertDialog,
    t,
    useReasoningModel,
  ]);

  const handleApplyDictationProfile = useCallback(
    async (profile: DictationProfile) => {
      if (isApplyingProfile) return;
      setIsApplyingProfile(true);

      try {
        const profileSettings = profile.settings;

        updateTranscriptionSettings({
          preferredLanguage: profileSettings.preferredLanguage,
          cloudTranscriptionProvider: profileSettings.cloudTranscriptionProvider,
          cloudTranscriptionModel: profileSettings.cloudTranscriptionModel,
          cloudTranscriptionBaseUrl: profileSettings.cloudTranscriptionBaseUrl,
        });
        updateReasoningSettings({
          useReasoningModel: profileSettings.useReasoningModel,
          reasoningModel: profileSettings.reasoningModel,
          processingModeId: profileSettings.processingModeId,
          cloudReasoningBaseUrl: profileSettings.cloudReasoningBaseUrl,
        });
        await handleDictationTriggerModeChange(profileSettings.dictationTriggerMode);
        setActivationMode(
          profileSettings.dictationTriggerMode === "double" ? "tap" : profileSettings.activationMode
        );

        if (profileSettings.dictationKey && profileSettings.dictationKey !== dictationKey) {
          await registerHotkey(profileSettings.dictationKey);
        } else if (!profileSettings.dictationKey) {
          setDictationKey("");
        }

        restoreCurrentPromptRaw(profileSettings.customPromptRaw);
        setActivePromptVersionId(profileSettings.promptVersionId || null);

        const vocabularySettings = await loadVocabularySettings();
        await saveVocabularySettings({
          ...vocabularySettings,
          layers: setVocabularyActiveProfile(
            vocabularySettings.layers,
            profileSettings.vocabularyProfileId || profile.id
          ),
        });

        showAlertDialog({
          title: t("settings.profiles.appliedTitle"),
          description: t("settings.profiles.appliedDesc", { name: profile.name }),
        });
      } catch (error) {
        showAlertDialog({
          title: t("settings.profiles.applyFailedTitle"),
          description:
            error instanceof Error ? error.message : t("settings.profiles.applyFailedDesc"),
        });
      } finally {
        setIsApplyingProfile(false);
      }
    },
    [
      dictationKey,
      handleDictationTriggerModeChange,
      isApplyingProfile,
      registerHotkey,
      setActivationMode,
      setDictationKey,
      showAlertDialog,
      t,
      updateReasoningSettings,
      updateTranscriptionSettings,
    ]
  );

  const handleDeleteDictationProfile = useCallback(
    (profileId: string) => {
      setDictationProfiles(deleteDictationProfile(profileId));
      showAlertDialog({
        title: t("settings.profiles.deletedTitle"),
        description: t("settings.profiles.deletedDesc"),
      });
    },
    [showAlertDialog, t]
  );

  useEffect(() => {
    if (!privacyAutoDeleteHistoryEnabled) return;

    pruneStoredClipboardHistoryWithImageCleanup({
      deleteImageFiles: platform.clipboard.deleteImageFiles,
    });
    void (async () => {
      await platform.history.pruneTranscriptionHistory();
    })();
  }, [privacyAutoDeleteHistoryEnabled, privacyHistoryRetentionDays]);

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
          <div className="space-y-8 settings-general-layout">
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
                  <Button
                    variant="outline"
                    size="sm"
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
                  >
                    <RefreshCw size={14} className={checkingForUpdates ? "animate-spin" : ""} />
                    {checkingForUpdates
                      ? t("settings.checkingUpdates")
                      : t("settings.checkUpdates")}
                  </Button>
                </div>
              </div>
              {(isUpdateAvailable || updateStatus.updateDownloaded || updateInfo?.version) && (
                <div className="space-y-3">
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
              )}
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
                  {t("settings.profiles.title")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.profiles.desc")}</p>
              </div>

              <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder={t("settings.profiles.namePlaceholder")}
                    className="flex-1"
                  />
                  <Button type="button" onClick={() => void handleSaveDictationProfile()}>
                    <Save className="h-4 w-4" />
                    {t("settings.profiles.saveCurrent")}
                  </Button>
                </div>

                {dictationProfiles.length > 0 ? (
                  <div className="space-y-3">
                    {dictationProfiles.map((profile) => (
                      <div
                        key={profile.id}
                        className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <Bookmark className="h-4 w-4 shrink-0 text-neutral-500" />
                            <p className="truncate text-sm font-semibold text-neutral-900">
                              {profile.name}
                            </p>
                          </div>
                          <p className="mt-1 break-all font-mono text-xs text-neutral-500">
                            {t("settings.profiles.meta", {
                              language: profile.settings.preferredLanguage,
                              provider: profile.settings.cloudTranscriptionProvider,
                              model: profile.settings.cloudTranscriptionModel,
                              mode: profile.settings.processingModeId,
                              hotkey: profile.settings.dictationKey
                                ? formatHotkeyLabel(profile.settings.dictationKey)
                                : t("settings.profiles.noHotkey"),
                            })}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-600">
                              {profile.settings.promptVersionId
                                ? t("settings.profiles.promptLinked")
                                : t("settings.profiles.noPrompt")}
                            </span>
                            <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-600">
                              {t("settings.profiles.vocabularyProfile", {
                                id: profile.settings.vocabularyProfileId || profile.id,
                              })}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isApplyingProfile}
                            onClick={() => void handleApplyDictationProfile(profile)}
                          >
                            <Play className="h-4 w-4" />
                            {t("settings.profiles.apply")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteDictationProfile(profile.id)}
                            aria-label={t("settings.profiles.delete")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
                    {t("settings.profiles.empty")}
                  </div>
                )}
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
                  {t("settings.recordingAudio.title")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.recordingAudio.desc")}</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 p-5 bg-white border border-neutral-200 shadow-sm rounded-xl transition-shadow hover:shadow-md">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800">
                      <VolumeX className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {t("settings.recordingAudio.muteSystemAudio")}
                      </p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {t("settings.recordingAudio.muteSystemAudioHelp")}
                      </p>
                    </div>
                  </div>
                  <Toggle
                    checked={muteSystemAudioWhileRecording}
                    onChange={setMuteSystemAudioWhileRecording}
                  />
                </div>

                <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {t("settings.recordingAudio.qualityProcessing")}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {t("settings.recordingAudio.qualityProcessingHelp")}
                      </p>
                    </div>
                    <Toggle
                      checked={audioQualityProcessingEnabled}
                      onChange={setAudioQualityProcessingEnabled}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 border-t border-neutral-100 pt-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {t("settings.recordingAudio.noiseGate")}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {t("settings.recordingAudio.noiseGateHelp")}
                      </p>
                    </div>
                    <Toggle
                      checked={audioQualityNoiseGateEnabled}
                      onChange={setAudioQualityNoiseGateEnabled}
                      disabled={!audioQualityProcessingEnabled}
                    />
                  </div>

                  <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4 sm:max-w-xs">
                    <label className="block text-sm font-medium text-neutral-900">
                      {t("settings.recordingAudio.preRoll")}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={2000}
                      step={50}
                      value={audioQualityPreRollMs}
                      onChange={(event) => handleAudioQualityPreRollChange(event.target.value)}
                      disabled={!audioQualityProcessingEnabled}
                    />
                    <p className="text-xs text-neutral-500">
                      {t("settings.recordingAudio.preRollHelp")}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4 sm:max-w-xs">
                    <label className="block text-sm font-medium text-neutral-900">
                      {t("settings.recordingAudio.maxDuration")}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={3600}
                      step={15}
                      value={recordingMaxDurationSeconds}
                      onChange={(event) => handleRecordingMaxDurationChange(event.target.value)}
                    />
                    <p className="text-xs text-neutral-500">
                      {t("settings.recordingAudio.maxDurationHelp")}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {t("settings.privacy.title")}
                </h3>
                <p className="text-sm text-gray-600 mb-6">{t("settings.privacy.desc")}</p>
              </div>

              <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">
                      {t("settings.privacy.pauseHistory")}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {t("settings.privacy.pauseHistoryDesc")}
                    </p>
                  </div>
                  <Toggle
                    checked={privacyPauseHistoryInBlacklistedApps}
                    onChange={setPrivacyPauseHistoryInBlacklistedApps}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">
                      {t("settings.privacy.pauseClipboard")}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {t("settings.privacy.pauseClipboardDesc")}
                    </p>
                  </div>
                  <Toggle
                    checked={privacyPauseClipboardInBlacklistedApps}
                    onChange={setPrivacyPauseClipboardInBlacklistedApps}
                  />
                </div>

                <div className="flex flex-col gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">
                      {t("settings.privacy.autoDeleteHistory")}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {t("settings.privacy.autoDeleteHistoryDesc")}
                    </p>
                  </div>
                  <Toggle
                    checked={privacyAutoDeleteHistoryEnabled}
                    onChange={setPrivacyAutoDeleteHistoryEnabled}
                  />
                </div>

                <div className="flex flex-col gap-2 sm:max-w-xs">
                  <label className="block text-sm font-medium text-neutral-900">
                    {t("settings.privacy.retentionDays")}
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={privacyHistoryRetentionDays}
                    onChange={(event) => handlePrivacyRetentionDaysChange(event.target.value)}
                    disabled={!privacyAutoDeleteHistoryEnabled}
                  />
                  <p className="text-xs text-neutral-500">
                    {t("settings.privacy.retentionDaysHelp")}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-neutral-900">
                    {t("settings.privacy.blacklist")}
                  </label>
                  <Textarea
                    value={privacyApplicationBlacklist}
                    onChange={(event) => setPrivacyApplicationBlacklist(event.target.value)}
                    rows={5}
                    placeholder={t("settings.privacy.blacklistPlaceholder")}
                    className="text-sm"
                  />
                  <p className="text-xs text-neutral-500">{t("settings.privacy.blacklistHelp")}</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddCurrentAppToPrivacyBlacklist}
                    disabled={isDetectingPrivacyApp}
                    className="shrink-0"
                  >
                    {isDetectingPrivacyApp ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="mr-2 h-4 w-4" />
                    )}
                    {t("settings.privacy.addCurrentApp")}
                  </Button>
                  {detectedPrivacyAppLabel && (
                    <p className="text-xs text-neutral-500">
                      {t("settings.privacy.lastAdded", { app: detectedPrivacyAppLabel })}
                    </p>
                  )}
                </div>
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
              <div className="space-y-3 settings-action-grid">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button
                    onClick={handleExportSettings}
                    variant="outline"
                    className="w-full text-neutral-900 border-neutral-300 hover:bg-neutral-50 hover:border-neutral-400"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {t("settings.exportSettings")}
                  </Button>
                  <Button
                    onClick={() => settingsImportInputRef.current?.click()}
                    variant="outline"
                    className="w-full text-neutral-900 border-neutral-300 hover:bg-neutral-50 hover:border-neutral-400"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {t("settings.importSettings")}
                  </Button>
                </div>
                <input
                  ref={settingsImportInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportSettingsFile}
                />
                <Button
                  onClick={() => {
                    showConfirmDialog({
                      title: t("settings.cleanupDanger"),
                      description: t("settings.cleanupWarning"),
                      onConfirm: () => {
                        platform.app
                          .cleanup()
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
              localAsrSettings={localAsrSettings}
              onLocalAsrSettingsChange={updateLocalAsrSettings}
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
              {processingModeId === "command" && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t("processingMode.command.hint")}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-neutral-900">
                  {t("settings.processingModeHotkeys")}
                </h4>
                <p className="mt-1 text-xs text-neutral-500">
                  {t("settings.processingModeHotkeys.desc")}
                </p>
              </div>
              {/* One grouped list: mode copy on the left, its hotkey control on the right. */}
              <div className="divide-y divide-neutral-100">
                {PROCESSING_MODES.map((mode) => (
                  <div
                    key={mode.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(200px,42%)] items-center gap-4 py-3 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-neutral-900">
                        {t(`processingMode.${mode.id}.name`)}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {t(`processingMode.${mode.id}.desc`)}
                      </p>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <HotkeyInput
                          value={parsedProcessingModeHotkeys[mode.id] || ""}
                          onChange={(hotkey) =>
                            void handleProcessingModeHotkeyChange(mode.id, hotkey)
                          }
                          disabled={
                            isHotkeyRegistering ||
                            isClipboardHotkeyRegistering ||
                            isProcessingModeHotkeyRegistering
                          }
                        />
                      </div>
                      {parsedProcessingModeHotkeys[mode.id] && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleProcessingModeHotkeyChange(mode.id, "")}
                          disabled={
                            isHotkeyRegistering ||
                            isClipboardHotkeyRegistering ||
                            isProcessingModeHotkeyRegistering
                          }
                        >
                          {t("settings.processingModeHotkeys.clear")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
            <p className="settings-page-lede">
              Customize your AI assistant's name and behavior to make interactions more personal and
              effective.
            </p>

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
              <div className="flex gap-2">
                <Input
                  placeholder={t("settings.agentConfig.inputPlaceholder")}
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button
                  className="shrink-0 px-3"
                  onClick={() => {
                    const nextAgentName = agentName.trim();
                    setAgentName(nextAgentName);
                    void platform.settings.set("agentName", nextAgentName);
                    showAlertDialog({
                      title: t("settings.agentConfig.saveName"),
                      description: t("settings.agentConfig.saveNameDesc", {
                        name: nextAgentName,
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

      <div className="settings-page-root">
        <header className="settings-page-header">
          <h1>{t(SECTION_TITLE_KEYS[activeSection] ?? "controlPanel.settings")}</h1>
        </header>
        <div className="settings-page-content">{renderSectionContent()}</div>
      </div>
    </>
  );
}
