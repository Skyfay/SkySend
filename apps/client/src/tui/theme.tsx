import React, { createContext, useContext } from "react";

// oklch(0.750 0.130 167.275) - matches web primary color
const DEFAULT_ACCENT = "#46c89d";

const ThemeContext = createContext<string>(DEFAULT_ACCENT);

export function useAccent(): string {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  color?: string | null;
  children: React.ReactNode;
}

export function ThemeProvider({ color, children }: ThemeProviderProps): React.ReactElement {
  const accent = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ACCENT;
  return (
    <ThemeContext.Provider value={accent}>
      {children}
    </ThemeContext.Provider>
  );
}
