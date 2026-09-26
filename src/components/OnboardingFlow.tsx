import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@astryxdesign/core/Card";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { AlertDialog as AstryxAlertDialog } from "@astryxdesign/core/AlertDialog";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { Stack } from "@astryxdesign/core/Stack";
import { Section } from "@astryxdesign/core/Section";
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
import TranscriptionModelPicker from "../features/settings/ui/TranscriptionModelPicker";
import PermissionCard from "./ui/PermissionCard";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import PasteToolsInfo from "./ui/PasteToolsInfo";
import StepProgress from "./ui/StepProgress";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../features/settings/hooks/usePermissions";
import { useClipboard } from "../features/clipboardCenter/hooks/useClipboard";
import { useSettings } from "../features/settings/hooks/useSettings";
import LanguageSelector from "./ui/LanguageSelector";
import { setAgentName as saveAgentName } from "../utils/agentName";
import { formatHotkeyLabel, getDefaultHotkey } from "../utils/hotkeys";
import { HotkeyInput } from "./ui/HotkeyInput";
import { useHotkeyRegistration } from "../features/hotkeys/hooks/useHotkeyRegistration";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import { useI18n } from "../i18n";
import { platform } from "../shared/platform";

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
    localAsrSettings,
    assemblyaiApiKey,
    openaiApiKey,
    customTranscriptionApiKey,
    groqApiKey,
    zaiApiKey,
    dictationKey,
    dictationTriggerMode,
    activationMode,
    setActivationMode,
    setDictationTriggerMode,
    setDictationKey,
    setAssemblyAIApiKey,
    setOpenaiApiKey,
    setCustomTranscriptionApiKey,
    setGroqApiKey,
    setZaiApiKey,
    updateTranscriptionSettings,
    updateLocalAsrSettings,
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
    try {
      const result = await platform.hotkeys.updateDictation(hotkey);
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
  }, [hotkey, showAlertDialog, t]);

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
      await platform.secrets.saveAll();
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

  const nextStep = useCallback(async () => {
    if (currentStep >= steps.length - 1) {
      return;
    }

    const newStep = currentStep + 1;
    setCurrentStep(newStep);

    // Show dictation panel when moving from permissions step (2) to hotkey & test step (3)
    if (currentStep === 2 && newStep === 3) {
      void platform.window.showDictationPanel();
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
              assemblyaiApiKey={assemblyaiApiKey}
              setAssemblyAIApiKey={setAssemblyAIApiKey}
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              customTranscriptionApiKey={customTranscriptionApiKey}
              setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              zaiApiKey={zaiApiKey}
              setZaiApiKey={setZaiApiKey}
              cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
              setCloudTranscriptionBaseUrl={(url) =>
                updateTranscriptionSettings({ cloudTranscriptionBaseUrl: url })
              }
              localAsrSettings={localAsrSettings}
              onLocalAsrSettingsChange={updateLocalAsrSettings}
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
                {t("settings.dictationTriggerMode")}
              </label>
              <p className="text-sm text-gray-600 mb-3">
                {t("settings.dictationTriggerMode.desc")}
              </p>
              <Selector
                label={t("settings.dictationTriggerMode")}
                isLabelHidden
                value={dictationTriggerMode}
                options={[
                  { value: "single", label: t("settings.singlePress") },
                  { value: "double", label: t("settings.doublePress") },
                ]}
                onChange={(value) =>
                  void handleDictationTriggerModeChange(value as "single" | "double")
                }
              />
            </div>

            <div className="pt-2">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                {t("onboarding.hotkey.activationMode")}
              </label>
              <ActivationModeSelector
                value={activationMode}
                onChange={setActivationMode}
                allowPushToTalk={dictationTriggerMode !== "double"}
              />
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
                <TextArea
                  label={t("onboarding.hotkey.testLabel")}
                  isLabelHidden
                  rows={3}
                  value=""
                  placeholder={t("onboarding.hotkey.testPlaceholder")}
                  onChange={() => undefined}
                />
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
              <TextInput
                label={t("onboarding.agent.inputLabel")}
                isLabelHidden
                placeholder={t("onboarding.agent.inputPlaceholder")}
                value={agentName}
                onChange={(value) => setAgentName(value)}
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
        if (cloudTranscriptionProvider === "assemblyai") {
          return assemblyaiApiKey.trim().length > 0;
        } else if (cloudTranscriptionProvider === "openai") {
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
    <Stack
      direction="vertical"
      height="100vh"
      className="h-screen flex flex-col bg-gradient-to-br from-neutral-50 via-white to-neutral-100/60"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <AstryxAlertDialog
        isOpen={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description || ""}
        actionLabel={confirmDialog.confirmText || "Confirm"}
        cancelLabel={confirmDialog.cancelText || "Cancel"}
        actionVariant={confirmDialog.variant === "destructive" ? "destructive" : "primary"}
        onAction={async () => {
          await confirmDialog.onConfirm?.();
          hideConfirmDialog();
        }}
      />

      <AstryxAlertDialog
        isOpen={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description || ""}
        actionLabel="OK"
        onAction={hideAlertDialog}
      />

      {/* Title Bar */}
      <Stack className="flex-shrink-0 z-10">
        <TitleBar
          showTitle={true}
          className="bg-white/95 backdrop-blur-xl border-b border-stone-200/60 shadow-sm"
        ></TitleBar>
      </Stack>

      {/* Progress Bar */}
      <Section
        variant="section"
        padding={4}
        className="flex-shrink-0 bg-white/90 backdrop-blur-xl border-b border-stone-200/60 md:px-16 z-10"
      >
        <Stack maxWidth={960} className="mx-auto">
          <StepProgress steps={steps} currentStep={currentStep} />
        </Stack>
      </Section>

      {/* Content - This will grow to fill available space */}
      <Stack isScrollable className="flex-1 px-6 md:pl-16 md:pr-6 py-12 overflow-y-auto">
        <Stack maxWidth={960} className="mx-auto" width="100%">
          <Card variant="default" elevation="med" className="bg-white/95 backdrop-blur-xl">
            <Stack padding={8} gap={8}>
              {renderStep()}
            </Stack>
          </Card>
        </Stack>
      </Stack>

      {/* Footer - This will stick to the bottom */}
      <Section
        variant="section"
        padding={4}
        className="flex-shrink-0 bg-white/95 backdrop-blur-xl border-t border-stone-200/60 md:px-16 z-10 shadow-sm"
      >
        <Stack
          direction="horizontal"
          justify="between"
          align="center"
          maxWidth={960}
          className="mx-auto"
          width="100%"
        >
          <AstryxButton
            label={t("onboarding.prev")}
            icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            onClick={prevStep}
            variant="secondary"
            isDisabled={currentStep === 0}
          />

          <Stack direction="horizontal" align="center" gap={3}>
            {currentStep === steps.length - 1 ? (
              <AstryxButton
                label={t("onboarding.complete")}
                icon={<Check className="h-4 w-4" aria-hidden="true" />}
                onClick={finishOnboarding}
                isDisabled={!canProceed()}
                variant="primary"
              />
            ) : (
              <AstryxButton
                label={t("onboarding.next")}
                onClick={nextStep}
                isDisabled={!canProceed()}
                endContent={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
              />
            )}
          </Stack>
        </Stack>
      </Section>
    </Stack>
  );
}
