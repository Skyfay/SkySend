import React, { createContext, useContext, useMemo } from "react";

/** The SkySend green, oklch(0.750 0.130 167.275) like the web, before a server is chosen. */
export const DEFAULT_ACCENT = "#46c89d";

/**
 * The dark Graphite theme of the web app (apps/web/src/styles/theme-graphite.css). The TUI paints
 * the whole screen with it, so every text sets its own color: the terminal's default may be dark.
 */
export const COLORS = {
  page: "#101012",
  card: "#1b1b1e",
  well: "#141416",
  button: "#26262a",
  line: "#2a2a2e",
  track: "#36363b",
  text: "#f2f2f3",
  muted: "#9c9ca4",
  faint: "#74747c",
  onAccent: "#000000",
  danger: "#f07171",
} as const;

interface Theme {
  accent: string;
  /** The accent mixed into a card, the background of a selected row. */
  tint: string;
}

const ThemeContext = createContext<Theme>({
  accent: DEFAULT_ACCENT,
  tint: mix(DEFAULT_ACCENT, COLORS.card, 0.16),
});

/** `share` of `hex` over `base`, both #rrggbb. */
function mix(hex: string, base: string, share: number): string {
  const parts = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const top = parts(hex);
  const bottom = parts(base);
  return `#${top
    .map((v, i) => Math.round(v * share + bottom[i]! * (1 - share)).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function useAccent(): string {
  return useContext(ThemeContext).accent;
}

export function useTint(): string {
  return useContext(ThemeContext).tint;
}

interface ThemeProviderProps {
  /** The server's customColor, which only counts when it is a plain #rrggbb. */
  color?: string | null;
  children: React.ReactNode;
}

export function ThemeProvider({ color, children }: ThemeProviderProps): React.ReactElement {
  const theme = useMemo(() => {
    const accent = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ACCENT;
    return { accent, tint: mix(accent, COLORS.card, 0.16) };
  }, [color]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
