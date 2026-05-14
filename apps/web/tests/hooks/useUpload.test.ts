// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Worker mock ───────────────────────────────────────────────────────────────

// jsdom has no Worker implementation. We replace it with a controllable mock
// so tests can simulate messages from the upload worker without a real bundle.
class MockWorker {
  static lastInstance: MockWorker | null = null;

  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn(() => {
    MockWorker.lastInstance = null;
  });

  constructor() {
    MockWorker.lastInstance = this;
  }

  /** Trigger a message as if it came from the worker. */
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  /** Trigger an error as if it came from the worker. */
  emitError(message: string) {
    this.onerror?.(new ErrorEvent("error", { message }));
  }
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../../src/lib/upload-store.js", () => ({
  saveUpload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@skysend/crypto", () => ({
  generateSecret: vi.fn(() => new Uint8Array(32).fill(1)),
  generateSalt: vi.fn(() => new Uint8Array(32).fill(2)),
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  MockWorker.lastInstance = null;
  vi.stubGlobal("Worker", MockWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(name = "test.txt", content = "hello"): File {
  return new File([content], name, { type: "text/plain" });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useUpload", () => {
  it("starts in idle state", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    expect(result.current.phase).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.shareLink).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("reset() returns to idle state", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    // Start an upload so state changes, then reset
    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.shareLink).toBeNull();
  });

  it("cancel() returns to idle state", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    act(() => {
      result.current.cancel();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.shareLink).toBeNull();
  });

  it("completes upload when Worker emits done message", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });

    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "done", id: "file-123", ownerToken: "owner-tok", effectiveSecret: "sec64" });
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.shareLink).toContain("/file/file-123");
    expect(result.current.progress).toBe(100);
  });

  it("sets phase=error when Worker emits error message", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });

    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "error", message: "encryption failed" });
    });

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("encryption failed");
  });
});
