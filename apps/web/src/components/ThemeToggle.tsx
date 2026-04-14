import { Moon, Sun, Contrast, ChevronDown, Check } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

const themes = [
  { value: "system", icon: Contrast },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const current = themes.find((th) => th.value === theme) ?? themes[0];
  const CurrentIcon = current.icon;

  const label = (value: string) =>
    value === "system" ? "Auto" : t(`theme.${value}`);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none"
          aria-label={label(theme)}
        >
          <CurrentIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{label(theme)}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[140px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="end"
        >
          {themes.map(({ value, icon: Icon }) => (
            <DropdownMenu.Item
              key={value}
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                value === theme && "bg-accent/50",
              )}
              onSelect={() => setTheme(value)}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label(value)}</span>
              {value === theme && (
                <Check className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
