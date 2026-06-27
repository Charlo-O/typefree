import { platform } from "../../shared/platform";
import {
  SETTINGS_SCHEMA,
  SETTINGS_SCHEMA_KEYS,
  getSettingDefinition,
  type AppSettingKey,
  type AppSettingsValueMap,
} from "./schema/settingsSchema";

type StringAppSettingKey = {
  [K in AppSettingKey]: AppSettingsValueMap[K] extends string ? K : never;
}[AppSettingKey];

export const CREDENTIAL_KEYS = {
  openaiApiKey: "OPENAI_API_KEY",
  assemblyaiApiKey: "ASSEMBLYAI_API_KEY",
  anthropicApiKey: "ANTHROPIC_API_KEY",
  geminiApiKey: "GEMINI_API_KEY",
  groqApiKey: "GROQ_API_KEY",
  deepseekApiKey: "DEEPSEEK_API_KEY",
  zaiApiKey: "ZAI_API_KEY",
  volcengineAppId: "VOLCENGINE_APP_ID",
  volcengineAccessToken: "VOLCENGINE_ACCESS_TOKEN",
  customReasoningApiKey: "CUSTOM_REASONING_API_KEY",
  customTranscriptionApiKey: "CUSTOM_TRANSCRIPTION_API_KEY",
} as const satisfies Partial<Record<StringAppSettingKey, string>>;

export type CredentialSettingKey = keyof typeof CREDENTIAL_KEYS;
export type CredentialStorageKey = (typeof CREDENTIAL_KEYS)[keyof typeof CREDENTIAL_KEYS];

function credentialEntries(): Array<[CredentialSettingKey, CredentialStorageKey]> {
  const entries: Array<[CredentialSettingKey, CredentialStorageKey]> = [];

  for (const key of SETTINGS_SCHEMA_KEYS) {
    if (!SETTINGS_SCHEMA[key].sensitive) continue;

    const credentialKey = CREDENTIAL_KEYS[key as CredentialSettingKey];
    if (!credentialKey) {
      throw new Error(`Missing credential store key for sensitive setting ${key}`);
    }

    entries.push([key as CredentialSettingKey, credentialKey]);
  }

  return entries;
}

function isTauriRuntime(): boolean {
  try {
    return platform.runtime.isTauri();
  } catch {
    return false;
  }
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}

export function readLegacyCredentialMirror(key: CredentialSettingKey): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const definition = getSettingDefinition(key);
    const rawValue = storage.getItem(definition.storageKey);
    if (rawValue === null) return null;
    const value = definition.deserialize(rawValue);
    return typeof value === "string" ? value.trim() : null;
  } catch {
    return null;
  }
}

export function clearLegacyCredentialMirror(key: CredentialSettingKey): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    const definition = getSettingDefinition(key);
    storage.removeItem(definition.storageKey);
  } catch {
    // ignore cleanup failures
  }
}

async function readCredential(key: CredentialStorageKey): Promise<string | null> {
  return platform.secrets.get(key).catch(() => null);
}

async function persistCredential(key: CredentialStorageKey, value: string): Promise<void> {
  await platform.secrets.set(key, value);
}

export function persistCredentialInBackground(
  settingKey: CredentialSettingKey,
  value: string
): void {
  const credentialKey = CREDENTIAL_KEYS[settingKey];
  void persistCredential(credentialKey, value)
    .then(() => {
      if (isTauriRuntime()) {
        clearLegacyCredentialMirror(settingKey);
      }
    })
    .catch((error) => {
      console.error(`Failed to persist credential ${credentialKey}:`, error);
    });
}

export async function hydrateCredentialSetting(
  settingKey: CredentialSettingKey,
  setValue: (value: string) => void
): Promise<void> {
  const credentialKey = CREDENTIAL_KEYS[settingKey];
  const legacyValue = readLegacyCredentialMirror(settingKey);
  const storedValue = await readCredential(credentialKey);

  if (storedValue) {
    setValue(storedValue);
    if (isTauriRuntime()) {
      clearLegacyCredentialMirror(settingKey);
    }
    return;
  }

  if (!legacyValue) {
    if (legacyValue !== null && isTauriRuntime()) {
      clearLegacyCredentialMirror(settingKey);
    }
    return;
  }

  setValue(legacyValue);
  if (isTauriRuntime()) {
    await persistCredential(credentialKey, legacyValue);
    clearLegacyCredentialMirror(settingKey);
  }
}

export async function migrateLegacyCredentialMirrorsToCredentialStore(): Promise<void> {
  if (!isTauriRuntime()) return;

  for (const [settingKey, credentialKey] of credentialEntries()) {
    try {
      const legacyValue = readLegacyCredentialMirror(settingKey);
      const storedValue = await readCredential(credentialKey);

      if (storedValue) {
        clearLegacyCredentialMirror(settingKey);
        continue;
      }

      if (!legacyValue) {
        if (legacyValue !== null) {
          clearLegacyCredentialMirror(settingKey);
        }
        continue;
      }

      await persistCredential(credentialKey, legacyValue);
      clearLegacyCredentialMirror(settingKey);
    } catch (error) {
      console.error(`Failed to migrate credential ${credentialKey}:`, error);
    }
  }
}
