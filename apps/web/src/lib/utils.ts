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

/** Detect Firefox (excludes SeaMonkey and other Gecko-based browsers). */
export function isFirefox(): boolean {
  const ua = navigator.userAgent;
  return /firefox/i.test(ua) && !/seamonkey/i.test(ua);
}

/**
 * Heuristic check for docked Firefox DevTools using window dimension deltas.
 *
 * When DevTools is docked (bottom or side panel), the browser outer dimensions
 * stay fixed while the inner viewport shrinks by the panel size (~300 px).
 * Normal browser chrome (tabs + address bar) accounts for ~74-100 px of height
 * delta, so a threshold of 200 px for height and 160 px for width leaves a
 * comfortable margin.
 *
 * Limitations:
 * - Does NOT detect undocked (floating window) DevTools.
 * - Responsive Design Mode also shrinks the viewport, but that mode itself
 *   requires DevTools to be open, so it is correct to warn then too.
 */
export function isFirefoxDevToolsOpen(): boolean {
  if (!isFirefox()) return false;
  return (
    window.outerWidth - window.innerWidth > 160 ||
    window.outerHeight - window.innerHeight > 200
  );
}

/** 256 MB - files above this threshold show a warning on Safari */
export const SAFARI_BIG_SIZE = 256 * 1024 * 1024;

/** 256 MB - files above this threshold show a DevTools warning on Firefox */
export const FIREFOX_DEVTOOLS_BIG_SIZE = 256 * 1024 * 1024;
