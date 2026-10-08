"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type Translator } from "@/i18n/translate";
import { localePath, type Locale } from "@/i18n/config";

const LocaleContext = createContext<Locale>("en");

/** The language of the page for the client components below it. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** The translator and a path helper for the language of the page. */
export function useI18n(): { t: Translator; locale: Locale; path: (p: string) => string } {
  const locale = useLocale();
  return useMemo(
    () => ({ t: createTranslator(locale), locale, path: (p: string) => localePath(locale, p) }),
    [locale]
  );
}
