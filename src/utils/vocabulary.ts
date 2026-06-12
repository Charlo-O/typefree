import { getSetting, setSetting } from "./tauriAPI";

export interface SnippetReplacement {
  trigger: string;
  replacement: string;
}

export interface VocabularySettings {
  hotwordsEnabled: boolean;
  snippetsEnabled: boolean;
  userHotwords: string[];
  userSnippets: SnippetReplacement[];
}

export const VOCABULARY_SETTINGS_KEY = "vocabularySettings";
export const VOCABULARY_EFFECTIVE_HOTWORDS_KEY = "vocabularyEffectiveHotwords";
export const VOCABULARY_EFFECTIVE_SNIPPETS_KEY = "vocabularyEffectiveSnippets";

export const DEFAULT_HOTWORDS: string[] = [
  "Claude",
  "Claude Code",
  "GPT",
  "GPT-4",
  "GPT-4o",
  "GPT-5",
  "Gemini",
  "Anthropic",
  "OpenAI",
  "DeepSeek",
  "Qwen",
  "Qwen3",
  "Mistral",
  "Perplexity",
  "Grok",
  "Groq",
  "ChatGPT",
  "Whisper",
  "Sora",
  "Cursor",
  "Windsurf",
  "Codex",
  "MCP",
  "vibe coding",
  "LangChain",
  "LlamaIndex",
  "Ollama",
  "vLLM",
  "ComfyUI",
  "RAG",
  "LoRA",
  "QLoRA",
  "RLHF",
  "DPO",
  "multimodal",
  "fine-tuning",
  "embedding",
  "tokenizer",
  "transformer",
  "GGUF",
  "ONNX",
  "TTS",
  "ASR",
  "GitHub",
  "VS Code",
  "Docker",
  "Kubernetes",
  "PostgreSQL",
  "Redis",
  "Supabase",
  "Vercel",
  "API",
  "SDK",
  "prompt",
  "webhook",
  "GraphQL",
  "WebSocket",
  "JSON",
  "React",
  "Next.js",
  "Vue",
  "Tailwind",
  "TypeScript",
  "JavaScript",
  "Rust",
  "FastAPI",
  "NVIDIA",
  "CUDA",
  "GPU",
];

export const DEFAULT_SNIPPETS: SnippetReplacement[] = [
  { trigger: "web coding", replacement: "vibe coding" },
  { trigger: "webb coding", replacement: "vibe coding" },
  { trigger: "vibes coding", replacement: "vibe coding" },
  { trigger: "wife coding", replacement: "vibe coding" },
  { trigger: "Cloud Code", replacement: "Claude Code" },
  { trigger: "clod", replacement: "Claude" },
  { trigger: "clawed", replacement: "Claude" },
  { trigger: "claud", replacement: "Claude" },
  { trigger: "Asthropic", replacement: "Anthropic" },
  { trigger: "Anthropropic", replacement: "Anthropic" },
  { trigger: "and tropic", replacement: "Anthropic" },
  { trigger: "chat GPT", replacement: "ChatGPT" },
  { trigger: "deep sick", replacement: "DeepSeek" },
  { trigger: "deep seek", replacement: "DeepSeek" },
  { trigger: "jiminy", replacement: "Gemini" },
  { trigger: "gem any", replacement: "Gemini" },
  { trigger: "Queen three", replacement: "Qwen3" },
  { trigger: "Queen 3", replacement: "Qwen3" },
  { trigger: "Queen3", replacement: "Qwen3" },
  { trigger: "grock", replacement: "Grok" },
  { trigger: "ELMA", replacement: "Llama" },
  { trigger: "OELMA", replacement: "Ollama" },
  { trigger: "mid journey", replacement: "Midjourney" },
  { trigger: "co pilot", replacement: "Copilot" },
  { trigger: "perplex city", replacement: "Perplexity" },
  { trigger: "hugging phase", replacement: "Hugging Face" },
  { trigger: "codecs", replacement: "Codex" },
  { trigger: "CodeX", replacement: "Codex" },
  { trigger: "type script", replacement: "TypeScript" },
  { trigger: "java script", replacement: "JavaScript" },
  { trigger: "web socket", replacement: "WebSocket" },
  { trigger: "post gray SQL", replacement: "PostgreSQL" },
  { trigger: "super base", replacement: "Supabase" },
];

const DEFAULT_SETTINGS: VocabularySettings = {
  hotwordsEnabled: true,
  snippetsEnabled: true,
  userHotwords: [],
  userSnippets: [],
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined" || !window.localStorage) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function cleanWord(value: unknown): string {
  return String(value || "").trim();
}

function cleanSnippet(value: SnippetReplacement): SnippetReplacement | null {
  const trigger = cleanWord(value?.trigger);
  const replacement = cleanWord(value?.replacement);
  if (!trigger || !replacement || trigger === replacement) {
    return null;
  }
  return { trigger, replacement };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = cleanWord(value);
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

export function normalizeVocabularySettings(
  settings: Partial<VocabularySettings>
): VocabularySettings {
  const userSnippets = (Array.isArray(settings.userSnippets) ? settings.userSnippets : [])
    .map(cleanSnippet)
    .filter((item): item is SnippetReplacement => !!item);

  return {
    hotwordsEnabled:
      typeof settings.hotwordsEnabled === "boolean"
        ? settings.hotwordsEnabled
        : DEFAULT_SETTINGS.hotwordsEnabled,
    snippetsEnabled:
      typeof settings.snippetsEnabled === "boolean"
        ? settings.snippetsEnabled
        : DEFAULT_SETTINGS.snippetsEnabled,
    userHotwords: uniqueStrings(Array.isArray(settings.userHotwords) ? settings.userHotwords : []),
    userSnippets,
  };
}

export function readVocabularySettings(): VocabularySettings {
  return normalizeVocabularySettings(
    readJson<VocabularySettings>(VOCABULARY_SETTINGS_KEY, DEFAULT_SETTINGS)
  );
}

export function getEffectiveHotwords(settings = readVocabularySettings()): string[] {
  if (!settings.hotwordsEnabled) return [];
  return uniqueStrings([...DEFAULT_HOTWORDS, ...settings.userHotwords]);
}

export function getEffectiveSnippets(settings = readVocabularySettings()): SnippetReplacement[] {
  if (!settings.snippetsEnabled) return [];

  const byTrigger = new Map<string, SnippetReplacement>();
  for (const snippet of DEFAULT_SNIPPETS) {
    byTrigger.set(snippet.trigger.replace(/\s+/g, "").toLocaleLowerCase(), snippet);
  }
  for (const snippet of settings.userSnippets) {
    byTrigger.set(snippet.trigger.replace(/\s+/g, "").toLocaleLowerCase(), snippet);
  }
  return Array.from(byTrigger.values());
}

export async function loadVocabularySettings(): Promise<VocabularySettings> {
  const local = readVocabularySettings();
  const stored = await getSetting<VocabularySettings>(VOCABULARY_SETTINGS_KEY);
  if (!stored) return local;

  const settings = normalizeVocabularySettings(stored);
  persistVocabularyLocally(settings);
  return settings;
}

function persistVocabularyLocally(settings: VocabularySettings): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(VOCABULARY_SETTINGS_KEY, JSON.stringify(settings));
}

export async function saveVocabularySettings(
  settings: VocabularySettings
): Promise<VocabularySettings> {
  const normalized = normalizeVocabularySettings(settings);
  persistVocabularyLocally(normalized);
  await setSetting(VOCABULARY_SETTINGS_KEY, normalized);
  await setSetting(VOCABULARY_EFFECTIVE_HOTWORDS_KEY, getEffectiveHotwords(normalized));
  await setSetting(VOCABULARY_EFFECTIVE_SNIPPETS_KEY, getEffectiveSnippets(normalized));
  return normalized;
}

export async function syncVocabularySettingsToBackend(): Promise<void> {
  const settings = readVocabularySettings();
  await setSetting(VOCABULARY_SETTINGS_KEY, settings);
  await setSetting(VOCABULARY_EFFECTIVE_HOTWORDS_KEY, getEffectiveHotwords(settings));
  await setSetting(VOCABULARY_EFFECTIVE_SNIPPETS_KEY, getEffectiveSnippets(settings));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexiblePattern(trigger: string): RegExp | null {
  const chars = Array.from(trigger).filter((char) => !/\s/u.test(char));
  if (!chars.length) return null;

  const core = chars.map(escapeRegExp).join("\\s*");
  return new RegExp(`(^|[^a-zA-Z0-9])(${core})(?![a-zA-Z0-9])`, "giu");
}

export function applySnippetReplacements(
  text: string,
  snippets: SnippetReplacement[] = getEffectiveSnippets()
): string {
  if (!text || !snippets.length) return text;

  let result = text;
  for (const snippet of snippets) {
    const pattern = buildFlexiblePattern(snippet.trigger);
    if (!pattern) continue;
    result = result.replace(pattern, (_match, prefix) => `${prefix}${snippet.replacement}`);
  }
  return result;
}
