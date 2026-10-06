import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { Globe, Check, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getSavedLanguage, saveLanguage } from "@/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  { code: "pt-BR", name: "Português (Brasil)", flag: "br" },
  { code: "zh", name: "简体中文", flag: "cn" },
  { code: "ja", name: "日本語", flag: "jp" },
] as const;

function detectBrowserLanguage(): string {
  const detector = new LanguageDetector();
  detector.init({ order: ["navigator"], caches: [] });
  const detected = detector.detect();
  const lang = Array.isArray(detected) ? detected[0] : detected;
  if (!lang) return "en";
  // Check for exact match first (e.g. "pt-BR")
  if (languages.some((l) => l.code === lang)) return lang;
  // Normalize e.g. "de-CH" -> "de"
  const base = lang.split("-")[0] ?? "en";
  return languages.some((l) => l.code === base) ? base : "en";
}

export function LanguageSwitcher({ mobile }: { mobile?: boolean }) {
  const { i18n, t } = useTranslation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

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

  const currentLabel = isAuto ? "Auto" : current.name;

  const [showScrollHint, setShowScrollHint] = useState(true);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  const containerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    scrollCleanupRef.current?.();
    scrollCleanupRef.current = null;
    if (!node) return;
    const viewport = node.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    const check = () => {
      setShowScrollHint(
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 8,
      );
    };
    check();
    viewport.addEventListener("scroll", check);
    scrollCleanupRef.current = () => viewport.removeEventListener("scroll", check);
  }, []);

  const filteredLanguages = languages.filter(
    (l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.code.toLowerCase().includes(search.toLowerCase()),
  );
  const showAuto = search === "" || "auto".includes(search.toLowerCase());

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("header.language")}
          className={cn(
            "inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mobile ? "w-full rounded-xl px-3 py-2.5" : "h-9 rounded-full px-2.5",
          )}
        >
          <Globe className="h-4 w-4" />
          <span className={cn(mobile ? "flex-1 text-left" : "text-xs font-semibold uppercase tracking-wide")}>
            {mobile ? currentLabel : isAuto ? "Auto" : current.code}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-56 p-0" align="end">
        <div className="p-1.5 pb-0">
          <div className="flex items-center gap-2 rounded-lg border border-input px-2.5 py-1.5 focus-within:border-primary">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={t("language.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>

        <DropdownMenuSeparator className="mx-0 mt-1.5 mb-0" />

        <div ref={containerCallbackRef} className="relative">
          <ScrollArea className="h-60">
            <div className="p-1.5">
              {showAuto && (
                <DropdownMenuItem onSelect={handleAuto} className={cn(isAuto && "font-medium")}>
                  <Globe />
                  <span className="flex-1">Auto</span>
                  {isAuto && <Check className="text-primary-text" />}
                </DropdownMenuItem>
              )}

              {showAuto && filteredLanguages.length > 0 && <DropdownMenuSeparator />}

              {filteredLanguages.map((lang) => {
                const selected = !isAuto && lang.code === current.code;
                return (
                  <DropdownMenuItem
                    key={lang.code}
                    onSelect={() => handleSelect(lang.code)}
                    className={cn(selected && "font-medium")}
                  >
                    <span className={`fi fi-${lang.flag} rounded-sm`} />
                    <span className="flex-1">{lang.name}</span>
                    {selected && <Check className="text-primary-text" />}
                  </DropdownMenuItem>
                );
              })}
            </div>
          </ScrollArea>
          {showScrollHint && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 rounded-b-xl bg-linear-to-t from-popover to-transparent" />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
