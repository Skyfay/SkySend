import { useTranslation } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Globe, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSavedLanguage, saveLanguage } from "@/i18n";

const languages = [
  { code: "en", name: "English", flag: "us" },
  { code: "de", name: "Deutsch", flag: "de" },
  { code: "es", name: "Español", flag: "es" },
  { code: "fr", name: "Français", flag: "fr" },
  { code: "it", name: "Italiano", flag: "it" },
  { code: "nl", name: "Nederlands", flag: "nl" },
  { code: "pl", name: "Polski", flag: "pl" },
  { code: "fi", name: "Suomi", flag: "fi" },
  { code: "sv", name: "Svenska", flag: "se" },
  { code: "nb", name: "Norsk Bokmål", flag: "no" },
] as const;

function detectBrowserLanguage(): string {
  const detector = new LanguageDetector();
  detector.init({ order: ["navigator"], caches: [] });
  const detected = detector.detect();
  const lang = Array.isArray(detected) ? detected[0] : detected;
  // Normalize e.g. "de-CH" -> "de"
  const base = lang?.split("-")[0] ?? "en";
  return languages.some((l) => l.code === base) ? base : "en";
}

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const isAuto = !getSavedLanguage();
  const resolvedLang = i18n.resolvedLanguage ?? i18n.language;
  const current = languages.find((l) => l.code === resolvedLang) ?? languages[0];

  const handleSelect = (code: string) => {
    saveLanguage(code);
    i18n.changeLanguage(code);
  };

  const handleAuto = () => {
    saveLanguage("auto");
    const browserLang = detectBrowserLanguage();
    i18n.changeLanguage(browserLang);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none"
          aria-label="Change language"
        >
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline uppercase">{current.code}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="end"
        >
          <DropdownMenu.Item
            className={cn(
              "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
              isAuto && "bg-accent/50",
            )}
            onSelect={handleAuto}
          >
            <Globe className="h-4 w-4" />
            <span className="flex-1">Auto</span>
            {isAuto && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          {languages.map((lang) => (
            <DropdownMenu.Item
              key={lang.code}
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                !isAuto && lang.code === current.code && "bg-accent/50",
              )}
              onSelect={() => handleSelect(lang.code)}
            >
              <span className={`fi fi-${lang.flag} rounded-sm`} />
              <span className="flex-1">{lang.name}</span>
              {!isAuto && lang.code === current.code && (
                <Check className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
