// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { DebugPanel } from "../../src/components/DebugPanel.js";
import type { DownloadDebugInfo } from "../../src/lib/download-tiers.js";
import type { UploadDebugInfo } from "../../src/hooks/useUpload.js";

const upload: UploadDebugInfo = {
  transport: "ws",
  fallback: false,
  storage: "filesystem",
  browser: "Safari 27",
  events: [
    { time: "2026-10-08T15:42:02.000Z", message: "WebSocket transport active" },
    { time: "2026-10-08T15:42:02.009Z", message: "Filesystem upload active" },
    { time: "2026-10-08T15:42:02.418Z", message: "Upload complete", detail: "Ø 240.6 MB/s" },
  ],
};

const download: DownloadDebugInfo = {
  tier: "sw",
  swPath: "stream",
  browser: "Firefox 140",
  devtools: true,
  fileSize: 26_000_000,
  events: [
    { time: "2026-10-08T15:44:10.000Z", message: "SW stream started" },
    { time: "2026-10-08T15:44:12.400Z", message: "Download complete", detail: "Ø 96.1 MB/s" },
  ],
};

afterEach(cleanup);

const toggle = () => screen.getByRole("button", { name: /debug\.title/ });

describe("DebugPanel", () => {
  it("renders nothing without any debug info", () => {
    const { container } = render(<DebugPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("sums up the upload while closed and opens on the row", () => {
    render(<DebugPanel uploadInfo={upload} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getByText("debug.transportWs · debug.storageFilesystem · Safari 27"),
    ).toBeTruthy();
    expect(screen.queryByText("debug.timeline")).toBeNull();

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("debug.storage")).toBeTruthy();
    expect(screen.getByText("debug.timeline")).toBeTruthy();
  });

  it("shows each event after the first one, with its detail beside it", () => {
    render(<DebugPanel uploadInfo={upload} />);
    fireEvent.click(toggle());
    expect(screen.getByText("+0 ms")).toBeTruthy();
    expect(screen.getByText("+9 ms")).toBeTruthy();
    expect(screen.getByText("+418 ms")).toBeTruthy();
    expect(screen.getByText("Ø 240.6 MB/s")).toBeTruthy();
  });

  it("names a WebSocket that fell back to HTTP", () => {
    render(<DebugPanel uploadInfo={{ ...upload, transport: "http", fallback: true }} />);
    expect(screen.getByText("debug.fallbackWsFailed")).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.getAllByText("debug.fallbackWsFailed")).toHaveLength(2);
  });

  it("warns about open DevTools on a download, already in the closed row", () => {
    render(<DebugPanel downloadInfo={download} />);
    expect(screen.getByText("debug.devtoolsOpen")).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.getByText("debug.devtoolsWarningTitle")).toBeTruthy();
    expect(screen.getByText("debug.swPathStream")).toBeTruthy();
    expect(screen.getByText("+2.4 s")).toBeTruthy();
  });

  it("marks a failed upload in the row and its reason in the timeline", () => {
    const failed: UploadDebugInfo = {
      ...upload,
      events: [
        upload.events[0]!,
        {
          time: "2026-10-08T15:42:03.000Z",
          message: "Upload failed",
          detail: "Origin not allowed",
          failed: true,
        },
      ],
    };
    render(<DebugPanel uploadInfo={failed} />);
    expect(screen.getByText("debug.failed")).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.getByText("Origin not allowed")).toBeTruthy();
    expect(screen.getByText("+1.0 s")).toBeTruthy();
  });

  it("copies the debug info as JSON", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DebugPanel uploadInfo={upload} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: /common\.copy/ }));
    expect(JSON.parse(writeText.mock.calls[0]![0] as string)).toEqual({ upload });
    expect(await screen.findByText("common.copied")).toBeTruthy();
  });
});
