import { getCountryCode, getFlagClass } from "@/lib/countries";
import { cn } from "@/lib/utils";
import "flag-icons/css/flag-icons.min.css";

/**
 * The flag of the country of an instance as a rounded square, or its code for
 * a country flag-icons does not know. The flags ship with the site, no request
 * leaves it for them.
 */
export function CountryFlag({ country, emoji, size = 38 }: { country: string; emoji?: string; size?: number }) {
  const flag = getFlagClass(country, emoji);
  if (flag) {
    // flag-icons sets the width of .fi itself, so the size goes inline to win over it.
    return (
      <span
        aria-hidden="true"
        className={cn("fi fis shrink-0 rounded-[10px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12),var(--chip-shadow)]", flag)}
        style={{ width: size, height: size, backgroundSize: "cover" }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-accent text-xs font-semibold shadow-[var(--chip-shadow)]"
      style={{ width: size, height: size }}
    >
      {getCountryCode(country) ?? "?"}
    </span>
  );
}
