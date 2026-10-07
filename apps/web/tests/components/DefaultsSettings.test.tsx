// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { DefaultsSettings } from "../../src/components/DefaultsSettings.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import type { ServerConfig } from "../../src/lib/api.js";
import { readDefaults, writeDefaults } from "../../src/lib/defaults.js";

const config = {
  enabledServices: ["file", "note"],
  fileExpireOptions: [3600, 86_400],
  fileDefaultExpire: 86_400,
  fileDownloadOptions: [1, 5, 10],
  fileDefaultDownload: 1,
  noteExpireOptions: [3600],
  noteDefaultExpire: 3600,
  noteViewOptions: [0, 1],
  noteDefaultViews: 1,
  fileRequestsEnabled: true,
  fileRequestExpireOptions: [86_400],
  fileRequestDefaultExpire: 86_400,
  fileRequestUploadOptions: [1, 2, 3, 5, 10, 20],
  fileRequestDefaultUploads: 10,
  fileRequestDownloadOptions: [1, 2, 5],
  fileRequestDefaultDownloads: 5,
  fileRequestMaxSize: 1024 ** 3,
  forceFilePassword: false,
  forceRequestPassword: false,
  forceNotePassword: true,
} as ServerConfig;

function show(overrides: Partial<ServerConfig> = {}) {
  render(
    createElement(
      TooltipProvider,
      null,
      createElement(DefaultsSettings, { config: { ...config, ...overrides } }),
    ),
  );
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  writeDefaults({ file: {}, note: {}, request: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DefaultsSettings", () => {
  it("shows a section for each thing the server offers", () => {
    show();
    expect(screen.getByText("settings.files")).toBeTruthy();
    expect(screen.getByText("settings.notes")).toBeTruthy();
    expect(screen.getByText("settings.requests")).toBeTruthy();
    cleanup();
    show({ enabledServices: ["note"], fileRequestsEnabled: false });
    expect(screen.queryByText("settings.files")).toBeNull();
    expect(screen.queryByText("settings.requests")).toBeNull();
  });

  it("keeps a changed value in this browser, and resets a section to the server's", () => {
    show();
    expect(screen.queryByText("settings.reset")).toBeNull();
    const [filePassword] = screen.getAllByRole("switch");
    fireEvent.click(filePassword!);
    expect(readDefaults().file).toEqual({ password: true });
    fireEvent.click(screen.getByText("settings.reset"));
    expect(readDefaults().file).toEqual({});
    expect(screen.queryByText("settings.reset")).toBeNull();
  });

  it("offers no switch for a password the server asks for", () => {
    show();
    // Files and requests have a switch, notes are forced.
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByText("upload.passwordRequired")).toBeTruthy();
  });
});
