export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return plural(Math.round(seconds / 3600), "hour");
  return plural(Math.round(seconds / 86400), "day");
}

/** "per 24 hours" or "per 7 days", for the window of an upload quota. */
export function formatWindow(seconds: number): string {
  if (seconds >= 172800 && seconds % 86400 === 0) return `per ${seconds / 86400} days`;
  if (seconds >= 3600) return `per ${plural(Math.round(seconds / 3600), "hour")}`;
  return `per ${Math.max(1, Math.round(seconds / 60))} min`;
}

export function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function formatCount(n: number | null): string {
  if (n === null) return "-";
  if (n === 0) return "Unlimited";
  return String(n);
}
