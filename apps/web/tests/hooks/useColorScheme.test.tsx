// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ColorSchemeProvider, useColorScheme } from "../../src/hooks/useColorScheme";

const KEY = "skysend-color-scheme";

// This jsdom build ships localStorage without its methods and no matchMedia, so both are
// stubbed: a Map for storage and a media query whose answer and listeners the test controls.
let store: Map<string, string>;
let osDark: boolean;
let listeners: Array<() => void>;

function stubStorage(overrides: Partial<Storage> = {}) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    ...overrides,
  });
}

beforeEach(() => {
  store = new Map();
  osDark = false;
  listeners = [];
  stubStorage();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return osDark;
    },
    addEventListener: (_event: string, listener: () => void) => listeners.push(listener),
    removeEventListener: (_event: string, listener: () => void) => {
      listeners = listeners.filter((l) => l !== listener);
    },
  }));
  document.documentElement.className = "";
  delete document.documentElement.dataset.defaultColorScheme;
  document.head.innerHTML = '<meta name="theme-color" content="">';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: ReactNode }) => <ColorSchemeProvider>{children}</ColorSchemeProvider>;
const render = () => renderHook(() => useColorScheme(), { wrapper });
const isDark = () => document.documentElement.classList.contains("dark");
const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
const osChanges = (dark: boolean) =>
  act(() => {
    osDark = dark;
    listeners.forEach((listener) => listener());
  });

describe("useColorScheme", () => {
  it("starts with the scheme the visitor picked before", () => {
    store.set(KEY, "dark");
    const { result } = render();

    expect(result.current.colorScheme).toBe("dark");
    expect(isDark()).toBe(true);
    expect(themeColor()).toBe("#09090b");
  });

  it("falls back to the server default without storing it", () => {
    document.documentElement.dataset.defaultColorScheme = "light";
    osDark = true;
    const { result } = render();

    expect(result.current.colorScheme).toBe("light");
    expect(isDark()).toBe(false);
    expect(themeColor()).toBe("#ffffff");
    expect(store.has(KEY)).toBe(false);
  });

  it("ignores a stored value that is not a color scheme", () => {
    store.set(KEY, "purple");
    document.documentElement.dataset.defaultColorScheme = "dark";

    expect(render().result.current.colorScheme).toBe("dark");
  });

  it("follows the operating system when neither the visitor nor the server picked one", () => {
    osDark = true;
    const { result } = render();

    expect(result.current.colorScheme).toBe("system");
    expect(isDark()).toBe(true);
  });

  it("stores an explicit choice and applies it at once", () => {
    const { result } = render();

    act(() => result.current.setColorScheme("dark"));
    expect(store.get(KEY)).toBe("dark");
    expect(isDark()).toBe(true);

    act(() => result.current.setColorScheme("light"));
    expect(store.get(KEY)).toBe("light");
    expect(isDark()).toBe(false);
  });

  it("switches along when the operating system changes while set to system", () => {
    render();
    expect(isDark()).toBe(false);

    osChanges(true);
    expect(isDark()).toBe(true);
    expect(themeColor()).toBe("#09090b");
  });

  it("keeps an explicit choice when the operating system changes", () => {
    store.set(KEY, "light");
    render();

    osChanges(true);
    expect(isDark()).toBe(false);
  });

  it("still applies a choice when the browser blocks storage", () => {
    stubStorage({
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    document.documentElement.dataset.defaultColorScheme = "light";
    const { result } = render();
    expect(result.current.colorScheme).toBe("light");

    act(() => result.current.setColorScheme("dark"));
    expect(result.current.colorScheme).toBe("dark");
    expect(isDark()).toBe(true);
  });

  it("refuses to work outside its provider", () => {
    // React reports the thrown error to the console before rethrowing it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useColorScheme())).toThrow("ColorSchemeProvider");
  });
});
