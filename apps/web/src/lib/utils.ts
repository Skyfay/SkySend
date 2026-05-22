import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / k ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatTimeRemaining(expiresAt: string): string {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const seconds = Math.floor(remaining / 1000);
  if (seconds <= 0) return "expired";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Detect Safari (including all iOS browsers which use WebKit).
 * Matches Mozilla Send's approach: Safari is excluded from SW streaming.
 */
export function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|edg|opr|opera|brave/i.test(ua);
}

/** Detect Firefox. */
export function isFirefox(): boolean {
  return /firefox/i.test(navigator.userAgent);
}

/**
 * Detect whether browser DevTools are currently open by measuring the
 * difference between outer and inner window dimensions. A docked DevTools
 * panel (bottom/left/right) creates a gap larger than the threshold.
 *
 * Limitation: undocked DevTools in a separate window are not detectable.
 */
export function isDevToolsOpen(): boolean {
  const threshold = 160;
  return (
    window.outerWidth - window.innerWidth > threshold ||
    window.outerHeight - window.innerHeight > threshold
  );
}

/** 256 MB - files above this threshold show a warning on Safari */
export const SAFARI_BIG_SIZE = 256 * 1024 * 1024;

/**
 * Returns a human-readable browser name and major version string,
 * e.g. "Firefox 127", "Chrome 124", "Safari 17", "Edge 124".
 * Falls back to "Unknown Browser" if the UA cannot be parsed.
 */
export function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  const edgeMatch = ua.match(/Edg\/(\d+)/);
  if (edgeMatch) return `Edge ${edgeMatch[1]}`;
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  if (firefoxMatch) return `Firefox ${firefoxMatch[1]}`;
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  if (chromeMatch) return `Chrome ${chromeMatch[1]}`;
  const safariMatch = ua.match(/Version\/(\d+).*Safari/);
  if (safariMatch) return `Safari ${safariMatch[1]}`;
  return "Unknown Browser";
}
