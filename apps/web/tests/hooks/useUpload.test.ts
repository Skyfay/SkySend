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
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it("Datei nicht lesbar → error='fileNotReadable'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    const badFile = makeFile("bad.txt");
    Object.defineProperty(badFile, "slice", {
      value: () => { throw new Error("read error"); },
      writable: true,
      configurable: true,
    });

    await act(async () => {
      await result.current.upload({ files: [badFile], maxDownloads: 1, expireSec: 3600, password: "" });
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("fileNotReadable");
  });

  it("Multi-File-Upload (2 Dateien) → Startphase='zipping'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({
        files: [makeFile("a.txt"), makeFile("b.txt")],
        maxDownloads: 1,
        expireSec: 3600,
        password: "",
      });
    });

    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());
    expect(result.current.phase).toBe("zipping");
  });

  it("Worker 'phase'-Message → Zustandswechsel zu 'uploading'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "phase", phase: "uploading" });
    });

    expect(result.current.phase).toBe("uploading");
    expect(result.current.progress).toBe(0);
    expect(result.current.speed).toBeNull();
  });

  it("Worker 'progress'-Message mit Speed-Berechnung (≥500ms)", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });

    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    // lastTime = performance.now() = 0 (fake clock); advance so elapsed >= 0.5s
    vi.advanceTimersByTime(600);

    act(() => {
      worker.emit({ type: "progress", loaded: 500, total: 1000 });
    });

    expect(result.current.progress).toBe(50);
    expect(result.current.speed).not.toBeNull();
    expect(result.current.speed).toMatch(/\/s$/);
  });

  it("Worker onerror → phase='error'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emitError("Worker crashed");
    });

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("Worker crashed");
  });

  it("Upload mit averageSpeed-Berechnung nach Abschluss", async () => {
    let fakeNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (fakeNow += 1000));

    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;

    act(() => {
      worker.emit({ type: "phase", phase: "uploading" });
    });
    act(() => {
      worker.emit({ type: "progress", loaded: 5000, total: 5000 });
    });
    act(() => {
      worker.emit({ type: "done", id: "file-abc", ownerToken: "tok", effectiveSecret: "sec" });
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.averageSpeed).not.toBeNull();
    expect(result.current.averageSpeed).toMatch(/\/s$/);
  });

  it("Worker 'transport'-Message (WebSocket, kein Fallback) \u2192 debugInfo aktualisiert", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "transport", transport: "ws", fallback: false });
    });

    expect(result.current.debugInfo?.transport).toBe("ws");
    expect(result.current.debugInfo?.fallback).toBe(false);
    expect(result.current.debugInfo?.events.some((e) => e.message === "WebSocket transport active")).toBe(true);
  });

  it("Worker 'transport'-Message (HTTP-Fallback) \u2192 debugInfo aktualisiert", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "transport", transport: "http", fallback: true });
    });

    expect(result.current.debugInfo?.transport).toBe("http");
    expect(result.current.debugInfo?.fallback).toBe(true);
    expect(result.current.debugInfo?.events.some((e) => e.message.includes("HTTP fallback"))).toBe(true);
  });

  it("Worker 'transport'-Message (HTTP-Chunks, kein Fallback) → 'HTTP chunks transport active'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "transport", transport: "http", fallback: false });
    });

    expect(result.current.debugInfo?.transport).toBe("http");
    expect(result.current.debugInfo?.fallback).toBe(false);
    expect(result.current.debugInfo?.events.some((e) => e.message === "HTTP chunks transport active")).toBe(true);
  });

  it("Datei ohne MIME-Typ → fällt auf 'application/octet-stream' zurück", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    const noMimeFile = new File(["hello"], "test.bin", { type: "" });

    act(() => {
      result.current.upload({ files: [noMimeFile], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    expect(MockWorker.lastInstance!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          mimeType: "application/octet-stream",
        }),
      }),
      expect.any(Array),
    );
  });

  it("Worker 'phase'-Message 'saving-meta' → uploadStartTime nicht gesetzt", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "phase", phase: "saving-meta" });
    });

    expect(result.current.phase).toBe("saving-meta");
  });

  it("Upload abgeschlossen ohne vorherige 'uploading'-Phase → averageSpeed=null", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "done", id: "file-xyz", ownerToken: "tok", effectiveSecret: "sec" });
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.averageSpeed).toBeNull();
    expect(result.current.debugInfo?.events.some((e) => e.message === "Upload complete")).toBe(true);
  });

  it("Catch: Non-Error-Wert geworfen → error='Upload failed'", async () => {
    const cryptoMod = await import("@skysend/crypto");
    vi.mocked(cryptoMod.generateSecret).mockImplementationOnce(() => {
      throw "string error";
    });

    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    await act(async () => {
      await result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Upload failed");
  });

  it("Worker 'phase'-Message 'zipping' → debugInfo enthält 'Packing started'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "phase", phase: "zipping" });
    });

    expect(result.current.phase).toBe("zipping");
    expect(result.current.debugInfo?.events.some((e) => e.message === "Packing started")).toBe(true);
  });

  it("Worker 'pack-done' mit durationMs > 0 → debugInfo enthält Packing-Speed", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "pack-done", durationMs: 1000, inputBytes: 5000 });
    });

    expect(result.current.debugInfo?.events.some((e) => e.message.startsWith("Packing complete"))).toBe(true);
    expect(result.current.debugInfo?.events.some((e) => e.message.includes("/s"))).toBe(true);
  });

  it("Worker 'pack-done' mit durationMs = 0 → debugInfo enthält 'Packing complete' ohne Speed", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "pack-done", durationMs: 0, inputBytes: 0 });
    });

    expect(result.current.debugInfo?.events.some((e) => e.message === "Packing complete")).toBe(true);
  });

  it("Worker 'storage' mit backend='s3' → debugInfo enthält 'S3 upload active'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "storage", backend: "s3" });
    });

    expect(result.current.debugInfo?.events.some((e) => e.message === "S3 upload active")).toBe(true);
  });

  it("Worker 'storage' mit backend='filesystem' → debugInfo enthält 'Filesystem upload active'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "storage", backend: "filesystem" });
    });

    expect(result.current.debugInfo?.events.some((e) => e.message === "Filesystem upload active")).toBe(true);
  });

  it("Worker 'progress'-Message mit < 500ms → Speed bleibt null", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });

    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    // Do NOT advance timers - elapsed < 0.5s
    act(() => {
      worker.emit({ type: "progress", loaded: 300, total: 1000 });
    });

    expect(result.current.progress).toBe(30);
    expect(result.current.speed).toBeNull();
  });

  it("Worker onerror mit leerem Message → error='Worker error'", async () => {
    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emitError("");
    });

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("Worker error");
  });

  it("averageSpeed=null wenn performance.now() immer denselben Wert zurückgibt (totalSec=0)", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);

    const { useUpload } = await import("../../src/hooks/useUpload.js");
    const { result } = renderHook(() => useUpload());

    act(() => {
      result.current.upload({ files: [makeFile()], maxDownloads: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(MockWorker.lastInstance).not.toBeNull());

    const worker = MockWorker.lastInstance!;
    act(() => {
      worker.emit({ type: "phase", phase: "uploading" });
    });
    act(() => {
      worker.emit({ type: "progress", loaded: 500, total: 1000 });
    });
    act(() => {
      worker.emit({ type: "done", id: "file-ts0", ownerToken: "tok", effectiveSecret: "sec" });
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.averageSpeed).toBeNull();
  });
});

