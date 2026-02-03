import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Settings,
  Mic,
  Shield,
  Command,
  Sparkles,
  User,
} from "lucide-react";
import TitleBar from "./TitleBar";
import TranscriptionModelPicker from "./TranscriptionModelPicker";
import PermissionCard from "./ui/PermissionCard";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import PasteToolsInfo from "./ui/PasteToolsInfo";
import StepProgress from "./ui/StepProgress";
import { AlertDialog, ConfirmDialog } from "./ui/dialog";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";
import { useSettings } from "../hooks/useSettings";
import LanguageSelector from "./ui/LanguageSelector";
import { setAgentName as saveAgentName } from "../utils/agentName";
import { formatHotkeyLabel, getDefaultHotkey } from "../utils/hotkeys";
import { HotkeyInput } from "./ui/HotkeyInput";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import { useI18n } from "../i18n";

interface OnboardingFlowProps {
  onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  // Max valid step index for the current onboarding flow (5 steps, index 0-4)
  const MAX_STEP = 4;

  const [currentStep, setCurrentStep, removeCurrentStep] = useLocalStorage(
    "onboardingCurrentStep",
    0,
    {
      serialize: String,
      deserialize: (value) => {
        const parsed = parseInt(value, 10);
        // Clamp to valid range to handle users upgrading from older versions
        // with different step counts
        if (isNaN(parsed) || parsed < 0) return 0;
        if (parsed > MAX_STEP) return MAX_STEP;
        return parsed;
      },
    }
  );

  const {
    preferredLanguage,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    openaiApiKey,
    groqApiKey,
    zaiApiKey,
    dictationKey,
    activationMode,
    setActivationMode,
    setDictationKey,
    setOpenaiApiKey,
    setGroqApiKey,
    setZaiApiKey,
    updateTranscriptionSettings,
  } = useSettings();
  const { t } = useI18n();

  const [hotkey, setHotkey] = useState(dictationKey || "`");
  const [agentName, setAgentName] = useState("Agent");
  const readableHotkey = formatHotkeyLabel(hotkey);
  const { alertDialog, confirmDialog, showAlertDialog, hideAlertDialog, hideConfirmDialog } =
    useDialogs();
  const practiceTextareaRef = useRef<HTMLInputElement>(null);

  // Ref to prevent React.StrictMode double-invocation of auto-registration
  const autoRegisterInFlightRef = useRef(false);
  const hotkeyStepInitializedRef = useRef(false);

  // Shared hotkey registration hook
  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setHotkey(registeredHotkey);
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false, // Don't show toast during onboarding auto-registration
    showErrorToast: false,
  });

  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog); // Initialize clipboard hook for permission checks

  const steps = [
    { title: t("onboarding.steps.welcome"), icon: Sparkles },
    { title: t("onboarding.steps.setup"), icon: Settings },
    { title: t("onboarding.steps.permissions"), icon: Shield },
    { title: t("onboarding.steps.hotkey"), icon: Command },
    { title: t("onboarding.steps.agent"), icon: User },
  ];

  useEffect(() => {
    if (currentStep === 4) {
      if (practiceTextareaRef.current) {
        practiceTextareaRef.current.focus();
      }
    }
  }, [currentStep]);

  // Auto-register default hotkey when entering the hotkey step (step 3)
  useEffect(() => {
    if (currentStep !== 3) {
      // Reset initialization flag when leaving step 3
      hotkeyStepInitializedRef.current = false;
      return;
    }

    // Prevent double-invocation from React.StrictMode
    if (autoRegisterInFlightRef.current || hotkeyStepInitializedRef.current) {
      return;
    }

    const autoRegisterDefaultHotkey = async () => {
      autoRegisterInFlightRef.current = true;
      hotkeyStepInitializedRef.current = true;

      try {
        // Get platform-appropriate default hotkey
        const defaultHotkey = getDefaultHotkey();

        // Only auto-register if no hotkey is currently set or it's the old default
        if (!hotkey || hotkey === "`" || hotkey === "GLOBE") {
          // Try to register the default hotkey silently
          const success = await registerHotkey(defaultHotkey);
          if (success) {
            setHotkey(defaultHotkey);
          }
        }
      } catch (error) {
        console.error("Failed to auto-register default hotkey:", error);
      } finally {
        autoRegisterInFlightRef.current = false;
      }
    };

    void autoRegisterDefaultHotkey();
  }, [currentStep, hotkey, registerHotkey]);

  const ensureHotkeyRegistered = useCallback(async () => {
    if (!window.electronAPI?.updateHotkey) {
      return true;
    }

    try {
      const result = await window.electronAPI.updateHotkey(hotkey);
      if (result && !result.success) {
        showAlertDialog({
          title: t("onboarding.error.hotkeyTitle"),
          description: result.message || t("onboarding.error.hotkeyDesc"),
        });
        return false;
      }
      return true;
    } catch (error) {
      console.error("Failed to register onboarding hotkey", error);
      showAlertDialog({
        title: t("onboarding.error.generic"),
        description: t("onboarding.error.hotkeyDesc"),
      });
      return false;
    }
  }, [hotkey, showAlertDialog]);

  const saveSettings = useCallback(async () => {
    const hotkeyRegistered = await ensureHotkeyRegistered();
    if (!hotkeyRegistered) {
      return false;
    }
    setDictationKey(hotkey);
    saveAgentName(agentName);

    localStorage.setItem("micPermissionGranted", permissionsHook.micPermissionGranted.toString());
    localStorage.setItem(
      "accessibilityPermissionGranted",
      permissionsHook.accessibilityPermissionGranted.toString()
    );
    localStorage.setItem("onboardingCompleted", "true");

    try {
      await window.electronAPI?.saveAllKeysToEnv?.();
    } catch (error) {
      console.error("Failed to persist API keys:", error);
    }

    return true;
  }, [
    hotkey,
    agentName,
    permissionsHook.micPermissionGranted,
    permissionsHook.accessibilityPermissionGranted,
    setDictationKey,
    ensureHotkeyRegistered,
  ]);

  const nextStep = useCallback(async () => {
    if (currentStep >= steps.length - 1) {
      return;
    }

    const newStep = currentStep + 1;
    setCurrentStep(newStep);

    // Show dictation panel when moving from permissions step (2) to hotkey & test step (3)
    if (currentStep === 2 && newStep === 3) {
      if (window.electronAPI?.showDictationPanel) {
        window.electronAPI.showDictationPanel();
      }
    }
  }, [currentStep, setCurrentStep, steps.length]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
    }
  }, [currentStep, setCurrentStep]);

  const finishOnboarding = useCallback(async () => {
    const saved = await saveSettings();
    if (!saved) {
      return;
    }
    // Clear the onboarding step since we're done
    removeCurrentStep();
    onComplete();
  }, [saveSettings, removeCurrentStep, onComplete]);

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Welcome
        return (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 mx-auto bg-neutral-100 rounded-full flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-neutral-900" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-stone-900 mb-2">
                {t("onboarding.welcome.title")}
              </h2>
              <p className="text-stone-600">{t("onboarding.welcome.desc")}</p>
            </div>
            <div className="bg-neutral-50/50 p-4 rounded-lg border border-neutral-200/60">
              <p className="text-sm text-neutral-800">
                {t("onboarding.welcome.feature1")}
                <br />
                {t("onboarding.welcome.feature2")}
                <br />
                {t("onboarding.welcome.feature3")}
              </p>
            </div>
          </div>
        );

      case 1: // Setup - Choose Mode & Configure
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {t("onboarding.setup.title")}
              </h2>
              <p className="text-gray-600">{t("onboarding.setup.desc")}</p>
            </div>

            {/* Configuration for selected mode */}
            <TranscriptionModelPicker
              selectedCloudProvider={cloudTranscriptionProvider}
              onCloudProviderSelect={(provider) =>
                updateTranscriptionSettings({ cloudTranscriptionProvider: provider })
              }
              selectedCloudModel={cloudTranscriptionModel}
              onCloudModelSelect={(model) =>
                updateTranscriptionSettings({ cloudTranscriptionModel: model })
              }
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              zaiApiKey={zaiApiKey}
              setZaiApiKey={setZaiApiKey}
              cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
              setCloudTranscriptionBaseUrl={(url) =>
                updateTranscriptionSettings({ cloudTranscriptionBaseUrl: url })
              }
              variant="onboarding"
            />

            {/* Language Selection */}
            <div className="space-y-4 p-4 bg-gray-50 border border-gray-200 rounded-xl">
              <h4 className="font-medium text-gray-900 mb-3">
                {t("onboarding.setup.languageTitle")}
              </h4>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("onboarding.setup.languageLabel")}
              </label>
              <LanguageSelector
                value={preferredLanguage}
                onChange={(value) => {
                  updateTranscriptionSettings({ preferredLanguage: value });
                }}
                className="w-full"
              />
              <p className="text-xs text-gray-600 mt-1">{t("onboarding.setup.languageHelp")}</p>
            </div>
          </div>
        );

      case 2: // Permissions
        const platform = permissionsHook.pasteToolsInfo?.platform;
        const isMacOS = platform === "darwin";

        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {t("onboarding.permissions.title")}
              </h2>
              <p className="text-gray-600">
                {isMacOS
                  ? t("onboarding.permissions.desc.mac")
                  : t("onboarding.permissions.desc.win")}
              </p>
            </div>

            <div className="space-y-4">
              <PermissionCard
                icon={Mic}
                title={t("onboarding.permissions.micTitle")}
                description={t("onboarding.permissions.micDesc")}
                granted={permissionsHook.micPermissionGranted}
                onRequest={permissionsHook.requestMicPermission}
                buttonText={t("onboarding.permissions.grant")}
              />

              {!permissionsHook.micPermissionGranted && (
                <MicPermissionWarning
                  error={permissionsHook.micPermissionError}
                  onOpenSoundSettings={permissionsHook.openSoundInputSettings}
                  onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
                />
              )}

              {isMacOS && (
                <PermissionCard
                  icon={Shield}
                  title={t("onboarding.permissions.accessibilityTitle")}
                  description={t("onboarding.permissions.accessibilityDesc")}
                  granted={permissionsHook.accessibilityPermissionGranted}
                  onRequest={permissionsHook.testAccessibilityPermission}
                  buttonText={t("onboarding.permissions.testGrant")}
                  onOpenSettings={permissionsHook.openAccessibilitySettings}
                />
              )}

              {/* Only show PasteToolsInfo on Linux when tools are NOT available (to show install instructions) */}
              {platform === "linux" &&
                permissionsHook.pasteToolsInfo &&
                !permissionsHook.pasteToolsInfo.available && (
                  <PasteToolsInfo
                    pasteToolsInfo={permissionsHook.pasteToolsInfo}
                    isChecking={permissionsHook.isCheckingPasteTools}
                    onCheck={permissionsHook.checkPasteToolsAvailability}
                  />
                )}
            </div>

            <div className="bg-amber-50 p-4 rounded-lg">
              <h4 className="font-medium text-amber-900 mb-2">
                {t("onboarding.permissions.privacyTitle")}
              </h4>
              <p className="text-sm text-amber-800">{t("onboarding.permissions.privacyDesc")}</p>
            </div>
          </div>
        );

      case 3: // Hotkey & Test (combined)
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {t("onboarding.hotkey.title")}
              </h2>
              <p className="text-gray-600">{t("onboarding.hotkey.desc")}</p>
            </div>

            <HotkeyInput
              value={hotkey}
              onChange={async (newHotkey) => {
                const success = await registerHotkey(newHotkey);
                if (success) {
                  setHotkey(newHotkey);
                }
              }}
              disabled={isHotkeyRegistering}
            />

            <div className="pt-2">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                {t("onboarding.hotkey.activationMode")}
              </label>
              <ActivationModeSelector value={activationMode} onChange={setActivationMode} />
            </div>

            <div className="bg-neutral-50/50 p-5 rounded-lg border border-neutral-200/60">
              <h3 className="font-semibold text-neutral-900 mb-3">
                {t("onboarding.hotkey.tryIt")}
              </h3>
              <p className="text-sm text-neutral-800 mb-3">
                {activationMode === "tap"
                  ? t("onboarding.hotkey.instruction.tap", { hotkey: readableHotkey })
                  : t("onboarding.hotkey.instruction.hold", { hotkey: readableHotkey })}
              </p>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  {t("onboarding.hotkey.testLabel")}
                </label>
                <Textarea rows={3} placeholder={t("onboarding.hotkey.testPlaceholder")} />
              </div>
            </div>
          </div>
        );

      case 4: // Agent Name (final step)
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-stone-900 mb-2">
                {t("onboarding.agent.title")}
              </h2>
              <p className="text-stone-600">{t("onboarding.agent.desc")}</p>
            </div>

            <div className="space-y-4 p-4 bg-gradient-to-r from-neutral-50 to-gray-50 border border-neutral-200 rounded-xl">
              <h4 className="font-medium text-neutral-900 mb-3">
                {t("onboarding.agent.helpTitle")}
              </h4>
              <ul className="text-sm text-neutral-800 space-y-1">
                <li>{t("onboarding.agent.help1", { agentName: agentName || "Agent" })}</li>
                <li>{t("onboarding.agent.help2")}</li>
                <li>{t("onboarding.agent.help3")}</li>
              </ul>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("onboarding.agent.inputLabel")}
              </label>
              <Input
                placeholder={t("onboarding.agent.inputPlaceholder")}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="text-center text-lg font-mono"
              />
              <p className="text-xs text-gray-500 mt-2">{t("onboarding.agent.footer")}</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return true; // Welcome
      case 1:
        // Setup - check if configuration is complete (cloud mode only)
        if (cloudTranscriptionProvider === "openai") {
          return openaiApiKey.trim().length > 0;
        } else if (cloudTranscriptionProvider === "groq") {
          return groqApiKey.trim().length > 0;
        } else if (cloudTranscriptionProvider === "custom") {
          // Custom can work without API key for local endpoints
          return true;
        }
        return openaiApiKey.trim().length > 0; // Default to OpenAI
      case 2: {
        // Permissions
        if (!permissionsHook.micPermissionGranted) {
          return false;
        }
        const currentPlatform = permissionsHook.pasteToolsInfo?.platform;
        if (currentPlatform === "darwin") {
          return permissionsHook.accessibilityPermissionGranted;
        }
        return true;
      }
      case 3:
        return hotkey.trim() !== ""; // Hotkey & Test step
      case 4:
        return agentName.trim() !== ""; // Agent name step (final)
      default:
        return false;
    }
  };

  // Load Google Font only in the browser
  React.useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div
      className="h-screen flex flex-col bg-gradient-to-br from-stone-50 via-white to-blue-50/30"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {/* Title Bar */}
      <div className="flex-shrink-0 z-10">
        <TitleBar
          showTitle={true}
          className="bg-white/95 backdrop-blur-xl border-b border-stone-200/60 shadow-sm"
        ></TitleBar>
      </div>

      {/* Progress Bar */}
      <div className="flex-shrink-0 bg-white/90 backdrop-blur-xl border-b border-stone-200/60 p-6 md:px-16 z-10">
        <div className="max-w-4xl mx-auto">
          <StepProgress steps={steps} currentStep={currentStep} />
        </div>
      </div>

      {/* Content - This will grow to fill available space */}
      <div className="flex-1 px-6 md:pl-16 md:pr-6 py-12 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white/95 backdrop-blur-xl border border-stone-200/60 shadow-lg rounded-2xl overflow-hidden">
            <CardContent className="p-12 md:p-16">
              <div className="space-y-8">{renderStep()}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer - This will stick to the bottom */}
      <div className="flex-shrink-0 bg-white/95 backdrop-blur-xl border-t border-stone-200/60 px-6 md:pl-16 md:pr-6 py-8 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Button
            onClick={prevStep}
            variant="outline"
            disabled={currentStep === 0}
            className="px-8 py-3 h-12 text-sm font-medium"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            {t("onboarding.prev")}
          </Button>

          <div className="flex items-center gap-3">
            {currentStep === steps.length - 1 ? (
              <Button
                onClick={finishOnboarding}
                disabled={!canProceed()}
                className="bg-neutral-900 hover:bg-neutral-800 px-8 py-3 h-12 text-sm font-medium"
              >
                <Check className="w-4 h-4 mr-2" />
                {t("onboarding.complete")}
              </Button>
            ) : (
              <Button
                onClick={nextStep}
                disabled={!canProceed()}
                className="px-8 py-3 h-12 text-sm font-medium"
              >
                {t("onboarding.next")}
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
