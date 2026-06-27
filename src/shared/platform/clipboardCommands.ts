import { hasTauriRuntime, normalizeCommandError } from "./commandCore";
import type { ClipboardUpdatePayload, PasteToolsResult } from "./types";

export function resolveFileAssetSrc(source: string): string {
  try {
    const convertFileSrc = (window as any).__TAURI_INTERNALS__?.convertFileSrc;
    return typeof convertFileSrc === "function" ? convertFileSrc(source, "asset") : source;
  } catch {
    return source;
  }
}

export async function pasteText(text: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("paste_text", { text });
  } catch (error) {
    console.warn("pasteText failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function pasteImage(imageSource: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("paste_image", { dataUrl: imageSource });
  } catch (error) {
    console.warn("pasteImage failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function readClipboard(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("read_clipboard");
  } catch (error) {
    console.warn("readClipboard failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function writeClipboard(text: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("write_clipboard", { text });
  } catch (error) {
    console.warn("writeClipboard failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function writeClipboardImage(imageSource: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("write_clipboard_image", { dataUrl: imageSource });
  } catch (error) {
    console.warn("writeClipboardImage failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function storeClipboardImage(
  imageSource: string,
  id?: string,
  tsMs?: number
): Promise<ClipboardUpdatePayload | null> {
  if (!hasTauriRuntime()) {
    return null;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("store_clipboard_image", { imageSource, id, tsMs });
  } catch (error) {
    console.warn("storeClipboardImage failed:", error);
    throw normalizeCommandError(error);
  }
}

export async function deleteClipboardImageFiles(paths: string[]): Promise<number> {
  if (!hasTauriRuntime() || paths.length === 0) {
    return 0;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("delete_clipboard_image_files", { paths });
  } catch (error) {
    console.warn("deleteClipboardImageFiles failed:", error);
    return 0;
  }
}

export async function checkPasteTools(): Promise<PasteToolsResult | null> {
  if (!hasTauriRuntime()) {
    return null;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("check_paste_tools");
  } catch (error) {
    console.warn("checkPasteTools failed:", error);
    return null;
  }
}

export async function checkAccessibilityPermission(prompt = false): Promise<boolean> {
  if (!hasTauriRuntime()) {
    return false;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("check_accessibility_permission", { prompt });
  } catch (error) {
    console.warn("checkAccessibilityPermission failed:", error);
    throw normalizeCommandError(error);
  }
}
