// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, expect, it, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "../src/components/Toaster";
import { ColorSchemeProvider } from "../src/hooks/useColorScheme";

/**
 * A page can toast while it mounts, like the rewritten-link warning does. The Toaster
 * subscribes in a mount effect, and sibling effects run in tree order. App.tsx keeps
 * the Toaster ahead of the router, and since Sonner 2.0.8 a Toaster that subscribes
 * later also gets the toasts that are still active, so the warning arrives either way.
 */
function TogglesOnMount({ message }: { message: string }) {
  useEffect(() => {
    toast.warning(message);
  }, [message]);
  return null;
}

// ColorSchemeProvider reads a stored preference and the OS colour scheme on mount.
// This jsdom build ships localStorage without its methods and no matchMedia.
beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

// A toast that is still active would otherwise be replayed into the next test.
afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe("a toast fired while a page mounts", () => {
  it("is delivered when the Toaster mounts first, as App.tsx arranges it", async () => {
    render(
      <ColorSchemeProvider>
        <Toaster />
        <TogglesOnMount message="mounted-first" />
      </ColorSchemeProvider>,
    );

    expect(await screen.findByText("mounted-first")).toBeDefined();
  });

  it("is still delivered when the Toaster mounts after the page", async () => {
    render(
      <ColorSchemeProvider>
        <TogglesOnMount message="mounted-last" />
        <Toaster />
      </ColorSchemeProvider>,
    );

    expect(await screen.findByText("mounted-last")).toBeDefined();
  });
});
