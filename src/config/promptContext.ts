export interface PromptRuntimeContext {
  selectedText?: string;
  clipboardText?: string;
  capturedAt?: string;
}

export interface PromptContextSettings {
  enabled: boolean;
  selectedEnabled: boolean;
  clipboardEnabled: boolean;
  maxChars: number;
}

export const PROMPT_CONTEXT_STORAGE_KEYS = {
  enabled: "promptContextEnabled",
  selectedEnabled: "promptContextSelectedEnabled",
  clipboardEnabled: "promptContextClipboardEnabled",
  maxChars: "promptContextMaxChars",
} as const;

const DEFAULT_MAX_CHARS = 1200;
const CLIPBOARD_READ_TIMEOUT_MS = 250;

const DEFAULT_SETTINGS: PromptContextSettings = {
  enabled: true,
  selectedEnabled: true,
  clipboardEnabled: false,
  maxChars: DEFAULT_MAX_CHARS,
};

function getStorage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function readBoolean(storage: Storage | null, key: string, fallback: boolean): boolean {
  const value = storage?.getItem(key);
  if (value === null || value === undefined) {
    return fallback;
  }
  return value !== "false";
}

function readNumber(storage: Storage | null, key: string, fallback: number): number {
  const value = Number.parseInt(storage?.getItem(key) || "", 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(200, Math.min(8000, value));
}

export function readPromptContextSettings(): PromptContextSettings {
  const storage = getStorage();
  return {
    enabled: readBoolean(storage, PROMPT_CONTEXT_STORAGE_KEYS.enabled, DEFAULT_SETTINGS.enabled),
    selectedEnabled: readBoolean(
      storage,
      PROMPT_CONTEXT_STORAGE_KEYS.selectedEnabled,
      DEFAULT_SETTINGS.selectedEnabled
    ),
    clipboardEnabled: readBoolean(
      storage,
      PROMPT_CONTEXT_STORAGE_KEYS.clipboardEnabled,
      DEFAULT_SETTINGS.clipboardEnabled
    ),
    maxChars: readNumber(storage, PROMPT_CONTEXT_STORAGE_KEYS.maxChars, DEFAULT_SETTINGS.maxChars),
  };
}

export function writePromptContextSetting(
  key: keyof typeof PROMPT_CONTEXT_STORAGE_KEYS,
  value: boolean | number
): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(PROMPT_CONTEXT_STORAGE_KEYS[key], String(value));
}

export function sanitizePromptContextText(value: unknown, maxChars = DEFAULT_MAX_CHARS): string {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!text) {
    return "";
  }

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trimEnd()}\n[context truncated]`;
}

function getRendererSelectedText(): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "";
  }

  const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;

  if (
    activeElement &&
    typeof activeElement.value === "string" &&
    typeof activeElement.selectionStart === "number" &&
    typeof activeElement.selectionEnd === "number" &&
    activeElement.selectionEnd > activeElement.selectionStart
  ) {
    return activeElement.value.slice(activeElement.selectionStart, activeElement.selectionEnd);
  }

  return window.getSelection?.()?.toString() || "";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timeoutId = globalThis.setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => globalThis.clearTimeout(timeoutId));
  });
}

export function promptTemplateRequestsContext(template: string): {
  selected: boolean;
  clipboard: boolean;
} {
  return {
    selected: template.includes("{selected}"),
    clipboard: template.includes("{clipboard}"),
  };
}

export function hasPromptContext(context?: PromptRuntimeContext | null): boolean {
  return !!(
    sanitizePromptContextText(context?.selectedText).trim() ||
    sanitizePromptContextText(context?.clipboardText).trim()
  );
}

export async function capturePromptContext(
  options: {
    forceSelected?: boolean;
    forceClipboard?: boolean;
  } = {}
): Promise<PromptRuntimeContext> {
  const settings = readPromptContextSettings();
  if (!settings.enabled) {
    return {};
  }

  const includeSelected = settings.selectedEnabled || !!options.forceSelected;
  const includeClipboard = settings.clipboardEnabled || !!options.forceClipboard;

  let selectedText = "";
  let clipboardText = "";

  if (includeSelected) {
    selectedText = sanitizePromptContextText(getRendererSelectedText(), settings.maxChars);
  }

  if (includeClipboard && typeof window !== "undefined") {
    const readClipboard = window.electronAPI?.readClipboard;
    if (typeof readClipboard === "function") {
      clipboardText = sanitizePromptContextText(
        await withTimeout(readClipboard(), CLIPBOARD_READ_TIMEOUT_MS, ""),
        settings.maxChars
      );
    }
  }

  return {
    selectedText,
    clipboardText,
    capturedAt: new Date().toISOString(),
  };
}

export function formatPromptContextForSystem(context?: PromptRuntimeContext | null): string {
  const selectedText = sanitizePromptContextText(context?.selectedText);
  const clipboardText = sanitizePromptContextText(context?.clipboardText);

  if (!selectedText && !clipboardText) {
    return "";
  }

  const sections = [
    "",
    "PROMPT CONTEXT:",
    "Use this context only to resolve references, preserve terms, or transform selected text when the user clearly asks for it.",
    "Do not copy this context into the output unless the dictated instruction explicitly requires it.",
  ];

  if (selectedText) {
    sections.push("", "Selected text:", selectedText);
  }

  if (clipboardText) {
    sections.push("", "Clipboard text:", clipboardText);
  }

  sections.push("", "END PROMPT CONTEXT");
  return `\n\n${sections.join("\n")}`;
}

export default {
  PROMPT_CONTEXT_STORAGE_KEYS,
  readPromptContextSettings,
  writePromptContextSetting,
  sanitizePromptContextText,
  promptTemplateRequestsContext,
  hasPromptContext,
  capturePromptContext,
  formatPromptContextForSystem,
};
