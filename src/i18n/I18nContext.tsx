import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_UI_LANGUAGE, normalizeUILanguage, type UILanguage } from "./types";
import { TRANSLATIONS } from "./translations";

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export interface I18nContextValue {
  language: UILanguage;
  setLanguage: (lang: UILanguage) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "uiLanguage";
const CHANNEL_NAME = "openwhispr:i18n";

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<UILanguage>(() => {
    try {
      return normalizeUILanguage(localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT_UI_LANGUAGE;
    }
  });

  const setLanguage = useCallback((lang: UILanguage) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }

    try {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage({ type: "uiLanguage", value: lang });
        channel.close();
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const handler = (event: MessageEvent) => {
      const message = event?.data as { type?: unknown; value?: unknown };
      if (message?.type !== "uiLanguage") return;
      const next = normalizeUILanguage(message.value);
      setLanguageState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  }, []);

  const t: TFunction = useCallback(
    (key, vars) => {
      const table = TRANSLATIONS[language] || TRANSLATIONS.en;
      const fallback = TRANSLATIONS.en;
      const raw = table[key] ?? fallback[key] ?? key;
      return interpolate(raw, vars);
    },
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
