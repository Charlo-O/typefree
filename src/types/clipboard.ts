export type ClipboardItemType = "text" | "image";

export type ClipboardHistoryItem = {
  id: string;
  type: ClipboardItemType;
  content: string;
  tsMs: number;
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
