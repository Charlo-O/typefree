import { resolveFileAssetSrc } from "../../shared/platform/clipboardCommands";
import type {
  ClipboardHistoryItem,
  ClipboardImageMetadata,
  ClipboardItemType,
  ClipboardUpdatePayload,
} from "../../types/clipboard";

export const CLIPBOARD_STORAGE_KEYS = {
  enabled: "clipboard.enabled",
  maxItems: "clipboard.maxItems",
  history: "clipboard.history",
  favorites: "clipboard.favorites",
} as const;

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function cleanNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMetadata(payload: ClipboardUpdatePayload): ClipboardImageMetadata | undefined {
  const raw = isRecord(payload.metadata) ? payload.metadata : {};
  const metadata: ClipboardImageMetadata = {
    width: cleanNumber(raw.width ?? payload?.width),
    height: cleanNumber(raw.height ?? payload?.height),
    byteSize: cleanNumber(raw.byteSize ?? raw.byte_size ?? payload?.byteSize ?? payload?.byte_size),
    mimeType: cleanString(raw.mimeType ?? raw.mime_type ?? payload?.mimeType ?? payload?.mime_type),
  };

  return Object.values(metadata).some((value) => value !== undefined && value !== "")
    ? metadata
    : undefined;
}

export function normalizeClipboardUpdatePayload(payload: unknown): ClipboardHistoryItem | null {
  if (!isRecord(payload)) {
    return null;
  }

  const rawPayload = payload as ClipboardUpdatePayload;
  const id = cleanString(rawPayload.id);
  if (!id) {
    return null;
  }

  const type = (rawPayload.type || rawPayload.item_type || "text") as ClipboardItemType;
  if (type !== "text" && type !== "image") {
    return null;
  }

  const blobPath = cleanString(rawPayload.blobPath ?? rawPayload.blob_path);
  const thumbPath = cleanString(rawPayload.thumbPath ?? rawPayload.thumb_path);
  const content = cleanString(rawPayload.content || thumbPath || blobPath);
  if (!content) {
    return null;
  }

  const tsMs = cleanNumber(rawPayload.tsMs ?? rawPayload.ts_ms ?? Date.now()) ?? Date.now();

  return {
    id,
    type,
    content,
    tsMs,
    blobPath: blobPath || undefined,
    thumbPath: thumbPath || undefined,
    metadata: type === "image" ? normalizeMetadata(rawPayload) : undefined,
  };
}

export function clipboardItemIdentity(item: ClipboardHistoryItem): string {
  if (item.type === "image") {
    return item.blobPath || item.thumbPath || item.content;
  }

  return item.content;
}

export function isSameClipboardItem(a: ClipboardHistoryItem, b: ClipboardHistoryItem): boolean {
  return (
    a.id === b.id || (a.type === b.type && clipboardItemIdentity(a) === clipboardItemIdentity(b))
  );
}

function isDirectImageSource(source: string): boolean {
  return (
    source.startsWith("data:") ||
    source.startsWith("blob:") ||
    source.startsWith("asset:") ||
    source.startsWith("http://") ||
    source.startsWith("https://")
  );
}

function isInlineImageDataSource(source: string): boolean {
  return source.trim().toLowerCase().startsWith("data:image/");
}

export function resolveClipboardImageSrc(item: ClipboardHistoryItem): string {
  const source = item.thumbPath || item.blobPath || item.content;
  if (!source || isDirectImageSource(source)) {
    return source;
  }

  try {
    return resolveFileAssetSrc(source);
  } catch {
    return source;
  }
}

export function clipboardImagePasteSource(item: ClipboardHistoryItem): string {
  return item.blobPath || item.content;
}

export function isInlineClipboardImageItem(item: ClipboardHistoryItem): boolean {
  return item.type === "image" && !item.blobPath && isInlineImageDataSource(item.content);
}

export function clipboardImageFilePaths(item: ClipboardHistoryItem): string[] {
  if (item.type !== "image") {
    return [];
  }

  const paths = [item.blobPath, item.thumbPath, item.content]
    .map((value) => cleanString(value))
    .filter((value) => value && !isDirectImageSource(value));
  return Array.from(new Set(paths));
}

export function collectUnusedClipboardImagePaths(
  removed: ClipboardHistoryItem[],
  retained: ClipboardHistoryItem[]
): string[] {
  const retainedPaths = new Set(retained.flatMap(clipboardImageFilePaths));
  const removedPaths = removed.flatMap(clipboardImageFilePaths);
  return Array.from(new Set(removedPaths.filter((path) => !retainedPaths.has(path))));
}

export async function migrateInlineClipboardImageItems<T extends ClipboardHistoryItem>(
  items: T[],
  storeImage: (
    imageSource: string,
    id?: string,
    tsMs?: number
  ) => Promise<ClipboardUpdatePayload | null>
): Promise<{ items: T[]; changed: boolean }> {
  let changed = false;
  const migrated: T[] = [];

  for (const item of items) {
    if (!isInlineClipboardImageItem(item)) {
      migrated.push(item);
      continue;
    }

    const stored = normalizeClipboardUpdatePayload(
      await storeImage(item.content, item.id, item.tsMs)
    );
    if (!stored) {
      migrated.push(item);
      continue;
    }

    changed = true;
    migrated.push({
      ...item,
      ...stored,
      id: item.id,
      tsMs: item.tsMs,
    });
  }

  return { items: migrated, changed };
}

export function formatClipboardImageMetadata(item: ClipboardHistoryItem): string {
  const metadata = item.metadata;
  if (!metadata) {
    return "";
  }

  const parts: string[] = [];
  if (metadata.width && metadata.height) {
    parts.push(`${Math.round(metadata.width)}x${Math.round(metadata.height)}`);
  }
  if (metadata.byteSize) {
    const kb = metadata.byteSize / 1024;
    parts.push(kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`);
  }

  return parts.join(" · ");
}
