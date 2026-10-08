import { INTL_LOCALE } from "@/i18n/config";
import type { Translator } from "@/i18n/translate";

/** "15 GB" or "1,5 MB", in the number format of the language. */
export function formatBytes(bytes: number | null, t: Translator): string {
  if (bytes === null || bytes === 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const number = new Intl.NumberFormat(INTL_LOCALE[t.locale], { maximumFractionDigits: 1 }).format(value);
  return `${number} ${units[i]}`;
}

/** "30 min", "1 hour" or "7 days". */
export function formatDuration(seconds: number | null, t: Translator): string {
  if (seconds === null) return "-";
  if (seconds < 3600) return t("units.minutes", { count: Math.round(seconds / 60) });
  if (seconds < 86400) return t("units.hours", { count: Math.round(seconds / 3600) });
  return t("units.days", { count: Math.round(seconds / 86400) });
}

/** "per 24 hours" or "per 7 days", for the window of an upload quota. */
export function formatWindow(seconds: number, t: Translator): string {
  if (seconds >= 172800 && seconds % 86400 === 0) return t("units.perDays", { count: seconds / 86400 });
  if (seconds >= 3600) return t("units.perHours", { count: Math.round(seconds / 3600) });
  return t("units.perMinutes", { count: Math.max(1, Math.round(seconds / 60)) });
}

export function formatCount(n: number | null, t: Translator): string {
  if (n === null) return "-";
  if (n === 0) return t("units.unlimited");
  return new Intl.NumberFormat(INTL_LOCALE[t.locale]).format(n);
}

/** "12 min ago" or "vor 3 Stunden", for when something was last checked. */
export function formatRelative(iso: string, t: Translator): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return t("units.justNow");
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[t.locale], { numeric: "auto" });
  if (mins < 60) return rtf.format(-mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}
