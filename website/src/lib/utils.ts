import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { INTL_LOCALE, type Locale } from "@/i18n/config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "Aug 8, 2026" or "8. Aug. 2026" from "2026-08-08", the same on the server and in every time zone. */
export function formatDate(date: string, locale: Locale = "en"): string {
  return new Date(date).toLocaleDateString(INTL_LOCALE[locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
