import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Copy, FolderPlus, History, Pencil, Search, Star, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Toggle } from "./ui/toggle";
import { useI18n } from "../i18n";
import type {
  ClipboardFavoritesState,
  ClipboardFolder,
  ClipboardHistoryItem,
  ClipboardItemType,
} from "../types/clipboard";

const STORAGE_KEYS = {
  enabled: "clipboard.enabled",
  maxItems: "clipboard.maxItems",
  history: "clipboard.history",
  favorites: "clipboard.favorites",
} as const;

const DEFAULT_MAX_ITEMS = 50;

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getDefaultFavorites(): ClipboardFavoritesState {
  return {
    folders: [{ id: "default", name: "Favorites" }],
    items: [],
  };
}

function isClipboardFavoritesState(value: unknown): value is ClipboardFavoritesState {
  if (!value || typeof value !== "object") return false;
  const v = value as any;
  if (!Array.isArray(v.folders) || !Array.isArray(v.items)) return false;

  const foldersOk = v.folders.every(
    (f: any) => f && typeof f === "object" && typeof f.id === "string" && typeof f.name === "string"
  );
  if (!foldersOk) return false;

  const itemsOk = v.items.every(
    (it: any) =>
      it &&
      typeof it === "object" &&
      typeof it.id === "string" &&
      (it.type === "text" || it.type === "image") &&
      typeof it.content === "string" &&
      typeof it.tsMs === "number" &&
      typeof it.folderId === "string"
  );
  return itemsOk;
}

export default function ClipboardSettings() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<string>("history");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Folder picker dialog state
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pendingPinItem, setPendingPinItem] = useState<ClipboardHistoryItem | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [inlineNewFolderName, setInlineNewFolderName] = useState("");
  const [showInlineNewFolder, setShowInlineNewFolder] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);

  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.enabled);
      if (raw === null) return true;
      return raw === "true";
    } catch {
      return true;
    }
  });

  const [maxItems, setMaxItems] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.maxItems);
      const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_MAX_ITEMS;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ITEMS;
    } catch {
      return DEFAULT_MAX_ITEMS;
    }
  });

  const [history, setHistory] = useState<ClipboardHistoryItem[]>(() => {
    try {
      return safeJsonParse(
        localStorage.getItem(STORAGE_KEYS.history),
        [] as ClipboardHistoryItem[]
      );
    } catch {
      return [];
    }
  });

  const [favorites, setFavorites] = useState<ClipboardFavoritesState>(() => {
    try {
      return safeJsonParse(localStorage.getItem(STORAGE_KEYS.favorites), getDefaultFavorites());
    } catch {
      return getDefaultFavorites();
    }
  });

  // Load file-backed favorites (settings.json) and migrate localStorage -> settings on first run.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const api = window.electronAPI;
        if (!api?.getSetting) return;

        const stored = await api.getSetting(STORAGE_KEYS.favorites);
        if (cancelled) return;

        if (isClipboardFavoritesState(stored)) {
          setFavorites(stored);
          try {
            localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(stored));
          } catch {
            // ignore
          }
          return;
        }

        // No file-backed favorites yet: persist whatever we have in localStorage.
        const local = safeJsonParse(
          localStorage.getItem(STORAGE_KEYS.favorites),
          getDefaultFavorites()
        );
        const isDefault =
          local.items.length === 0 &&
          local.folders.length === 1 &&
          local.folders[0]?.id === "default";
        if (!isDefault) {
          await api.setSetting?.(STORAGE_KEYS.favorites, local);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const [activeFolderId, setActiveFolderId] = useState<string>(() => {
    return "default";
  });

  const [newFolderName, setNewFolderName] = useState("");

  // Keep default folder label localized.
  useEffect(() => {
    setFavorites((prev) => {
      const existing = prev.folders.find((f) => f.id === "default");
      const nextFolders = existing
        ? prev.folders.map((f) =>
            f.id === "default" ? { ...f, name: t("clipboard.favorites") } : f
          )
        : [{ id: "default", name: t("clipboard.favorites") }, ...prev.folders];
      const next = { ...prev, folders: nextFolders };
      try {
        localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(next));
      } catch {
        // ignore
      }
      try {
        void window.electronAPI?.setSetting?.(STORAGE_KEYS.favorites, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, [t]);

  const persistEnabled = useCallback((value: boolean) => {
    setEnabled(value);
    try {
      localStorage.setItem(STORAGE_KEYS.enabled, String(value));
    } catch {
      // ignore
    }
  }, []);

  const persistMaxItems = useCallback((value: number) => {
    const next = Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_ITEMS;
    setMaxItems(next);
    try {
      localStorage.setItem(STORAGE_KEYS.maxItems, String(next));
    } catch {
      // ignore
    }
    setHistory((prev) => {
      const trimmed = prev.slice(0, next);
      try {
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(trimmed));
      } catch {
        // ignore
      }
      return trimmed;
    });
  }, []);

  const persistHistory = useCallback(
    (next: ClipboardHistoryItem[]) => {
      const trimmed = next.slice(0, maxItems);
      setHistory(trimmed);
      try {
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(trimmed));
      } catch {
        // ignore
      }
    },
    [maxItems]
  );

  const persistFavorites = useCallback((next: ClipboardFavoritesState) => {
    setFavorites(next);
    try {
      localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(next));
    } catch {
      // ignore
    }
    try {
      void window.electronAPI?.setSetting?.(STORAGE_KEYS.favorites, next);
    } catch {
      // ignore
    }
  }, []);

  const handleClipboardUpdate = useCallback(
    (payload: any) => {
      if (!enabled) return;

      const id = String(payload?.id || "").trim();
      if (!id) return;

      const itemType = (payload?.type || payload?.item_type || "text") as ClipboardItemType;
      const content = String(payload?.content || "");
      const tsMs = Number(payload?.tsMs ?? payload?.ts_ms ?? Date.now());

      if (!content.trim()) return;

      setHistory((prev) => {
        if (prev.some((item) => item.id === id)) {
          return prev;
        }

        const next: ClipboardHistoryItem[] = [{ id, type: itemType, content, tsMs }, ...prev];
        const trimmed = next.slice(0, maxItems);
        try {
          localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(trimmed));
        } catch {
          // ignore
        }
        return trimmed;
      });
    },
    [enabled, maxItems]
  );

  // Listen to Tauri clipboard events (optional, improves responsiveness when settings is open).
  useEffect(() => {
    let unlisten: undefined | (() => void);

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("clipboard-update", (event) => {
          handleClipboardUpdate((event as any).payload);
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [handleClipboardUpdate]);

  // Cross-window sync (main window may be writing clipboard history).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key === STORAGE_KEYS.history) {
        setHistory(safeJsonParse(event.newValue, [] as ClipboardHistoryItem[]));
      }
      if (event.key === STORAGE_KEYS.favorites) {
        setFavorites(safeJsonParse(event.newValue, getDefaultFavorites()));
      }
      if (event.key === STORAGE_KEYS.enabled) {
        setEnabled(event.newValue === null ? true : event.newValue === "true");
      }
      if (event.key === STORAGE_KEYS.maxItems) {
        const parsed = event.newValue ? Number.parseInt(event.newValue, 10) : DEFAULT_MAX_ITEMS;
        setMaxItems(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ITEMS);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isPinned = useCallback(
    (id: string) => {
      return favorites.items.some((item) => item.id === id);
    },
    [favorites.items]
  );

  const handleTogglePin = useCallback(
    (item: ClipboardHistoryItem) => {
      const exists = favorites.items.find((f) => f.id === item.id);
      if (exists) {
        // Already pinned — unpin immediately, no dialog
        persistFavorites({
          ...favorites,
          items: favorites.items.filter((f) => f.id !== item.id),
        });
        return;
      }

      // Not pinned — open folder picker dialog
      setPendingPinItem(item);
      setSelectedFolderId(""); // default: no folder
      setShowInlineNewFolder(false);
      setInlineNewFolderName("");
      setPinDialogOpen(true);
    },
    [favorites, persistFavorites]
  );

  const handleConfirmPin = useCallback(() => {
    if (!pendingPinItem) return;
    const folderId = selectedFolderId || "default";
    persistFavorites({
      ...favorites,
      items: [{ ...pendingPinItem, folderId }, ...favorites.items],
    });
    setPinDialogOpen(false);
    setPendingPinItem(null);
  }, [pendingPinItem, selectedFolderId, favorites, persistFavorites]);

  const handleInlineCreateFolder = useCallback(() => {
    const name = inlineNewFolderName.trim();
    if (!name) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const nextFolder: ClipboardFolder = { id, name };
    persistFavorites({
      ...favorites,
      folders: [...favorites.folders, nextFolder],
    });
    setSelectedFolderId(id);
    setInlineNewFolderName("");
    setShowInlineNewFolder(false);
  }, [favorites, inlineNewFolderName, persistFavorites]);

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      if (folderId === "default") return; // cannot delete default folder
      persistFavorites({
        ...favorites,
        folders: favorites.folders.filter((f) => f.id !== folderId),
        items: favorites.items.filter((f) => f.folderId !== folderId),
      });
      // If the deleted folder was active, switch to history
      if (activeTab === folderId) {
        setActiveTab("history");
      }
      if (activeFolderId === folderId) {
        setActiveFolderId("default");
      }
    },
    [activeTab, activeFolderId, favorites, persistFavorites]
  );

  const handleAddFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (!name) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const nextFolder: ClipboardFolder = { id, name };
    persistFavorites({
      ...favorites,
      folders: [...favorites.folders, nextFolder],
    });
    setNewFolderName("");
    setActiveFolderId(id);
    setActiveTab(id);
  }, [favorites, newFolderName, persistFavorites]);

  const handleClearHistory = useCallback(() => {
    persistHistory([]);
  }, [persistHistory]);

  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    handleAddFolder();
    setIsCreateFolderOpen(false);
  }, [handleAddFolder, newFolderName]);

  const handleCopy = useCallback(async (item: ClipboardHistoryItem) => {
    if (item.type === "image") {
      await window.electronAPI?.writeClipboardImage?.(item.content);
      return;
    }
    await window.electronAPI?.writeClipboard?.(item.content);
  }, []);

  const handlePaste = useCallback(async (item: ClipboardHistoryItem) => {
    // Hide the window first so the keystroke lands in the previous app.
    await window.electronAPI?.hideWindow?.();
    await new Promise((r) => setTimeout(r, 80));

    if (item.type === "image") {
      await window.electronAPI?.pasteImage?.(item.content);
      return;
    }
    await window.electronAPI?.pasteText?.(item.content);
  }, []);

  const handlePasteFromSearch = useCallback(
    async (item: ClipboardHistoryItem) => {
      setIsSearchOpen(false);
      await handlePaste(item);
    },
    [handlePaste]
  );

  const listItems = useMemo(() => {
    if (activeTab === "history") return history;
    return favorites.items.filter((item) => item.folderId === activeTab);
  }, [activeTab, history, favorites.items]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as ClipboardHistoryItem[];
    const scope = activeTab === "history" ? history : listItems;
    return scope.filter((item) => item.type === "text" && item.content.toLowerCase().includes(q));
  }, [activeTab, history, listItems, searchQuery]);

  const renderActionButtons = useCallback(
    (item: ClipboardHistoryItem) => {
      const pinned = isPinned(item.id);
      const pinLabel = pinned ? t("clipboard.unpin") : t("clipboard.pin");
      const pasteLabel = t("clipboard.paste");
      const copyLabel = t("clipboard.copy");

      return (
        <div className="flex items-center gap-1 shrink-0" style={{ marginTop: "2px" }}>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => handleCopy(item)}
            className="h-7 w-7"
            title={copyLabel}
            aria-label={copyLabel}
          >
            <Copy size={12} />
            <span className="sr-only">{copyLabel}</span>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => handlePaste(item)}
            className="h-7 w-7"
            title={pasteLabel}
            aria-label={pasteLabel}
          >
            <ClipboardPaste size={12} />
            <span className="sr-only">{pasteLabel}</span>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => handleTogglePin(item)}
            className={
              pinned ? "h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "h-7 w-7"
            }
            title={pinLabel}
            aria-label={pinLabel}
          >
            {pinned ? <Star size={12} fill="currentColor" /> : <Star size={12} />}
            <span className="sr-only">{pinLabel}</span>
          </Button>
        </div>
      );
    },
    [handleCopy, handlePaste, handleTogglePin, isPinned, t]
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("settings.clipboard")}</h3>
        <p className="text-sm text-gray-600">{t("settings.clipboard.desc")}</p>
      </div>

      <div className="flex items-center justify-between gap-3 p-4 bg-neutral-50 border border-neutral-200 rounded-xl">
        <div>
          <p className="text-sm font-medium text-neutral-800">{t("clipboard.enable")}</p>
        </div>

        <Toggle checked={enabled} onChange={persistEnabled} />

        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-600">{t("clipboard.maxItems")}</span>
          <Input
            value={String(maxItems)}
            onChange={(e) => {
              const raw = e.target.value;
              const next = Number.parseInt(raw, 10);
              if (!Number.isFinite(next)) {
                setMaxItems(DEFAULT_MAX_ITEMS);
                return;
              }
              setMaxItems(next);
            }}
            onBlur={() => persistMaxItems(maxItems)}
            className="w-20 text-sm"
            inputMode="numeric"
          />

          <Button type="button" variant="outline" size="sm" onClick={handleClearHistory}>
            {t("clipboard.clearHistory")}
          </Button>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 border-b border-gray-200">
        <div className="flex min-w-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "history"
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <History className="w-4 h-4" />
            {t("clipboard.history")}
          </button>

          {favorites.folders.map((folder) => (
            <div key={folder.id} className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  setActiveFolderId(folder.id);
                  setActiveTab(folder.id);
                }}
                className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === folder.id
                    ? "border-neutral-900 text-neutral-900"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                <Star className="w-4 h-4" />
                {folder.name}
              </button>
              {isEditMode && folder.id !== "default" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFolder(folder.id);
                  }}
                  className="ml-[-8px] mr-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors flex-shrink-0"
                  title={t("clipboard.deleteFolder")}
                  aria-label={t("clipboard.deleteFolder")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 pb-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setIsSearchOpen(true)}
            title={t("clipboard.search")}
            aria-label={t("clipboard.search")}
          >
            <Search size={12} />
            <span className="sr-only">{t("clipboard.search")}</span>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setIsCreateFolderOpen(true)}
            title={t("clipboard.addFolder")}
            aria-label={t("clipboard.addFolder")}
          >
            <FolderPlus size={12} />
            <span className="sr-only">{t("clipboard.addFolder")}</span>
          </Button>
          <Button
            type="button"
            size="icon"
            variant={isEditMode ? "default" : "ghost"}
            className={`h-7 w-7 ${isEditMode ? "bg-neutral-900 text-white hover:bg-neutral-800" : ""}`}
            onClick={() => setIsEditMode((prev) => !prev)}
            title={t("clipboard.editFolders")}
            aria-label={t("clipboard.editFolders")}
          >
            <Pencil size={12} />
            <span className="sr-only">{t("clipboard.editFolders")}</span>
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {listItems.length === 0 ? (
          <div className="text-sm text-neutral-600 p-4 bg-neutral-50 border border-neutral-200 rounded-xl">
            {t("clipboard.empty")}
          </div>
        ) : (
          listItems.map((item) => (
            <div
              key={item.id}
              className="p-3 bg-white border border-neutral-200 rounded-xl flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs text-neutral-500 mb-1">
                  {new Date(item.tsMs).toLocaleString()}
                </div>
                {item.type === "image" ? (
                  <img
                    src={item.content}
                    alt=""
                    className="max-h-24 rounded border border-neutral-200"
                  />
                ) : (
                  <div className="text-sm text-neutral-900 whitespace-pre-wrap break-words line-clamp-3">
                    {item.content}
                  </div>
                )}
              </div>

              {renderActionButtons(item)}
            </div>
          ))
        )}
      </div>

      <Dialog
        open={isSearchOpen}
        onOpenChange={(open) => {
          setIsSearchOpen(open);
          if (!open) {
            setSearchQuery("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("clipboard.search")}</DialogTitle>
            <DialogDescription>{t("settings.clipboard.desc")}</DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("clipboard.searchPlaceholder")}
          />

          <div className="max-h-[360px] overflow-y-auto space-y-2">
            {!searchQuery.trim() ? (
              <div className="text-sm text-neutral-600 p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                {t("clipboard.searchPlaceholder")}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-sm text-neutral-600 p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                {t("clipboard.noResults")}
              </div>
            ) : (
              searchResults.map((item) => {
                const pinned = isPinned(item.id);
                const pinLabel = pinned ? t("clipboard.unpin") : t("clipboard.pin");
                return (
                  <div
                    key={item.id}
                    className="p-3 bg-white border border-neutral-200 rounded-xl flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-neutral-500 mb-1">
                        {new Date(item.tsMs).toLocaleString()}
                      </div>
                      <div className="text-sm text-neutral-900 whitespace-pre-wrap break-words line-clamp-3">
                        {item.content}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0" style={{ marginTop: "2px" }}>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleCopy(item)}
                        className="h-7 w-7"
                        title={t("clipboard.copy")}
                        aria-label={t("clipboard.copy")}
                      >
                        <Copy size={12} />
                        <span className="sr-only">{t("clipboard.copy")}</span>
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handlePasteFromSearch(item)}
                        className="h-7 w-7"
                        title={t("clipboard.paste")}
                        aria-label={t("clipboard.paste")}
                      >
                        <ClipboardPaste size={12} />
                        <span className="sr-only">{t("clipboard.paste")}</span>
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleTogglePin(item)}
                        className={
                          pinned
                            ? "h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                            : "h-7 w-7"
                        }
                        title={pinLabel}
                        aria-label={pinLabel}
                      >
                        {pinned ? <Star size={12} fill="currentColor" /> : <Star size={12} />}
                        <span className="sr-only">{pinLabel}</span>
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateFolderOpen}
        onOpenChange={(open) => {
          setIsCreateFolderOpen(open);
          if (!open) {
            setNewFolderName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("clipboard.addFolder")}</DialogTitle>
            <DialogDescription>{t("settings.clipboard.desc")}</DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t("clipboard.folderName")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateFolder();
              }
            }}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCreateFolderOpen(false)}>
              {t("clipboard.cancel")}
            </Button>
            <Button type="button" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              {t("clipboard.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder picker dialog */}
      <Dialog
        open={pinDialogOpen}
        onOpenChange={(open) => {
          setPinDialogOpen(open);
          if (!open) {
            setPendingPinItem(null);
            setShowInlineNewFolder(false);
            setInlineNewFolderName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle>{t("clipboard.addToFolder")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-[240px] overflow-y-auto">
            {/* No folder option */}
            <button
              type="button"
              onClick={() => setSelectedFolderId("")}
              className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                selectedFolderId === ""
                  ? "border-neutral-900 bg-neutral-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{t("clipboard.noFolder")}</span>
                {selectedFolderId === "" && (
                  <span className="text-xs text-neutral-900 bg-neutral-100 px-2 py-1 rounded-full font-medium">✓</span>
                )}
              </div>
            </button>
            {favorites.folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setSelectedFolderId(folder.id)}
                className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                  selectedFolderId === folder.id
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{folder.name}</span>
                  {selectedFolderId === folder.id && (
                    <span className="text-xs text-neutral-900 bg-neutral-100 px-2 py-1 rounded-full font-medium">✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {showInlineNewFolder && (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={inlineNewFolderName}
                onChange={(e) => setInlineNewFolderName(e.target.value)}
                placeholder={t("clipboard.folderName")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleInlineCreateFolder();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={handleInlineCreateFolder}
                disabled={!inlineNewFolderName.trim()}
              >
                {t("clipboard.ok")}
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button type="button" size="sm" onClick={handleConfirmPin}>
              {t("clipboard.ok")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPinDialogOpen(false)}
            >
              {t("clipboard.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowInlineNewFolder(true)}
            >
              {t("clipboard.newFolder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
