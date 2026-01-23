export type UILanguage = "en" | "zh-CN";

export const DEFAULT_UI_LANGUAGE: UILanguage = "en";

export function normalizeUILanguage(value: unknown): UILanguage {
  return value === "zh-CN" ? "zh-CN" : "en";
}

export const UI_LANGUAGE_OPTIONS: Array<{ value: UILanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];
