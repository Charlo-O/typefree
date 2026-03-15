export type UILanguage = "en" | "zh-CN";

export const DEFAULT_UI_LANGUAGE: UILanguage = "zh-CN";

function detectSystemLanguage(): UILanguage {
  try {
    const langs = navigator.languages ?? [navigator.language];
    for (const lang of langs) {
      if (typeof lang === "string" && /^zh\b/i.test(lang)) return "zh-CN";
    }
  } catch {
    // ignore
  }
  return "en";
}

export function normalizeUILanguage(value: unknown): UILanguage {
  if (value === "zh-CN") return "zh-CN";
  if (value === "en") return "en";
  // No explicit value stored — detect from system language
  return detectSystemLanguage();
}

export const UI_LANGUAGE_OPTIONS: Array<{ value: UILanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];
