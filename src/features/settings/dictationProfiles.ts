import type { ProcessingModeId } from "../../config/processingModes";
import type { ActivationMode, DictationTriggerMode } from "./schema/settingsSchema";

export const DICTATION_PROFILES_STORAGE_KEY = "dictation.profiles";
export const MAX_DICTATION_PROFILES = 12;

const PROCESSING_MODE_IDS = new Set<ProcessingModeId>([
  "direct",
  "voice-polish",
  "command",
  "translate-en",
  "prompt-optimize",
]);
const DEFAULT_PROFILE_PROCESSING_MODE_ID: ProcessingModeId = "voice-polish";
const DICTATION_TRIGGER_MODES = new Set<DictationTriggerMode>(["single", "double"]);
const ACTIVATION_MODES = new Set<ActivationMode>(["tap", "push"]);

export interface DictationProfileSettings {
  preferredLanguage: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl: string;
  processingModeId: ProcessingModeId;
  useReasoningModel: boolean;
  reasoningModel: string;
  cloudReasoningBaseUrl: string;
  dictationKey: string;
  dictationTriggerMode: DictationTriggerMode;
  activationMode: ActivationMode;
  promptVersionId: string | null;
  customPromptRaw: string | null;
  vocabularyProfileId: string | null;
}

export interface DictationProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: DictationProfileSettings;
}

export interface SaveDictationProfileInput {
  id?: string | null;
  name: string;
  settings: Partial<DictationProfileSettings>;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function createId(name: string, existingIds: Set<string>): string {
  const base =
    cleanText(name)
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "profile";

  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  return id;
}

function normalizeProcessingMode(value: unknown): ProcessingModeId {
  return PROCESSING_MODE_IDS.has(value as ProcessingModeId)
    ? (value as ProcessingModeId)
    : DEFAULT_PROFILE_PROCESSING_MODE_ID;
}

function normalizeDictationTriggerMode(value: unknown): DictationTriggerMode {
  return DICTATION_TRIGGER_MODES.has(value as DictationTriggerMode)
    ? (value as DictationTriggerMode)
    : "single";
}

function normalizeActivationMode(value: unknown): ActivationMode {
  return ACTIVATION_MODES.has(value as ActivationMode) ? (value as ActivationMode) : "tap";
}

function normalizeNullableString(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

function normalizeSettings(
  value: Partial<DictationProfileSettings>,
  fallbackProfileId: string
): DictationProfileSettings {
  return {
    preferredLanguage: cleanText(value.preferredLanguage) || "en",
    cloudTranscriptionProvider: cleanText(value.cloudTranscriptionProvider) || "openai",
    cloudTranscriptionModel: cleanText(value.cloudTranscriptionModel) || "gpt-4o-mini-transcribe",
    cloudTranscriptionBaseUrl: cleanText(value.cloudTranscriptionBaseUrl),
    processingModeId: normalizeProcessingMode(value.processingModeId),
    useReasoningModel: value.useReasoningModel !== false,
    reasoningModel: cleanText(value.reasoningModel),
    cloudReasoningBaseUrl: cleanText(value.cloudReasoningBaseUrl),
    dictationKey: cleanText(value.dictationKey),
    dictationTriggerMode: normalizeDictationTriggerMode(value.dictationTriggerMode),
    activationMode: normalizeActivationMode(value.activationMode),
    promptVersionId: normalizeNullableString(value.promptVersionId),
    customPromptRaw: typeof value.customPromptRaw === "string" ? value.customPromptRaw : null,
    vocabularyProfileId: normalizeNullableString(value.vocabularyProfileId) || fallbackProfileId,
  };
}

function isDictationProfile(value: unknown): value is DictationProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DictationProfile>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    !!candidate.settings &&
    typeof candidate.settings === "object"
  );
}

export function readDictationProfiles(storage?: Storage | null): DictationProfile[] {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return [];

  try {
    const raw = resolvedStorage.getItem(DICTATION_PROFILES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isDictationProfile)
      .map((profile) => ({
        ...profile,
        settings: normalizeSettings(profile.settings, profile.id),
      }))
      .slice(0, MAX_DICTATION_PROFILES);
  } catch {
    return [];
  }
}

export function writeDictationProfiles(
  profiles: DictationProfile[],
  storage?: Storage | null
): DictationProfile[] {
  const resolvedStorage = resolveStorage(storage);
  const normalized = profiles
    .filter(isDictationProfile)
    .map((profile) => ({
      ...profile,
      name: cleanText(profile.name) || profile.id,
      settings: normalizeSettings(profile.settings, profile.id),
    }))
    .slice(0, MAX_DICTATION_PROFILES);

  if (resolvedStorage) {
    resolvedStorage.setItem(DICTATION_PROFILES_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function saveDictationProfile(
  input: SaveDictationProfileInput,
  options: { storage?: Storage | null } = {}
): { profile: DictationProfile; profiles: DictationProfile[] } {
  const existingProfiles = readDictationProfiles(options.storage);
  const existingIds = new Set(existingProfiles.map((profile) => profile.id));
  const id = cleanText(input.id) || createId(input.name, existingIds);
  const existing = existingProfiles.find((profile) => profile.id === id);
  const now = new Date().toISOString();
  const profile: DictationProfile = {
    id,
    name: cleanText(input.name) || existing?.name || id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    settings: normalizeSettings(input.settings, id),
  };

  const profiles = writeDictationProfiles(
    [profile, ...existingProfiles.filter((candidate) => candidate.id !== id)],
    options.storage
  );

  return { profile, profiles };
}

export function deleteDictationProfile(
  profileId: string,
  storage?: Storage | null
): DictationProfile[] {
  const id = cleanText(profileId);
  if (!id) return readDictationProfiles(storage);

  return writeDictationProfiles(
    readDictationProfiles(storage).filter((profile) => profile.id !== id),
    storage
  );
}
