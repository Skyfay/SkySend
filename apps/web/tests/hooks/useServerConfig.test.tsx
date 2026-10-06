// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { ServerConfigProvider, useServerConfig } from "../../src/hooks/useServerConfig";
import { accentCss, deriveAccent } from "../../src/lib/accent";

// The real fetchConfig() parses the response with the real Zod schema, so a payload that
// drifts from what the server sends fails here instead of passing silently.
const payload = {
  enabledServices: ["file", "note"],
  fileMaxSize: 2147483648,
  fileMaxFilesPerUpload: 32,
  fileExpireOptions: [300, 3600, 86400, 604800],
  fileDefaultExpire: 86400,
  fileDownloadOptions: [1, 2, 3, 4, 5, 10, 20, 50, 100],
  fileDefaultDownload: 1,
  fileUploadQuotaBytes: 0,
  fileUploadQuotaWindow: 86400,
  fileUploadConcurrentChunks: 3,
  noteMaxSize: 1048576,
  noteExpireOptions: [300, 3600, 86400, 604800],
  noteDefaultExpire: 86400,
  noteViewOptions: [0, 1, 2, 3, 5, 10, 20, 50, 100],
  noteDefaultViews: 0,
  customTitle: "SkySend",
  customColor: null,
  customLogo: null,
  customPrivacy: null,
  customLegal: null,
  customLinkUrl: null,
  customLinkName: null,
  customReportUrl: null,
  defaultTheme: "graphite",
  defaultColorScheme: "system",
};

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  );
}

const wrapper = ({ children }: { children: ReactNode }) => <ServerConfigProvider>{children}</ServerConfigProvider>;
const render = () => renderHook(() => useServerConfig(), { wrapper });
const styles = () => Array.from(document.head.querySelectorAll("style"));

beforeEach(() => {
  document.head.innerHTML = '<link rel="icon" href="/favicon.svg">';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useServerConfig", () => {
  it("loads the config from the server", async () => {
    respondWith(payload);
    const { result } = render();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config?.customTitle).toBe("SkySend");
    expect(result.current.error).toBeNull();
  });

  it("injects every accent shade derived from CUSTOM_COLOR", async () => {
    respondWith({ ...payload, customColor: "#ff6b35" });
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(styles()).toHaveLength(1);
    expect(styles()[0]!.textContent).toBe(accentCss(deriveAccent("#ff6b35")));
  });

  it("leaves the built-in green alone when no CUSTOM_COLOR is set", async () => {
    respondWith(payload);
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(styles()).toHaveLength(0);
  });

  it("uses CUSTOM_LOGO as the favicon", async () => {
    respondWith({ ...payload, customLogo: "/branding/logo.svg" });
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(document.querySelector("link[rel='icon']")?.getAttribute("href")).toBe("/branding/logo.svg");
  });

  it("skips the favicon when the page has no icon link", async () => {
    document.head.innerHTML = "";
    respondWith({ ...payload, customLogo: "/branding/logo.svg" });
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(document.querySelector("link[rel='icon']")).toBeNull();
  });

  it("keeps the default theme when a server from before v3 sends a color scheme", async () => {
    const { defaultColorScheme: _scheme, ...old } = payload;
    respondWith({ ...old, defaultTheme: "dark" });
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config?.defaultTheme).toBe("graphite");
    expect(result.current.config?.defaultColorScheme).toBe("system");
  });

  it("reports why the config could not be loaded", async () => {
    respondWith({ error: "Service unavailable" }, 503);
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toBeNull();
    expect(result.current.error).toBe("Service unavailable");
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject("offline")));
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load config");
  });

  it("ignores a failure that arrives after the provider unmounted", async () => {
    let fail!: (reason: unknown) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((_resolve, reject) => (fail = reject)));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = render();
    unmount();

    fail(new Error("too late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.error).toBeNull();
  });

  it("ignores a response that arrives after the provider unmounted", async () => {
    let answer!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render();
    unmount();

    answer(new Response(JSON.stringify({ ...payload, customColor: "#ff6b35" }), { status: 200 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(styles()).toHaveLength(0);
  });
});
