"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/provider";

const BOX = "btn-chip flex size-9 items-center justify-center rounded-lg";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  // next-themes can resolve `resolvedTheme` synchronously on the client's
  // first render (before hydration completes), which no longer matches the
  // server-rendered placeholder. A dedicated `mounted` flag set in an effect
  // guarantees the first client render always matches the server.
  const [mounted, setMounted] = useState(false);

  // Intentional client-only mount flag (the documented next-themes
  // hydration-mismatch fix), not a derived-state anti-pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <span aria-hidden="true" className={BOX} />;
  }

  const isDark = resolvedTheme === "dark";
  const label = isDark ? t("nav.switchToLight") : t("nav.switchToDark");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className={BOX}
        >
          {isDark ? (
            <Sun className="size-4 text-tone-amber" />
          ) : (
            <Moon className="size-4 text-tone-violet" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
