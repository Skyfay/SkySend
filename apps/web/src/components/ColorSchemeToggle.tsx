import { Moon, Sun, Contrast } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useColorScheme, type ColorScheme } from "@/hooks/useColorScheme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const schemes = [
  { value: "system", icon: Contrast },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

function isColorScheme(value: string): value is ColorScheme {
  return schemes.some((s) => s.value === value);
}

export function ColorSchemeToggle({ mobile }: { mobile?: boolean }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const { t } = useTranslation();

  const current = schemes.find((s) => s.value === colorScheme) ?? schemes[0];
  const CurrentIcon = current.icon;
  const label = t(`colorScheme.${colorScheme}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mobile ? "w-full rounded-xl px-3 py-2.5" : "h-9 w-9 justify-center rounded-full",
          )}
        >
          <CurrentIcon className="h-4 w-4" />
          {mobile && <span className="flex-1 text-left">{label}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={colorScheme}
          onValueChange={(value) => {
            if (isColorScheme(value)) setColorScheme(value);
          }}
        >
          {schemes.map(({ value, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {t(`colorScheme.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
