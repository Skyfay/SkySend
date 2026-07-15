export function formatBytes(bytes: number | null, unlimitedIfZero = false): string {
  if (bytes === null) return "-";
  if (bytes === 0) return unlimitedIfZero ? "Unlimited" : "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

export function formatCount(n: number | null): string {
  if (n === null) return "-";
  if (n === 0) return "Unlimited";
  return String(n);
}
