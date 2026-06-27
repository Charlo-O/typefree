import {
  getErrorMessage,
  hasTauriRuntime,
  normalizeCommandError,
  type CommandResult,
  type DebugLoggingResult,
  type DebugState,
} from "./commandCore";
import type { CredentialStatus, RendererLogPayload } from "./types";

export async function getSetting<T>(key: string): Promise<T | null> {
  if (!hasTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_setting", { key });
  } catch (error) {
    console.warn("getSetting failed:", normalizeCommandError(error));
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_setting", { key, value });
  } catch (error) {
    console.warn("setSetting failed:", normalizeCommandError(error));
  }
}

export async function getCredential(key: string): Promise<string | null> {
  if (!hasTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_credential", { key });
  } catch (error) {
    console.warn("getCredential failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function getCredentialStatus(key: string): Promise<CredentialStatus> {
  if (!hasTauriRuntime()) {
    return { key, present: false };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_credential_status", { key });
  } catch (error) {
    console.warn("getCredentialStatus failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function setCredential(key: string, value: string): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_credential", { key, value });
  } catch (error) {
    console.warn("setCredential failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function deleteCredential(key: string): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("delete_credential", { key });
  } catch (error) {
    console.warn("deleteCredential failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function getEnvVar(key: string): Promise<string | null> {
  return getCredential(key);
}

export async function setEnvVar(key: string, value: string): Promise<void> {
  return setCredential(key, value);
}

export async function log(payload: RendererLogPayload): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_renderer_log", {
      entry: {
        ...payload,
        message: String(payload.message),
        source: payload.source || "renderer",
      },
    });
  } catch (error) {
    console.warn("write renderer log failed:", normalizeCommandError(error));
    // Renderer logging is best-effort; keep a console fallback when the
    // backend log file cannot be written.
    console.log(
      `[${payload.level?.toUpperCase?.() || "INFO"}]${payload.scope ? `[${payload.scope}]` : ""} ${payload.message}`,
      payload.meta
    );
  }
}

export async function getLogLevel(): Promise<string> {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("logLevel") || "";
      if (stored.trim()) return stored.trim();
    }
  } catch {
    // ignore
  }

  try {
    const stored = await getSetting<string>("logLevel");
    if (typeof stored === "string" && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // ignore
  }

  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env?.DEV) {
      return "debug";
    }
  } catch {
    // ignore
  }
  return "info";
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_all_settings");
  } catch (error) {
    console.warn("getAllSettings failed:", normalizeCommandError(error));
    return {};
  }
}

export async function getDebugState(): Promise<DebugState> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const state = (await invoke("get_debug_state")) as DebugState;
    return {
      enabled: Boolean(state.enabled),
      logPath: state.logPath ?? null,
      logLevel: state.logLevel || "info",
    };
  } catch (error) {
    console.warn("getDebugState failed:", normalizeCommandError(error));
    const level = await getLogLevel();
    return { enabled: level === "debug" || level === "trace", logPath: null, logLevel: level };
  }
}

export async function setDebugLogging(enabled: boolean): Promise<DebugLoggingResult> {
  const logLevel = enabled ? "debug" : "info";

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("logLevel", logLevel);
    }
  } catch {
    // ignore localStorage failures
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = (await invoke("set_debug_logging", { enabled })) as DebugLoggingResult;
    return {
      success: result.success !== false,
      enabled: result.enabled ?? enabled,
      logPath: result.logPath ?? null,
      error: result.error,
    };
  } catch (error) {
    const normalized = normalizeCommandError(error);
    console.warn("setDebugLogging failed:", normalized);
    await setSetting("logLevel", logLevel);
    return { success: false, enabled, logPath: null, error: normalized.message };
  }
}

export async function openLogsFolder(): Promise<CommandResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_logs_folder");
    return { success: true };
  } catch (error) {
    console.warn("openLogsFolder failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getOpenAIKey(): Promise<string | null> {
  return getEnvVar("OPENAI_API_KEY");
}

export async function saveOpenAIKey(key: string): Promise<void> {
  return setEnvVar("OPENAI_API_KEY", key);
}

export async function getAssemblyAIKey(): Promise<string | null> {
  return getEnvVar("ASSEMBLYAI_API_KEY");
}

export async function saveAssemblyAIKey(key: string): Promise<void> {
  return setEnvVar("ASSEMBLYAI_API_KEY", key);
}

export async function getAnthropicKey(): Promise<string | null> {
  return getEnvVar("ANTHROPIC_API_KEY");
}

export async function saveAnthropicKey(key: string): Promise<void> {
  return setEnvVar("ANTHROPIC_API_KEY", key);
}

export async function getGeminiKey(): Promise<string | null> {
  return getEnvVar("GEMINI_API_KEY");
}

export async function saveGeminiKey(key: string): Promise<void> {
  return setEnvVar("GEMINI_API_KEY", key);
}

export async function getGroqKey(): Promise<string | null> {
  return getEnvVar("GROQ_API_KEY");
}

export async function saveGroqKey(key: string): Promise<void> {
  return setEnvVar("GROQ_API_KEY", key);
}

export async function getZaiKey(): Promise<string | null> {
  return getEnvVar("ZAI_API_KEY");
}

export async function saveZaiKey(key: string): Promise<void> {
  return setEnvVar("ZAI_API_KEY", key);
}

export async function getVolcengineAppId(): Promise<string | null> {
  return getEnvVar("VOLCENGINE_APP_ID");
}

export async function saveVolcengineAppId(value: string): Promise<void> {
  return setEnvVar("VOLCENGINE_APP_ID", value);
}

export async function getVolcengineAccessToken(): Promise<string | null> {
  return getEnvVar("VOLCENGINE_ACCESS_TOKEN");
}

export async function saveVolcengineAccessToken(value: string): Promise<void> {
  return setEnvVar("VOLCENGINE_ACCESS_TOKEN", value);
}

/**
 * @deprecated The Volcengine protocol resource id is backend-owned and is no
 * longer a user-editable credential. This shim keeps older callers from
 * failing while avoiding persistence of a stale user setting.
 */
export async function getVolcengineResourceId(): Promise<string | null> {
  return null;
}

/**
 * @deprecated The Volcengine protocol resource id is backend-owned and is no
 * longer a user-editable credential. This shim intentionally ignores writes.
 */
export async function saveVolcengineResourceId(value: string): Promise<void> {
  void value;
}

export async function saveAllKeysToEnv(): Promise<CommandResult> {
  return {
    success: true,
    message: "Credentials are stored individually in the platform credential store.",
  };
}
