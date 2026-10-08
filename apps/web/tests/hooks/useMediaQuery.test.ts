// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "../../src/hooks/useMediaQuery.js";

/** A media query list whose state the test switches, telling its listeners like a browser. */
function stubMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches: initial };
  vi.stubGlobal("matchMedia", (media: string) => ({
    get matches() {
      return state.matches;
    },
    media,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    listeners,
    set(matches: boolean) {
      state.matches = matches;
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("follows the query as the window changes", () => {
    const media = stubMedia(true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const media = stubMedia(false);
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
