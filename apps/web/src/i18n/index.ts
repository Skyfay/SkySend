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
import ptBR from "./pt-BR.json";
import zh from "./zh.json";
import ja from "./ja.json";

const STORAGE_KEY = "skysend-lang";

// Storage access throws when site data is blocked. This module runs before React
// mounts, so a throw here would leave a blank page instead of browser detection.
export function getSavedLanguage(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value !== "auto" ? value : null;
  } catch {
    return null;
  }
}

export function saveLanguage(code: string) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // The choice still applies for this page view, it just is not remembered.
  }
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
      "pt-BR": { translation: ptBR },
      zh: { translation: zh },
      ja: { translation: ja },
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
