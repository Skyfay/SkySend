import { Moon, Sun, Contrast, ChevronDown, Check } from "lucide-react";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

const schemes = [
  { value: "system", icon: Contrast },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

export function ColorSchemeToggle({ mobile }: { mobile?: boolean }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const { t } = useTranslation();

  const current = schemes.find((s) => s.value === colorScheme) ?? schemes[0];
  const CurrentIcon = current.icon;

  const label = (value: string) => t(`colorScheme.${value}`);

  const trigger = mobile ? (
    <button
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none"
      aria-label={label(colorScheme)}
    >
      <CurrentIcon className="h-4 w-4" />
      <span className="flex-1 text-left">{label(colorScheme)}</span>
      <ChevronDown className="h-3.5 w-3.5 opacity-50 mr-1" />
    </button>
  ) : (
    <button
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none"
      aria-label={label(colorScheme)}
    >
      <CurrentIcon className="h-4 w-4" />
      <span className="hidden sm:inline">{label(colorScheme)}</span>
      <ChevronDown className="h-3 w-3 opacity-50" />
    </button>
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-35 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="end"
        >
          {schemes.map(({ value, icon: Icon }) => (
            <DropdownMenu.Item
              key={value}
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                value === colorScheme && "bg-accent/50",
              )}
              onSelect={() => setColorScheme(value)}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label(value)}</span>
              {value === colorScheme && (
                <Check className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
