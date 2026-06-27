export type ClipboardItemType = "text" | "image";

export type ClipboardImageMetadata = {
  width?: number;
  height?: number;
  byteSize?: number;
  mimeType?: string;
};

export type ClipboardHistoryItem = {
  id: string;
  type: ClipboardItemType;
  content: string;
  tsMs: number;
  blobPath?: string;
  thumbPath?: string;
  metadata?: ClipboardImageMetadata;
};

export type ClipboardUpdatePayload = {
  id?: unknown;
  type?: unknown;
  item_type?: unknown;
  content?: unknown;
  blobPath?: unknown;
  blob_path?: unknown;
  thumbPath?: unknown;
  thumb_path?: unknown;
  tsMs?: unknown;
  ts_ms?: unknown;
  width?: unknown;
  height?: unknown;
  byteSize?: unknown;
  byte_size?: unknown;
  mimeType?: unknown;
  mime_type?: unknown;
  metadata?: unknown;
};

export type ClipboardFolder = {
  id: string;
  name: string;
};

export type ClipboardFavoriteItem = ClipboardHistoryItem & {
  folderId: string;
};

export type ClipboardFavoritesState = {
  folders: ClipboardFolder[];
  items: ClipboardFavoriteItem[];
};
