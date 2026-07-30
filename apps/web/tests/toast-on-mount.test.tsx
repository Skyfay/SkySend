// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, expect, it, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "../src/components/Toaster";
import { ThemeProvider } from "../src/hooks/useTheme";

/**
 * Sonner delivers a toast only to subscribers that exist at publish time, and its
 * Toaster subscribes in a mount effect. Sibling effects run in tree order, so a
 * page that toasts while mounting is only heard when the Toaster mounted first.
 *
 * The rewritten-link warning is exactly such a toast, which is why App.tsx keeps
 * the Toaster ahead of the router.
 */
function TogglesOnMount({ message }: { message: string }) {
  useEffect(() => {
    toast.warning(message);
  }, [message]);
  return null;
}

// ThemeProvider reads a stored preference and the OS colour scheme on mount.
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

afterEach(cleanup);

describe("a toast fired while a page mounts", () => {
  it("is delivered when the Toaster mounts first, as App.tsx arranges it", async () => {
    render(
      <ThemeProvider>
        <Toaster />
        <TogglesOnMount message="mounted-first" />
      </ThemeProvider>,
    );

    expect(await screen.findByText("mounted-first")).toBeDefined();
  });

  it("is lost when the Toaster mounts after the page, which is the bug this guards", async () => {
    render(
      <ThemeProvider>
        <TogglesOnMount message="mounted-last" />
        <Toaster />
      </ThemeProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("mounted-last")).toBeNull();
  });
});
