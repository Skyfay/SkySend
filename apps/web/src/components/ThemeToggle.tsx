import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const label =
    theme === "dark"
      ? t("theme.dark")
      : theme === "light"
        ? t("theme.light")
        : t("theme.system");

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={label}
    >
      {theme === "dark" ? (
        <Moon className="h-5 w-5" />
      ) : theme === "light" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Monitor className="h-5 w-5" />
      )}
    </Button>
  );
}
