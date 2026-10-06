import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ColorScheme = "dark" | "light" | "system";

interface ColorSchemeContextValue {
  colorScheme: ColorScheme;
  setColorScheme: (colorScheme: ColorScheme) => void;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue | undefined>(undefined);

const STORAGE_KEY = "skysend-color-scheme";

function getSystemScheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function isColorScheme(value: string | null | undefined): value is ColorScheme {
  return value === "dark" || value === "light" || value === "system";
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Same resolution order as public/theme-init.js, which applies it before the first
// paint: stored preference, then the server DEFAULT_COLOR_SCHEME injected into index.html.
function getInitialScheme(): ColorScheme {
  const stored = readStored();
  if (isColorScheme(stored)) return stored;
  const serverDefault = document.documentElement.dataset.defaultColorScheme;
  return isColorScheme(serverDefault) ? serverDefault : "system";
}

function applyScheme(colorScheme: ColorScheme) {
  const resolved = colorScheme === "system" ? getSystemScheme() : colorScheme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#09090b" : "#ffffff");
}

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const [colorScheme, setSchemeState] = useState<ColorScheme>(getInitialScheme);

  useEffect(() => {
    applyScheme(colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (colorScheme === "system") applyScheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [colorScheme]);

  // Only an explicit choice in the UI is stored. The server default stays unstored,
  // so a later change of DEFAULT_COLOR_SCHEME still reaches returning visitors.
  const setColorScheme = useCallback((next: ColorScheme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage is blocked. The choice still applies until the page is reloaded.
    }
    setSchemeState(next);
  }, []);

  return (
    <ColorSchemeContext.Provider value={{ colorScheme, setColorScheme }}>
      {children}
    </ColorSchemeContext.Provider>
  );
}

export function useColorScheme() {
  const context = useContext(ColorSchemeContext);
  if (!context) throw new Error("useColorScheme must be used within ColorSchemeProvider");
  return context;
}
