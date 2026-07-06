import * as readline from "node:readline";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

vi.mock("node:readline", () => ({ createInterface: vi.fn() }));
import {
  formatBytes,
  formatSpeed,
  formatDuration,
  formatExpiry,
  parseDuration,
  renderProgress,
  clearLine,
  writeProgress,
  writeLine,
  promptPassword,
  type ProgressState,
} from "../../src/lib/progress.js";

// ── formatBytes ──────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats single bytes with 2 decimal places", () => {
    expect(formatBytes(1)).toBe("1.00 B");
  });

  it("formats 10-99 bytes with 1 decimal place", () => {
    expect(formatBytes(10)).toBe("10.0 B");
    expect(formatBytes(99)).toBe("99.0 B");
  });

  it("formats 100-1023 bytes with no decimal", () => {
    expect(formatBytes(100)).toBe("100 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(10 * 1024)).toBe("10.0 KB");
    expect(formatBytes(100 * 1024)).toBe("100 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });

  it("formats gigabytes correctly", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
  });

  it("formats terabytes correctly", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1.00 TB");
  });

  it("caps at TB for very large values", () => {
    // Larger than 1 TB - should remain in TB
    const result = formatBytes(2 * 1024 * 1024 * 1024 * 1024);
    expect(result).toContain("TB");
  });
});

// ── formatSpeed ──────────────────────────────────────────────────────────────

describe("formatSpeed", () => {
  it("appends /s suffix", () => {
    expect(formatSpeed(1024)).toBe("1.00 KB/s");
    expect(formatSpeed(0)).toBe("0 B/s");
  });
});

// ── formatDuration (client) ───────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats seconds under 1 minute with ceil", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(1)).toBe("1s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(59)).toBe("59s");
    // Fractional seconds are ceiled
    expect(formatDuration(45.2)).toBe("46s");
  });

  it("formats minutes and seconds between 1-59 minutes", () => {
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(150)).toBe("2m 30s");
    expect(formatDuration(3599)).toBe("59m 59s");
  });

  it("formats hours and minutes for 1+ hours", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3661)).toBe("1h 1m");
    expect(formatDuration(7200)).toBe("2h 0m");
    expect(formatDuration(7384)).toBe("2h 3m");
  });
});

// ── formatExpiry ──────────────────────────────────────────────────────────────

describe("formatExpiry", () => {
  it("formats never expiry", () => {
    expect(formatExpiry(0)).toBe("never");
  });

  it("formats seconds under 1 minute", () => {
    expect(formatExpiry(30)).toBe("30 seconds");
    expect(formatExpiry(59)).toBe("59 seconds");
  });

  it("formats minutes for 1 minute - 1 hour", () => {
    expect(formatExpiry(60)).toBe("1 minutes");
    expect(formatExpiry(3600 - 1)).toBe("59.983333333333334 minutes");
  });

  it("formats hours for 1 hour - 1 day", () => {
    expect(formatExpiry(3600)).toBe("1 hours");
    expect(formatExpiry(7200)).toBe("2 hours");
  });

  it("formats days for 1 day and above", () => {
    expect(formatExpiry(86400)).toBe("1 days");
    expect(formatExpiry(86400 * 7)).toBe("7 days");
  });
});

// ── parseDuration ─────────────────────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses never expiry aliases", () => {
    expect(parseDuration("0")).toBe(0);
    expect(parseDuration("never")).toBe(0);
    expect(parseDuration("none")).toBe(0);
  });

  it("parses plain numeric string as seconds", () => {
    expect(parseDuration("30")).toBe(30);
    expect(parseDuration("3600")).toBe(3600);
  });

  it("parses seconds suffix", () => {
    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("1s")).toBe(1);
  });

  it("parses minutes suffix", () => {
    expect(parseDuration("5m")).toBe(300);
    expect(parseDuration("1m")).toBe(60);
  });

  it("parses hours suffix", () => {
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1h")).toBe(3600);
  });

  it("parses days suffix", () => {
    expect(parseDuration("1d")).toBe(86400);
    expect(parseDuration("7d")).toBe(604800);
  });

  it("parses weeks suffix", () => {
    expect(parseDuration("1w")).toBe(604800);
    expect(parseDuration("2w")).toBe(1209600);
  });

  it("is case-insensitive for suffix", () => {
    expect(parseDuration("5M")).toBe(300);
    expect(parseDuration("2H")).toBe(7200);
    expect(parseDuration("1D")).toBe(86400);
  });

  it("accepts whitespace between number and unit", () => {
    expect(parseDuration("5 m")).toBe(300);
    expect(parseDuration("2 h")).toBe(7200);
  });

  it("throws for non-numeric input", () => {
    expect(() => parseDuration("abc")).toThrow("Invalid duration");
    expect(() => parseDuration("")).toThrow("Invalid duration");
  });
});

// ── renderProgress ────────────────────────────────────────────────────────────

describe("renderProgress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a progress bar string with correct structure", () => {
    vi.useFakeTimers();
    // 10 MB loaded, 20 MB total, 10 seconds elapsed -> speed = 1.00 MB/s
    const startTime = new Date("2024-01-01T00:00:00.000Z").getTime();
    vi.setSystemTime(new Date("2024-01-01T00:00:10.000Z"));

    const state: ProgressState = {
      loaded: 10 * 1024 * 1024,
      total: 20 * 1024 * 1024,
      startTime,
    };

    const output = renderProgress(state, "Uploading");

    expect(output).toContain("Uploading");
    expect(output).toContain("50.0%");
    expect(output).toContain("█");
    expect(output).toContain("░");
    expect(output).toContain("1.00 MB/s");
    expect(output).toContain("/20.0 MB");
    // ETA: 10 MB remaining at 1 MB/s = 10 seconds
    expect(output).toContain("ETA 10s");
  });

  it("shows 100% when fully loaded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:05.000Z"));

    const state: ProgressState = {
      loaded: 1024,
      total: 1024,
      startTime: new Date("2024-01-01T00:00:00.000Z").getTime(),
    };

    const output = renderProgress(state, "Done");
    expect(output).toContain("100.0%");
    // Full bar - 30 filled blocks, 0 empty
    expect(output).toContain("█".repeat(30));
    expect(output).not.toContain("░");
  });

  it("shows 0% with all empty blocks at start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.001Z"));

    const state: ProgressState = {
      loaded: 0,
      total: 1024 * 1024,
      startTime: new Date("2024-01-01T00:00:00.000Z").getTime(),
    };

    const output = renderProgress(state, "Starting");
    expect(output).toContain("0.0%");
    expect(output).toContain("░".repeat(30));
  });

  it("handles total = 0 (shows 0%)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:05.000Z"));

    const state: ProgressState = {
      loaded: 0,
      total: 0,
      startTime: new Date("2024-01-01T00:00:00.000Z").getTime(),
    };

    const output = renderProgress(state, "Empty");
    expect(output).toContain("0.0%");
  });

  it("shows ETA 0s when speed is zero", () => {
    vi.useFakeTimers();
    // elapsed = 0 -> speed = 0 -> remaining = 0
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const state: ProgressState = {
      loaded: 0,
      total: 1024,
      startTime: new Date("2024-01-01T00:00:00.000Z").getTime(),
    };

    const output = renderProgress(state, "Stalled");
    expect(output).toContain("ETA 0s");
  });
});

// ── clearLine / writeProgress / writeLine ─────────────────────────────────────

describe("clearLine", () => {
  it("writes the ANSI clear sequence to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    clearLine();
    expect(write).toHaveBeenCalledWith("\r\x1b[K");
    write.mockRestore();
  });
});

describe("writeProgress", () => {
  it("writes the line with ANSI clear prefix to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    writeProgress("50%");
    expect(write).toHaveBeenCalledWith("\r\x1b[K50%");
    write.mockRestore();
  });
});

describe("writeLine", () => {
  it("writes the line followed by a newline to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    writeLine("hello");
    expect(write).toHaveBeenCalledWith("hello\n");
    write.mockRestore();
  });
});

// ── promptPassword ────────────────────────────────────────────────────────────

describe("promptPassword", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("non-TTY mode", () => {
    let origIsTTY: boolean | undefined;

    beforeEach(() => {
      origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true, writable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true, writable: true });
    });

    it("resolves with the entered answer", async () => {
      const mockRl = {
        question: vi.fn((p: string, cb: (ans: string) => void) => { cb("mysecret"); }),
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as unknown as readline.Interface);

      const result = await promptPassword("Enter: ");
      expect(result).toBe("mysecret");
      expect(mockRl.close).toHaveBeenCalled();
    });

    it("uses 'Password: ' as default prompt", async () => {
      const mockRl = {
        question: vi.fn((p: string, cb: (ans: string) => void) => { cb(""); }),
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as unknown as readline.Interface);

      await promptPassword();
      expect(mockRl.question).toHaveBeenCalledWith("Password: ", expect.any(Function));
    });
  });

  describe("TTY mode", () => {
    let origIsTTY: boolean | undefined;
    let origSetRawMode: unknown;
    let capturedDataHandler: ((data: Buffer) => void) | null;
    let mockSetRawMode: ReturnType<typeof vi.fn>;
    let mockRl: { question: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      origIsTTY = process.stdin.isTTY;
      origSetRawMode = (process.stdin as NodeJS.ReadStream & { setRawMode?: unknown }).setRawMode;
      capturedDataHandler = null;
      mockSetRawMode = vi.fn();
      mockRl = { question: vi.fn(), close: vi.fn() };

      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true, writable: true });
      (process.stdin as NodeJS.ReadStream & { setRawMode: unknown }).setRawMode = mockSetRawMode;

      vi.spyOn(process.stdin, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "data") capturedDataHandler = handler as (data: Buffer) => void;
        return process.stdin;
      });
      vi.spyOn(process.stdin, "removeListener").mockReturnValue(process.stdin);
      vi.spyOn(process.stderr, "write").mockReturnValue(true);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as unknown as readline.Interface);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true, writable: true });
      (process.stdin as NodeJS.ReadStream & { setRawMode: unknown }).setRawMode = origSetRawMode;
    });

    it("resolves with typed characters on Enter (\\r)", async () => {
      const promise = promptPassword("Pass: ");
      expect(capturedDataHandler).not.toBeNull();
      capturedDataHandler!(Buffer.from("a"));
      capturedDataHandler!(Buffer.from("b"));
      capturedDataHandler!(Buffer.from("c"));
      capturedDataHandler!(Buffer.from("\r"));

      const result = await promise;
      expect(result).toBe("abc");
      expect(mockSetRawMode).toHaveBeenCalledWith(false);
      expect(mockRl.close).toHaveBeenCalled();
    });

    it("resolves on newline (\\n)", async () => {
      const promise = promptPassword("Pass: ");
      capturedDataHandler!(Buffer.from("x"));
      capturedDataHandler!(Buffer.from("\n"));

      const result = await promise;
      expect(result).toBe("x");
    });

    it("resolves on Ctrl+D (\\u0004)", async () => {
      const promise = promptPassword("Pass: ");
      capturedDataHandler!(Buffer.from("\u0004"));

      const result = await promise;
      expect(result).toBe("");
    });

    it("rejects on Ctrl+C (\\u0003)", async () => {
      const promise = promptPassword("Pass: ");
      capturedDataHandler!(Buffer.from("\u0003"));

      await expect(promise).rejects.toThrow("Aborted");
      expect(mockSetRawMode).toHaveBeenCalledWith(false);
      expect(mockRl.close).toHaveBeenCalled();
    });

    it("handles backspace DEL (\\u007F)", async () => {
      const promise = promptPassword("Pass: ");
      capturedDataHandler!(Buffer.from("a"));
      capturedDataHandler!(Buffer.from("b"));
      capturedDataHandler!(Buffer.from("\u007F"));
      capturedDataHandler!(Buffer.from("c"));
      capturedDataHandler!(Buffer.from("\r"));

      const result = await promise;
      expect(result).toBe("ac");
    });

    it("handles backspace (\\b)", async () => {
      const promise = promptPassword("Pass: ");
      capturedDataHandler!(Buffer.from("a"));
      capturedDataHandler!(Buffer.from("\b"));
      capturedDataHandler!(Buffer.from("\r"));

      const result = await promise;
      expect(result).toBe("");
    });

    it("ignores backspace on empty password", async () => {
      const promise = promptPassword("Pass: ");
      capturedDataHandler!(Buffer.from("\u007F"));
      capturedDataHandler!(Buffer.from("a"));
      capturedDataHandler!(Buffer.from("\r"));

      const result = await promise;
      expect(result).toBe("a");
    });

    it("writes the custom prompt to stderr", async () => {
      const promise = promptPassword("Secret: ");
      capturedDataHandler!(Buffer.from("\r"));
      await promise;
      expect(process.stderr.write).toHaveBeenCalledWith("Secret: ");
    });
  });
});
