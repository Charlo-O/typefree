import React, { createContext } from "react";

import type { UILanguage } from "./types";

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export interface I18nContextValue {
  language: UILanguage;
  setLanguage: (lang: UILanguage) => void;
  t: TFunction;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
