/**
 * Derives every shade of the accent color from one hex color, so CUSTOM_COLOR can be any
 * color and text on and next to it stays readable.
 *
 * - base: buttons, switches, progress bars. The operator's color, unchanged.
 * - foreground: text and icons on base, white or black, whichever contrasts more. One of
 *   the two always reaches 4.5:1, which near-black instead of black would miss.
 * - text: the accent as text on the page, darkened in light mode and lightened in dark
 *   mode until it reaches TEXT_CONTRAST against the surfaces it sits on.
 * - soft, line, glow: translucent tints for selected states, outlines and glows.
 */

type Rgb = readonly [number, number, number];

export interface AccentShades {
  base: string;
  foreground: string;
  text: string;
  soft: string;
  line: string;
  glow: string;
}

export interface Accent {
  light: AccentShades;
  dark: AccentShades;
}

/** SkySend green. Dark mode uses a lighter shade of it unless an operator sets a color. */
export const DEFAULT_ACCENT_LIGHT = "#2eb68c";
export const DEFAULT_ACCENT_DARK = "#46c89d";

/** WCAG AA for normal text, with a little room for tinted page backgrounds. */
export const TEXT_CONTRAST = 4.8;

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
// The lightest surface accent text sits on in each mode. Reaching the contrast here
// means it is reached on every darker (light mode) or lighter (dark mode) surface too.
const LIGHT_SURFACE: Rgb = [255, 255, 255];
const DARK_SURFACE: Rgb = [30, 30, 34];

export function parseHex(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const at = (i: 0 | 1 | 2) => Math.round(from[i] + (to[i] - from[i]) * amount);
  return [at(0), at(1), at(2)];
}

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Moves a color toward black or white in small steps until it reads on the surface. */
function readableOn(color: Rgb, surface: Rgb, toward: Rgb): Rgb {
  let result = color;
  for (let step = 1; step <= 40 && contrast(result, surface) < TEXT_CONTRAST; step += 1) {
    result = mix(color, toward, step / 40);
  }
  return result;
}

function shades(base: Rgb, mode: "light" | "dark"): AccentShades {
  const foreground = contrast(base, WHITE) >= contrast(base, BLACK) ? WHITE : BLACK;
  const text = mode === "light"
    ? readableOn(base, LIGHT_SURFACE, BLACK)
    : readableOn(base, DARK_SURFACE, WHITE);
  return {
    base: toHex(base),
    foreground: toHex(foreground),
    text: toHex(text),
    soft: rgba(base, mode === "light" ? 0.12 : 0.16),
    line: rgba(base, mode === "light" ? 0.42 : 0.5),
    glow: rgba(base, mode === "light" ? 0.28 : 0.22),
  };
}

/**
 * The accent for both color schemes. With one color (CUSTOM_COLOR) both schemes use it
 * as their base. Without one, SkySend green with its lighter dark-mode shade.
 */
export function deriveAccent(color?: string | null): Accent {
  const light = parseHex(color ?? DEFAULT_ACCENT_LIGHT);
  const dark = parseHex(color ?? DEFAULT_ACCENT_DARK);
  return { light: shades(light, "light"), dark: shades(dark, "dark") };
}

function declarations(s: AccentShades): string {
  return [
    `--color-primary: ${s.base};`,
    `--color-primary-foreground: ${s.foreground};`,
    `--color-primary-text: ${s.text};`,
    `--color-primary-soft: ${s.soft};`,
    `--color-primary-line: ${s.line};`,
    `--color-primary-glow: ${s.glow};`,
    `--color-ring: ${s.base};`,
  ].join(" ");
}

/** The CSS that applies an accent, for a style element appended after the stylesheet. */
export function accentCss(accent: Accent): string {
  return `:root { ${declarations(accent.light)} }\n.dark { ${declarations(accent.dark)} }`;
}
