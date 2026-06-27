import { unavailableInTauriBuild } from "./commandCore";
import type { CommandResult, LocalModelRecord, PlatformUnlisten } from "./types";

export async function modelGetAll(): Promise<LocalModelRecord[]> {
  return [];
}

export async function modelCheck(_modelId: string): Promise<boolean> {
  return false;
}

export async function modelDownload(_modelId: string): Promise<CommandResult> {
  return {
    success: false,
    error: unavailableInTauriBuild("Local model downloads"),
  };
}

export async function modelDelete(_modelId: string): Promise<void> {
  throw new Error(unavailableInTauriBuild("Local model deletion"));
}

export async function modelDeleteAll(): Promise<CommandResult> {
  return {
    success: false,
    error: unavailableInTauriBuild("Local model deletion"),
  };
}

export async function modelCheckRuntime(): Promise<boolean> {
  return false;
}

export async function modelCancelDownload(_modelId: string): Promise<CommandResult> {
  return {
    success: false,
    error: unavailableInTauriBuild("Local model downloads"),
  };
}

export function onModelDownloadProgress(
  _callback: (event: any, data: any) => void
): PlatformUnlisten {
  return () => {};
}
