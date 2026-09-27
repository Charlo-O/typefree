import { API_ENDPOINTS } from "../../../config/constants";
import {
  DEFAULT_PROCESSING_MODE_ID,
  PROCESSING_MODE_STORAGE_KEY,
  type ProcessingModeId,
} from "../../../config/processingModes";

export type DictationTriggerMode = "single" | "double";
export type ActivationMode = "tap" | "push";
export type RecordingOverlayVisualStyle = "classic" | "dual" | "timeline";
export type LocalAsrRuntimeId =
  | "sherpa-onnx"
  | "llama.cpp"
  | "external-command"
  | "openai-compatible";
export type LocalAsrModelFamily =
  | "sense-voice"
  | "paraformer"
  | "whisper"
  | "qwen3-asr"
  | "r2t2"
  | "custom";

export interface AppSettingsValueMap {
  preferredLanguage: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl: string;
  localAsrRuntime: LocalAsrRuntimeId;
  localAsrModelFamily: LocalAsrModelFamily;
  localAsrModelPath: string;
  localAsrTokensPath: string;
  localAsrEncoderPath: string;
  localAsrDecoderPath: string;
  localAsrJoinerPath: string;
  localAsrConvFrontendPath: string;
  localAsrTokenizerPath: string;
  localAsrProjectorPath: string;
  localAsrExecutablePath: string;
  localAsrCommandArgs: string;
  localAsrEndpoint: string;
  localAsrNumThreads: number;
  cloudReasoningBaseUrl: string;
  processingModeId: ProcessingModeId;
  processingModeHotkeys: string;
  useReasoningModel: boolean;
  reasoningModel: string;
  reasoningProvider: string;
  recordingOverlayVisualStyle: RecordingOverlayVisualStyle;
  muteSystemAudioWhileRecording: boolean;
  audioQualityProcessingEnabled: boolean;
  audioQualityNoiseGateEnabled: boolean;
  audioQualityPreRollMs: number;
  recordingMaxDurationSeconds: number;
  openaiApiKey: string;
  assemblyaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  deepseekApiKey: string;
  zaiApiKey: string;
  volcengineAppId: string;
  volcengineAccessToken: string;
  customReasoningApiKey: string;
  customTranscriptionApiKey: string;
  dictationKey: string;
  dictationTriggerMode: DictationTriggerMode;
  clipboardHotkey: string;
  activationMode: ActivationMode;
  launchAtStartup: boolean;
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
  privacyApplicationBlacklist: string;
  privacyPauseHistoryInBlacklistedApps: boolean;
  privacyPauseClipboardInBlacklistedApps: boolean;
  privacyAutoDeleteHistoryEnabled: boolean;
  privacyHistoryRetentionDays: number;
}

export type AppSettingKey = keyof AppSettingsValueMap;

export interface AppSettingDefinition<T> {
  storageKey: string;
  defaultValue: T;
  syncToBackend?: boolean;
  backendKey?: string;
  sensitive?: boolean;
  serialize: (value: T) => string;
  deserialize: (value: string) => T;
  normalize?: (value: T) => T;
  searchTerms?: string[];
}

type AppSettingDefinitions = {
  [K in AppSettingKey]: AppSettingDefinition<AppSettingsValueMap[K]>;
};

type AppSettingOptions<T> = Pick<
  AppSettingDefinition<T>,
  "backendKey" | "sensitive" | "syncToBackend" | "searchTerms"
>;

const stringSetting = (
  storageKey: string,
  defaultValue = "",
  options: AppSettingOptions<string> = {}
): AppSettingDefinition<string> => ({
  storageKey,
  defaultValue,
  serialize: String,
  deserialize: String,
  ...options,
});

const booleanSetting = (
  storageKey: string,
  defaultValue: boolean,
  options: AppSettingOptions<boolean> = {}
): AppSettingDefinition<boolean> => ({
  storageKey,
  defaultValue,
  serialize: String,
  deserialize: (value) => (defaultValue ? value !== "false" : value === "true"),
  ...options,
});

const numberSetting = (
  storageKey: string,
  defaultValue: number,
  options: AppSettingOptions<number> & {
    min?: number;
    max?: number;
    allowZero?: boolean;
    searchTerms?: string[];
  } = {}
): AppSettingDefinition<number> => ({
  storageKey,
  defaultValue,
  serialize: String,
  deserialize: (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return defaultValue;
    if (parsed <= 0) return options.allowZero ? 0 : defaultValue;
    const rounded = Math.round(parsed);
    const min = options.min ?? Number.NEGATIVE_INFINITY;
    const max = options.max ?? Number.POSITIVE_INFINITY;
    return Math.min(max, Math.max(min, rounded));
  },
  normalize: (value) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return defaultValue;
    if (parsed <= 0) return options.allowZero ? 0 : defaultValue;
    const rounded = Math.round(parsed);
    const min = options.min ?? Number.NEGATIVE_INFINITY;
    const max = options.max ?? Number.POSITIVE_INFINITY;
    return Math.min(max, Math.max(min, rounded));
  },
  ...options,
});

const enumSetting = <T extends string>(
  storageKey: string,
  defaultValue: T,
  values: readonly T[],
  options: AppSettingOptions<T> = {}
): AppSettingDefinition<T> => ({
  storageKey,
  defaultValue,
  serialize: String,
  deserialize: (value) => (values.includes(value as T) ? (value as T) : defaultValue),
  ...options,
});

export const SETTINGS_SCHEMA = {
  preferredLanguage: stringSetting("preferredLanguage", "en", { syncToBackend: true }),
  cloudTranscriptionProvider: stringSetting("cloudTranscriptionProvider", "openai", {
    syncToBackend: true,
  }),
  cloudTranscriptionModel: stringSetting("cloudTranscriptionModel", "gpt-4o-mini-transcribe", {
    syncToBackend: true,
  }),
  cloudTranscriptionBaseUrl: stringSetting(
    "cloudTranscriptionBaseUrl",
    API_ENDPOINTS.TRANSCRIPTION_BASE,
    { syncToBackend: true }
  ),
  localAsrRuntime: enumSetting(
    "localAsrRuntime",
    "sherpa-onnx",
    ["sherpa-onnx", "llama.cpp", "external-command", "openai-compatible"],
    { syncToBackend: true, searchTerms: ["local", "asr", "runtime", "offline"] }
  ),
  localAsrModelFamily: enumSetting(
    "localAsrModelFamily",
    "sense-voice",
    ["sense-voice", "paraformer", "whisper", "qwen3-asr", "r2t2", "custom"],
    { syncToBackend: true, searchTerms: ["local", "asr", "model", "family"] }
  ),
  localAsrModelPath: stringSetting("localAsrModelPath", "", {
    syncToBackend: true,
    searchTerms: ["local", "asr", "model", "path", "onnx"],
  }),
  localAsrTokensPath: stringSetting("localAsrTokensPath", "", {
    syncToBackend: true,
    searchTerms: ["local", "asr", "tokens"],
  }),
  localAsrEncoderPath: stringSetting("localAsrEncoderPath", "", { syncToBackend: true }),
  localAsrDecoderPath: stringSetting("localAsrDecoderPath", "", { syncToBackend: true }),
  localAsrJoinerPath: stringSetting("localAsrJoinerPath", "", { syncToBackend: true }),
  localAsrConvFrontendPath: stringSetting("localAsrConvFrontendPath", "", {
    syncToBackend: true,
  }),
  localAsrTokenizerPath: stringSetting("localAsrTokenizerPath", "", { syncToBackend: true }),
  localAsrProjectorPath: stringSetting("localAsrProjectorPath", "", { syncToBackend: true }),
  localAsrExecutablePath: stringSetting("localAsrExecutablePath", "", {
    syncToBackend: true,
    searchTerms: ["local", "asr", "executable", "command", "whisper", "r2t2"],
  }),
  localAsrCommandArgs: stringSetting("localAsrCommandArgs", "", { syncToBackend: true }),
  localAsrEndpoint: stringSetting("localAsrEndpoint", "http://127.0.0.1:8080/v1", {
    syncToBackend: true,
    searchTerms: ["local", "asr", "endpoint", "openai", "server"],
  }),
  localAsrNumThreads: numberSetting("localAsrNumThreads", 2, {
    syncToBackend: true,
    min: 1,
    max: 64,
    searchTerms: ["local", "asr", "threads", "cpu"],
  }),
  cloudReasoningBaseUrl: stringSetting("cloudReasoningBaseUrl", API_ENDPOINTS.OPENAI_BASE, {
    syncToBackend: true,
  }),
  processingModeId: enumSetting<ProcessingModeId>(
    PROCESSING_MODE_STORAGE_KEY,
    DEFAULT_PROCESSING_MODE_ID,
    ["direct", "voice-polish", "command", "translate-en", "prompt-optimize"],
    { syncToBackend: true }
  ),
  processingModeHotkeys: stringSetting("processingModeHotkeys", "{}", {
    syncToBackend: true,
    searchTerms: ["processing", "mode", "hotkey", "shortcut"],
  }),
  useReasoningModel: booleanSetting("useReasoningModel", true, { syncToBackend: true }),
  reasoningModel: stringSetting("reasoningModel", "", { syncToBackend: true }),
  reasoningProvider: stringSetting("reasoningProvider", "auto", { syncToBackend: true }),
  recordingOverlayVisualStyle: enumSetting<RecordingOverlayVisualStyle>(
    "recordingOverlayVisualStyle",
    "timeline",
    ["classic", "dual", "timeline"],
    { syncToBackend: true }
  ),
  muteSystemAudioWhileRecording: booleanSetting("muteSystemAudioWhileRecording", true, {
    syncToBackend: true,
  }),
  audioQualityProcessingEnabled: booleanSetting("audioQualityProcessingEnabled", true, {
    syncToBackend: true,
    searchTerms: ["audio", "quality", "noise", "preprocessing"],
  }),
  audioQualityNoiseGateEnabled: booleanSetting("audioQualityNoiseGateEnabled", false, {
    syncToBackend: true,
    searchTerms: ["audio", "noise", "gate", "silence"],
  }),
  audioQualityPreRollMs: numberSetting("audioQualityPreRollMs", 250, {
    syncToBackend: true,
    min: 0,
    max: 2000,
    allowZero: true,
    searchTerms: ["audio", "pre-roll", "preroll", "leading", "start"],
  }),
  recordingMaxDurationSeconds: numberSetting("recordingMaxDurationSeconds", 300, {
    syncToBackend: true,
    min: 15,
    max: 3600,
    allowZero: true,
    searchTerms: ["recording", "duration", "limit", "timeout"],
  }),
  openaiApiKey: stringSetting("openaiApiKey", "", { sensitive: true }),
  assemblyaiApiKey: stringSetting("assemblyaiApiKey", "", { sensitive: true }),
  anthropicApiKey: stringSetting("anthropicApiKey", "", { sensitive: true }),
  geminiApiKey: stringSetting("geminiApiKey", "", { sensitive: true }),
  groqApiKey: stringSetting("groqApiKey", "", { sensitive: true }),
  deepseekApiKey: stringSetting("deepseekApiKey", "", { sensitive: true }),
  zaiApiKey: stringSetting("zaiApiKey", "", { sensitive: true }),
  volcengineAppId: stringSetting("volcengineAppId", "", { sensitive: true }),
  volcengineAccessToken: stringSetting("volcengineAccessToken", "", { sensitive: true }),
  customReasoningApiKey: stringSetting("customReasoningApiKey", "", { sensitive: true }),
  customTranscriptionApiKey: stringSetting("customTranscriptionApiKey", "", { sensitive: true }),
  dictationKey: stringSetting("dictationKey"),
  dictationTriggerMode: enumSetting<DictationTriggerMode>(
    "dictationTriggerMode",
    "single",
    ["single", "double"],
    { syncToBackend: true }
  ),
  clipboardHotkey: stringSetting("clipboardHotkey"),
  activationMode: enumSetting<ActivationMode>("activationMode", "tap", ["tap", "push"], {
    syncToBackend: true,
  }),
  launchAtStartup: booleanSetting("launchAtStartup", false),
  preferBuiltInMic: booleanSetting("preferBuiltInMic", true),
  selectedMicDeviceId: stringSetting("selectedMicDeviceId"),
  privacyApplicationBlacklist: stringSetting("privacyApplicationBlacklist", "", {
    syncToBackend: true,
  }),
  privacyPauseHistoryInBlacklistedApps: booleanSetting(
    "privacyPauseHistoryInBlacklistedApps",
    true,
    { syncToBackend: true }
  ),
  privacyPauseClipboardInBlacklistedApps: booleanSetting(
    "privacyPauseClipboardInBlacklistedApps",
    true,
    { syncToBackend: true }
  ),
  privacyAutoDeleteHistoryEnabled: booleanSetting("privacyAutoDeleteHistoryEnabled", false, {
    syncToBackend: true,
  }),
  privacyHistoryRetentionDays: numberSetting("privacyHistoryRetentionDays", 30, {
    syncToBackend: true,
    min: 1,
    max: 3650,
    searchTerms: ["privacy", "history", "retention", "auto delete"],
  }),
} satisfies AppSettingDefinitions;

export const SETTINGS_SCHEMA_KEYS = Object.keys(SETTINGS_SCHEMA) as AppSettingKey[];

type AppSettingsPrimitive = string | boolean | number;

export interface AppSettingsExportPayload {
  app: "TypeFree";
  kind: "settings-export";
  version: 1;
  exportedAt: string;
  settings: Partial<Record<AppSettingKey, AppSettingsPrimitive>>;
  skippedSensitiveKeys: AppSettingKey[];
}

export interface AppSettingsImportResult {
  applied: number;
  skipped: number;
  invalid: number;
  appliedKeys: AppSettingKey[];
}

export function getSettingDefinition<K extends AppSettingKey>(
  key: K
): AppSettingDefinition<AppSettingsValueMap[K]> {
  return SETTINGS_SCHEMA[key] as AppSettingDefinition<AppSettingsValueMap[K]>;
}

export function getBackendSettingKey(key: AppSettingKey): string {
  const definition = getSettingDefinition(key);
  return definition.backendKey ?? definition.storageKey;
}

export function shouldSyncSettingToBackend(key: AppSettingKey): boolean {
  return getSettingDefinition(key).syncToBackend === true;
}

export function isAppSettingKey(key: string): key is AppSettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, key);
}

export function normalizeAppSettingValue<K extends AppSettingKey>(
  key: K,
  value: unknown
): AppSettingsValueMap[K] {
  const definition = getSettingDefinition(key);
  const deserialized =
    typeof value === "string"
      ? definition.deserialize(value)
      : definition.deserialize(definition.serialize(value as AppSettingsValueMap[K]));
  return definition.normalize
    ? definition.normalize(deserialized as AppSettingsValueMap[K])
    : (deserialized as AppSettingsValueMap[K]);
}

export function searchSettingsSchema(query: string): AppSettingKey[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return SETTINGS_SCHEMA_KEYS.filter((key) => {
    const definition = SETTINGS_SCHEMA[key];
    const haystack = [
      key,
      definition.storageKey,
      definition.backendKey,
      ...(definition.searchTerms || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

export function readStoredAppSetting<K extends AppSettingKey>(
  key: K,
  storage?: Storage | null
): AppSettingsValueMap[K] | null {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return null;

  const definition = getSettingDefinition(key);
  if (definition.sensitive) return null;

  const storedValue = resolvedStorage.getItem(definition.storageKey);
  if (storedValue === null) return null;

  try {
    return normalizeAppSettingValue(key, storedValue);
  } catch {
    return definition.defaultValue;
  }
}

export function readAppSetting<K extends AppSettingKey>(
  key: K,
  storage?: Storage | null
): AppSettingsValueMap[K] {
  return readStoredAppSetting(key, storage) ?? getSettingDefinition(key).defaultValue;
}

export function writeAppSetting<K extends AppSettingKey>(
  key: K,
  value: AppSettingsValueMap[K],
  storage?: Storage | null
): boolean {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return false;

  try {
    const definition = getSettingDefinition(key);
    if (definition.sensitive) return false;

    const normalizedValue = normalizeAppSettingValue(key, value);
    resolvedStorage.setItem(definition.storageKey, definition.serialize(normalizedValue));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAppSettingsExportPayload(storage?: Storage | null): AppSettingsExportPayload {
  const settings: Partial<Record<AppSettingKey, AppSettingsPrimitive>> = {};
  const skippedSensitiveKeys: AppSettingKey[] = [];

  for (const key of SETTINGS_SCHEMA_KEYS) {
    const definition = SETTINGS_SCHEMA[key];
    if (definition.sensitive) {
      skippedSensitiveKeys.push(key);
      continue;
    }

    settings[key] = readAppSetting(key, storage) as AppSettingsPrimitive;
  }

  return {
    app: "TypeFree",
    kind: "settings-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    skippedSensitiveKeys,
  };
}

export function importAppSettingsExportPayload(
  payload: unknown,
  options: { storage?: Storage | null } = {}
): AppSettingsImportResult {
  const result: AppSettingsImportResult = {
    applied: 0,
    skipped: 0,
    invalid: 0,
    appliedKeys: [],
  };

  if (!isRecord(payload) || !isRecord(payload.settings)) {
    result.invalid += 1;
    return result;
  }

  for (const [rawKey, rawValue] of Object.entries(payload.settings)) {
    if (!isAppSettingKey(rawKey)) {
      result.skipped += 1;
      continue;
    }

    const definition = SETTINGS_SCHEMA[rawKey];
    if (definition.sensitive) {
      result.skipped += 1;
      continue;
    }

    if (
      typeof rawValue !== "string" &&
      typeof rawValue !== "boolean" &&
      typeof rawValue !== "number"
    ) {
      result.invalid += 1;
      continue;
    }

    try {
      const normalizedValue = normalizeAppSettingValue(rawKey, rawValue);
      if (writeAppSetting(rawKey, normalizedValue as never, options.storage)) {
        result.applied += 1;
        result.appliedKeys.push(rawKey);
      } else {
        result.invalid += 1;
      }
    } catch {
      result.invalid += 1;
    }
  }

  return result;
}
