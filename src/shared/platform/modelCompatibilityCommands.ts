import { hasTauriRuntime, normalizeCommandError } from "./commandCore";
import type {
  LocalModelRecord,
  LocalModelSelection,
  ModelCommandResult,
  ModelDownloadProgressPayload,
  PlatformUnlisten,
} from "./types";

const unavailable = (feature: string) => `${feature} 仅在 Tauri 桌面运行时可用`;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error(unavailable("原生本地模型"));
  }
  try {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export async function modelGetAll(): Promise<LocalModelRecord[]> {
  if (!hasTauriRuntime()) return [];
  return invoke<LocalModelRecord[]>("model_get_all");
}

export async function modelCheck(modelId: string): Promise<boolean> {
  if (!hasTauriRuntime()) return false;
  return invoke<boolean>("model_check", { modelId });
}

export async function modelDownload(modelId: string): Promise<ModelCommandResult> {
  return invoke<ModelCommandResult>("model_download", { modelId });
}

export async function modelDelete(modelId: string): Promise<void> {
  await invoke<void>("model_delete", { modelId });
}

export async function modelDeleteAll(): Promise<ModelCommandResult> {
  return invoke<ModelCommandResult>("model_delete_all");
}

export async function modelCheckRuntime(): Promise<boolean> {
  if (!hasTauriRuntime()) return false;
  return invoke<boolean>("model_check_runtime");
}

export async function modelCancelDownload(modelId: string): Promise<ModelCommandResult> {
  return invoke<ModelCommandResult>("model_cancel_download", { modelId });
}

export async function modelSelect(modelId: string): Promise<LocalModelSelection> {
  return invoke<LocalModelSelection>("model_select", { modelId });
}

export function onModelDownloadProgress(
  callback: (event: unknown, data: ModelDownloadProgressPayload) => void
): PlatformUnlisten {
  if (!hasTauriRuntime()) return () => {};
  let disposed = false;
  const unlisten = import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<ModelDownloadProgressPayload>("model-download-progress", (event) => {
        if (!disposed) callback(event, event.payload);
      })
    )
    .catch((error) => {
      console.warn("onModelDownloadProgress failed:", normalizeCommandError(error));
      return () => {};
    });
  return () => {
    disposed = true;
    void unlisten.then((dispose) => dispose());
  };
}
