import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./en.json";
import de from "./de.json";
import es from "./es.json";
import fr from "./fr.json";
import fi from "./fi.json";
import sv from "./sv.json";
import nb from "./nb.json";
import nl from "./nl.json";
import it from "./it.json";
import pl from "./pl.json";

const COOKIE_NAME = "skysend-lang";

export function getSavedLanguage(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  const value = match?.[1] ?? null;
  if (value === "auto" || !value) return null;
  return value;
}

export function saveLanguage(code: string) {
  const maxAge = 365 * 24 * 60 * 60; // 1 year
  document.cookie = `${COOKIE_NAME}=${code}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      es: { translation: es },
      fr: { translation: fr },
      fi: { translation: fi },
      sv: { translation: sv },
      nb: { translation: nb },
      nl: { translation: nl },
      it: { translation: it },
      pl: { translation: pl },
    },
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["navigator", "htmlTag"],
      caches: [],
    },
  });

// Apply saved language preference (overrides browser detection)
const saved = getSavedLanguage();
if (saved) {
  i18n.changeLanguage(saved);
}

export default i18n;
