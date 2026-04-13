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

export default i18n;
