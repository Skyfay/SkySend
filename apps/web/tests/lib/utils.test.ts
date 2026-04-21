import { describe, expect, it, vi, afterEach } from "vitest";
import { formatBytes, formatDuration, formatTimeRemaining, isSafari } from "../../src/lib/utils.js";

// ── formatBytes ──────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes with no decimal", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(100)).toBe("100 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes with 1 decimal place", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1023 * 1024)).toBe("1023.0 KB");
  });

  it("formats megabytes with 1 decimal place", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("formats gigabytes with 1 decimal place", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("caps at GB for very large values (no TB unit)", () => {
    // web version only has B/KB/MB/GB - caps at index 3
    const result = formatBytes(1024 * 1024 * 1024 * 1024);
    expect(result).toContain("GB");
    expect(result).not.toContain("TB");
  });
});

// ── formatDuration ────────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats seconds under 1 minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(1)).toBe("1s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("formats minutes (no seconds shown) for 1-59 minutes", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(3599)).toBe("59m");
  });

  it("formats hours (no minutes shown) for 1-23 hours", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(86399)).toBe("23h");
  });

  it("formats days for 1 day and above", () => {
    expect(formatDuration(86400)).toBe("1d");
    expect(formatDuration(86400 * 7)).toBe("7d");
  });
});

// ── formatTimeRemaining ───────────────────────────────────────────────────────

describe("formatTimeRemaining", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'expired' for a past timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    expect(formatTimeRemaining("2024-01-01T11:59:59.000Z")).toBe("expired");
    expect(formatTimeRemaining("2024-01-01T00:00:00.000Z")).toBe("expired");
  });

  it("returns 'expired' for exactly the current moment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    expect(formatTimeRemaining("2024-01-01T12:00:00.000Z")).toBe("expired");
  });

  it("formats remaining seconds under 1 minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    expect(formatTimeRemaining("2024-01-01T12:00:30.000Z")).toBe("30s");
    expect(formatTimeRemaining("2024-01-01T12:00:59.000Z")).toBe("59s");
  });

  it("formats remaining minutes (no seconds) for under 1 hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    expect(formatTimeRemaining("2024-01-01T12:05:00.000Z")).toBe("5m");
    expect(formatTimeRemaining("2024-01-01T12:59:00.000Z")).toBe("59m");
    // Partial minutes show only whole minutes
    expect(formatTimeRemaining("2024-01-01T12:05:30.000Z")).toBe("5m");
  });

  it("formats hours and optional minutes for under 1 day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    // Exactly 2 hours -> no minutes shown
    expect(formatTimeRemaining("2024-01-01T14:00:00.000Z")).toBe("2h");
    // 2h 30m
    expect(formatTimeRemaining("2024-01-01T14:30:00.000Z")).toBe("2h 30m");
    // 0 extra minutes -> no minutes part
    expect(formatTimeRemaining("2024-01-01T13:00:00.000Z")).toBe("1h");
  });

  it("formats days and optional hours for 1+ days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    // Exactly 3 days -> no hours shown
    expect(formatTimeRemaining("2024-01-04T12:00:00.000Z")).toBe("3d");
    // 3 days + 6 hours
    expect(formatTimeRemaining("2024-01-04T18:00:00.000Z")).toBe("3d 6h");
    // 0 extra hours -> no hours part
    expect(formatTimeRemaining("2024-01-02T12:00:00.000Z")).toBe("1d");
  });
});

// ── isSafari ──────────────────────────────────────────────────────────────────

describe("isSafari", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true for Safari on macOS", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
    });
    expect(isSafari()).toBe(true);
  });

  it("returns true for Safari on iOS", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    expect(isSafari()).toBe(true);
  });

  it("returns false for Chrome", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    expect(isSafari()).toBe(false);
  });

  it("returns false for Firefox", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    });
    expect(isSafari()).toBe(false);
  });

  it("returns false for Edge", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    });
    expect(isSafari()).toBe(false);
  });

  it("returns false for Brave (which also contains 'Safari' in UA)", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Brave/1.0",
    });
    expect(isSafari()).toBe(false);
  });
});
