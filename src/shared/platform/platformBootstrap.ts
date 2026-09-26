import { hasTauriRuntime } from "./commandCore";
import { log, setSetting } from "./settingsCommands";
import { readProcessingModePromptOverrides } from "../../config/processingModePromptStorage";

export type LegacyDesktopAPI = Record<string, unknown>;

type BootstrapMarker =
  | "__TYPEFREE_LOG_BRIDGE_INIT__"
  | "__TYPEFREE_DICTATION_SETTINGS_SYNC__"
  | "__TYPEFREE_PROCESSING_MODE_HOTKEY_SYNC__";

type BootstrapWindow = Window & {
  __TYPEFREE_LOG_BRIDGE_INIT__?: boolean;
  __TYPEFREE_DICTATION_SETTINGS_SYNC__?: boolean;
  tauriAPI?: LegacyDesktopAPI;
};

function markOnce(windowObject: BootstrapWindow, key: BootstrapMarker): boolean {
  if (windowObject[key]) {
    return false;
  }

  windowObject[key] = true;
  return true;
}

function readPositiveRetentionDays(): number {
  const rawValue = Number.parseInt(localStorage.getItem("privacyHistoryRetentionDays") || "30", 10);

  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return 30;
  }

  return Math.min(rawValue, 3650);
}

function readBoundedNumberSetting(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
  allowZero = false
): number {
  const rawValue = Number.parseInt(localStorage.getItem(key) || String(defaultValue), 10);

  if (!Number.isFinite(rawValue)) {
    return defaultValue;
  }

  if (rawValue <= 0) {
    return allowZero ? 0 : defaultValue;
  }

  return Math.min(max, Math.max(min, rawValue));
}

async function syncBackendDictationSettings(): Promise<void> {
  if (!hasTauriRuntime()) return;

  const activationMode = localStorage.getItem("activationMode") || "tap";
  const processingModeId = localStorage.getItem("processingModeId") || "voice-polish";
  const processingModeHotkeys = localStorage.getItem("processingModeHotkeys") || "{}";
  const useReasoningModel = localStorage.getItem("useReasoningModel") !== "false";
  const reasoningProvider = localStorage.getItem("reasoningProvider") || "auto";
  const reasoningModel = localStorage.getItem("reasoningModel") || "";
  const cloudReasoningBaseUrl = localStorage.getItem("cloudReasoningBaseUrl") || "";
  const recordingOverlayVisualStyle =
    localStorage.getItem("recordingOverlayVisualStyle") || "timeline";
  const muteSystemAudioWhileRecording =
    localStorage.getItem("muteSystemAudioWhileRecording") !== "false";
  const privacyApplicationBlacklist = localStorage.getItem("privacyApplicationBlacklist") || "";
  const privacyPauseHistoryInBlacklistedApps =
    localStorage.getItem("privacyPauseHistoryInBlacklistedApps") !== "false";
  const privacyPauseClipboardInBlacklistedApps =
    localStorage.getItem("privacyPauseClipboardInBlacklistedApps") !== "false";
  const privacyAutoDeleteHistoryEnabled =
    localStorage.getItem("privacyAutoDeleteHistoryEnabled") === "true";
  const privacyHistoryRetentionDays = readPositiveRetentionDays();
  const audioQualityProcessingEnabled =
    localStorage.getItem("audioQualityProcessingEnabled") !== "false";
  const audioQualityNoiseGateEnabled =
    localStorage.getItem("audioQualityNoiseGateEnabled") === "true";
  const audioQualityPreRollMs = readBoundedNumberSetting(
    "audioQualityPreRollMs",
    250,
    0,
    2000,
    true
  );
  const recordingMaxDurationSeconds = readBoundedNumberSetting(
    "recordingMaxDurationSeconds",
    300,
    15,
    3600,
    true
  );

  await setSetting("activationMode", activationMode);
  await setSetting("processingModeId", processingModeId);
  await setSetting("processingModeHotkeys", processingModeHotkeys);
  await setSetting("useReasoningModel", useReasoningModel);
  await setSetting("reasoningProvider", reasoningProvider);
  await setSetting("reasoningModel", reasoningModel);
  await setSetting("cloudReasoningBaseUrl", cloudReasoningBaseUrl);
  await setSetting("recordingOverlayVisualStyle", recordingOverlayVisualStyle);
  await setSetting("muteSystemAudioWhileRecording", muteSystemAudioWhileRecording);
  await setSetting("privacyApplicationBlacklist", privacyApplicationBlacklist);
  await setSetting("privacyPauseHistoryInBlacklistedApps", privacyPauseHistoryInBlacklistedApps);
  await setSetting(
    "privacyPauseClipboardInBlacklistedApps",
    privacyPauseClipboardInBlacklistedApps
  );
  await setSetting("privacyAutoDeleteHistoryEnabled", privacyAutoDeleteHistoryEnabled);
  await setSetting("privacyHistoryRetentionDays", privacyHistoryRetentionDays);
  await setSetting("audioQualityProcessingEnabled", audioQualityProcessingEnabled);
  await setSetting("audioQualityNoiseGateEnabled", audioQualityNoiseGateEnabled);
  await setSetting("audioQualityPreRollMs", audioQualityPreRollMs);
  await setSetting("recordingMaxDurationSeconds", recordingMaxDurationSeconds);
  await setSetting("customProcessingModePrompts", readProcessingModePromptOverrides());
  await setSetting("agentName", localStorage.getItem("agentName") || "Agent");
  await setSetting("localAsrRuntime", localStorage.getItem("localAsrRuntime") || "sherpa-onnx");
  await setSetting(
    "localAsrModelFamily",
    localStorage.getItem("localAsrModelFamily") || "sense-voice"
  );
  await setSetting("localAsrModelPath", localStorage.getItem("localAsrModelPath") || "");
  await setSetting("localAsrTokensPath", localStorage.getItem("localAsrTokensPath") || "");
  await setSetting("localAsrEncoderPath", localStorage.getItem("localAsrEncoderPath") || "");
  await setSetting("localAsrDecoderPath", localStorage.getItem("localAsrDecoderPath") || "");
  await setSetting("localAsrJoinerPath", localStorage.getItem("localAsrJoinerPath") || "");
  await setSetting(
    "localAsrConvFrontendPath",
    localStorage.getItem("localAsrConvFrontendPath") || ""
  );
  await setSetting("localAsrTokenizerPath", localStorage.getItem("localAsrTokenizerPath") || "");
  await setSetting("localAsrProjectorPath", localStorage.getItem("localAsrProjectorPath") || "");
  await setSetting("localAsrExecutablePath", localStorage.getItem("localAsrExecutablePath") || "");
  await setSetting("localAsrCommandArgs", localStorage.getItem("localAsrCommandArgs") || "");
  await setSetting(
    "localAsrEndpoint",
    localStorage.getItem("localAsrEndpoint") || "http://127.0.0.1:8080/v1"
  );
  const localAsrNumThreads = Number.parseInt(localStorage.getItem("localAsrNumThreads") || "2", 10);
  await setSetting(
    "localAsrNumThreads",
    Number.isFinite(localAsrNumThreads) ? Math.min(64, Math.max(1, localAsrNumThreads)) : 2
  );

  const isMac = /\bMac\b|\bDarwin\b/i.test(navigator.platform || navigator.userAgent || "");
  if (!isMac) return;

  const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";
  const model = localStorage.getItem("cloudTranscriptionModel") || "";
  const preferredLanguage = localStorage.getItem("preferredLanguage") || "auto";

  await setSetting("cloudTranscriptionProvider", provider);
  await setSetting("cloudTranscriptionModel", model);
  await setSetting("preferredLanguage", preferredLanguage);
  await setSetting("activationMode", activationMode);
}

function initializeRendererLogBridge(): void {
  try {
    const windowObject = window as BootstrapWindow;
    if (!markOnce(windowObject, "__TYPEFREE_LOG_BRIDGE_INIT__")) {
      return;
    }

    void log({
      level: "debug",
      message: "Renderer log bridge initialized",
      meta: { href: window.location.href },
      scope: "logging",
      source: "renderer",
    });
  } catch {
    // ignore
  }
}

function initializeBackendDictationSettingsSync(): void {
  try {
    const windowObject = window as BootstrapWindow;
    if (!markOnce(windowObject, "__TYPEFREE_DICTATION_SETTINGS_SYNC__")) {
      return;
    }

    void (async () => {
      try {
        await syncBackendDictationSettings();
      } catch {
        // ignore
      }
    })();
  } catch {
    // ignore
  }
}

function initializeProcessingModeHotkeySync(): void {
  if (!hasTauriRuntime()) return;

  try {
    const windowObject = window as BootstrapWindow;
    if (!markOnce(windowObject, "__TYPEFREE_PROCESSING_MODE_HOTKEY_SYNC__")) return;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("processing-mode-hotkey-selected", (event) => {
          const mode = typeof event.payload === "string" ? event.payload.trim() : "";
          if (!mode) return;
          localStorage.setItem("processingModeId", mode);
          window.dispatchEvent(
            new StorageEvent("storage", { key: "processingModeId", newValue: mode })
          );
        })
      )
      .catch(() => {
        // ignore
      });
  } catch {
    // ignore
  }
}

export function initializePlatformBootstrap(legacyDesktopAPI: LegacyDesktopAPI): void {
  if (typeof window === "undefined") {
    return;
  }

  (window as BootstrapWindow).tauriAPI = legacyDesktopAPI;
  initializeRendererLogBridge();
  initializeBackendDictationSettingsSync();
  initializeProcessingModeHotkeySync();
}
