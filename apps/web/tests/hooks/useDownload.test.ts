// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@skysend/crypto", () => ({
  deriveKeys: vi.fn(async () => ({ metaKey: {}, authKey: {} })),
  computeAuthToken: vi.fn(async () => new Uint8Array(32)),
  createDecryptStream: vi.fn(() => new TransformStream()),
  decryptMetadata: vi.fn(async () => ({
    type: "single",
    name: "file.txt",
    size: 42,
    mimeType: "text/plain",
  })),
  toBase64url: vi.fn(() => "authtoken"),
  fromBase64url: vi.fn(() => new Uint8Array(32)),
  applyPasswordProtection: vi.fn((_s: Uint8Array, _k: Uint8Array) => new Uint8Array(32)),
  deriveKeyFromPassword: vi.fn(async () => ({ key: new Uint8Array(32) })),
  ARGON2_PARAMS_LEGACY: {},
}));

vi.mock("../../src/lib/api.js", () => ({
  fetchInfo: vi.fn(),
  downloadFile: vi.fn(),
  verifyPassword: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("../../src/lib/opfs-download.js", () => ({
  ensureSwController: vi.fn().mockResolvedValue(undefined),
  streamDownloadViaSw: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/utils.js", () => ({
  isSafari: vi.fn().mockReturnValue(false),
  isFirefox: vi.fn().mockReturnValue(false),
  isDevToolsOpen: vi.fn().mockReturnValue(false),
  getBrowserInfo: vi.fn().mockReturnValue("test-browser"),
  SAFARI_BIG_SIZE: 100 * 1024 * 1024,
  formatBytes: vi.fn((n: number) => `${n} B`),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeUploadInfo(overrides = {}) {
  return {
    id: "f-1",
    size: 100,
    fileCount: 1,
    hasPassword: false,
    salt: "salt64",
    encryptedMeta: null,
    nonce: null,
    downloadCount: 0,
    maxDownloads: 5,
    expiresAt: "2099-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useDownload", () => {
  beforeEach(async () => {
    const utils = await import("../../src/lib/utils.js");
    vi.mocked(utils.isSafari).mockReturnValue(false);
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("starts in idle state", async () => {
    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    expect(result.current.phase).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.info).toBeNull();
  });

  it("loadInfo() succeeds without password → phase=idle", async () => {
    const { fetchInfo } = await import("../../src/lib/api.js");
    vi.mocked(fetchInfo).mockResolvedValueOnce(makeUploadInfo());

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.loadInfo("f-1");
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.info?.id).toBe("f-1");
  });

  it("loadInfo() with password → phase=needs-password", async () => {
    const { fetchInfo } = await import("../../src/lib/api.js");
    vi.mocked(fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "pbkdf2" }),
    );

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.loadInfo("f-1");
    });

    expect(result.current.phase).toBe("needs-password");
  });

  it("loadInfo() sets phase=error on ApiError", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchInfo).mockRejectedValueOnce(new api.ApiError(404, "Not Found"));

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.loadInfo("f-1");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Not Found");
  });

  it("download() Blob-Fallback Erfolg → phase='done', progress=100", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
    expect(result.current.progress).toBe(100);
  });

  it("download() mit korrektem Passwort → phase='done'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "pbkdf2" }),
    );
    vi.mocked(apiMod.verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64", "correct-pw");
    });

    expect(result.current.phase).toBe("done");
  });

  it("download() falsches Passwort → phase='needs-password', error='wrong-password'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "pbkdf2" }),
    );
    vi.mocked(apiMod.verifyPassword).mockResolvedValueOnce(false);

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64", "wrong-pw");
    });

    expect(result.current.phase).toBe("needs-password");
    expect(result.current.error).toBe("wrong-password");
  });

  it("download() AbortError → phase='idle'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockRejectedValueOnce(
      new DOMException("User aborted", "AbortError"),
    );

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("idle");
  });

  it("download() 429 → phase='needs-password', error='rate-limited'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockRejectedValueOnce(
      new apiMod.ApiError(429, "rate-limited"),
    );

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("needs-password");
    expect(result.current.error).toBe("rate-limited");
  });

  it("download() generischer Fehler → phase='error'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockRejectedValueOnce(new Error("Network error"));

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Network error");
  });

  it("download() Safari-Warnung → phase='safari-warning'", async () => {
    const utils = await import("../../src/lib/utils.js");
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(utils.isSafari).mockReturnValue(true);
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ size: 200 * 1024 * 1024 }),
    );

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("safari-warning");
  });

  it("confirmSafariDownload() → Download fortgesetzt → phase='done'", async () => {
    const utils = await import("../../src/lib/utils.js");
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(utils.isSafari).mockReturnValue(true);
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ size: 200 * 1024 * 1024 }),
    );
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });
    expect(result.current.phase).toBe("safari-warning");

    await act(async () => {
      result.current.confirmSafariDownload();
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("done");
    });
  });

  it("dismissSafariWarning() → phase='idle'", async () => {
    const utils = await import("../../src/lib/utils.js");
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(utils.isSafari).mockReturnValue(true);
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ size: 200 * 1024 * 1024 }),
    );

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });
    expect(result.current.phase).toBe("safari-warning");

    act(() => {
      result.current.dismissSafariWarning();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.pendingDownloadArgs).toBeNull();
  });

  it("reset() → alle State-Felder auf Initialwerte", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.loadInfo("f-1");
    });
    expect(result.current.info?.id).toBe("f-1");

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.speed).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.info).toBeNull();
    expect(result.current.metadata).toBeNull();
  });

  it("loadInfo() nicht-ApiError → error='Failed to load upload info'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockRejectedValueOnce(new Error("Network failure"));

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.loadInfo("f-1");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Failed to load upload info");
  });

  it("cancel() setzt AbortController zurück", async () => {
    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    act(() => {
      result.current.cancel();
    });

    expect(result.current.phase).toBe("idle");
  });

  it("download() Firefox DevTools-Warnung → phase='firefox-devtools-warning'", async () => {
    const utils = await import("../../src/lib/utils.js");
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(utils.isFirefox).mockReturnValue(true);
    vi.mocked(utils.isDevToolsOpen).mockReturnValue(true);
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("firefox-devtools-warning");
    expect(result.current.pendingDownloadArgs).not.toBeNull();
  });

  it("dismissDevToolsWarning() → phase='idle'", async () => {
    const utils = await import("../../src/lib/utils.js");
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(utils.isFirefox).mockReturnValue(true);
    vi.mocked(utils.isDevToolsOpen).mockReturnValue(true);
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });
    expect(result.current.phase).toBe("firefox-devtools-warning");

    act(() => {
      result.current.dismissDevToolsWarning();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.pendingDownloadArgs).toBeNull();
  });

  it("forceDownloadWithDevTools() → Download trotz DevTools → phase='done'", async () => {
    const utils = await import("../../src/lib/utils.js");
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(utils.isFirefox).mockReturnValue(true);
    vi.mocked(utils.isDevToolsOpen).mockReturnValue(true);
    vi.mocked(apiMod.fetchInfo).mockResolvedValue(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });
    expect(result.current.phase).toBe("firefox-devtools-warning");

    await act(async () => {
      result.current.forceDownloadWithDevTools();
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
  });

  it("retryDevToolsCheck() → erneuter Download nach DevTools-Schließen → phase='done'", async () => {
    const utils = await import("../../src/lib/utils.js");
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(utils.isFirefox).mockReturnValue(true);
    vi.mocked(utils.isDevToolsOpen).mockReturnValue(true);
    vi.mocked(apiMod.fetchInfo).mockResolvedValue(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockResolvedValue({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });
    expect(result.current.phase).toBe("firefox-devtools-warning");

    vi.mocked(utils.isDevToolsOpen).mockReturnValue(false);

    await act(async () => {
      result.current.retryDevToolsCheck();
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
  });

  it("download() nutzt gecachte state.info (kein zusätzlicher fetchInfo-Aufruf)", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.loadInfo("f-1");
    });
    expect(result.current.info?.id).toBe("f-1");

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
    expect(apiMod.fetchInfo).toHaveBeenCalledTimes(1);
  });

  it("download() mit encryptedMeta (Einzeldatei) → metadata korrekt gesetzt", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ encryptedMeta: btoa("ciphertext"), nonce: btoa("nonce123") }),
    );
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
    expect(result.current.metadata).toEqual({
      type: "single",
      name: "file.txt",
      size: 42,
      mimeType: "text/plain",
    });
  });

  it("download() mit encryptedMeta (Archiv) → metadata.type='archive'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    const cryptoMod = await import("@skysend/crypto");
    vi.mocked(cryptoMod.decryptMetadata).mockResolvedValueOnce({
      type: "archive",
      files: [{ name: "a.txt", size: 10 }],
      totalSize: 10,
    });
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ encryptedMeta: btoa("ciphertext"), nonce: btoa("nonce123") }),
    );
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
    expect(result.current.metadata?.type).toBe("archive");
  });

  it("download() argon2id-v2 Password → phase='done'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(
      makeUploadInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "argon2id-v2" }),
    );
    vi.mocked(apiMod.verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64", "correct-pw");
    });

    expect(result.current.phase).toBe("done");
  });

  it("download() berechnet averageSpeed nach Abschluss", async () => {
    let fakeNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (fakeNow += 1000));

    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo({ size: 5000 }));
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(100));
          controller.close();
        },
      }),
      size: 5000,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
    expect(result.current.averageSpeed).not.toBeNull();
    expect(result.current.averageSpeed).toMatch(/\/s$/);
  });

  it("download() SW-Tier-1 (ensureSwController truthy) → phase='done'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    const opfs = await import("../../src/lib/opfs-download.js");
    vi.mocked(opfs.ensureSwController).mockResolvedValueOnce(
      {} as unknown as Awaited<ReturnType<typeof opfs.ensureSwController>>,
    );
    vi.mocked(opfs.streamDownloadViaSw).mockImplementationOnce(
      async (_url, _auth, _secret, _salt, _filename, _mime, _size, onProgress, onSwPath, _signal) => {
        onProgress(50);
        onSwPath("/sw.js");
        onProgress(100);
      },
    );
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
    expect(opfs.streamDownloadViaSw).toHaveBeenCalledOnce();
  });

  it("download() SW-Tier-1 AbortError → phase='idle'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    const opfs = await import("../../src/lib/opfs-download.js");
    vi.mocked(opfs.ensureSwController).mockResolvedValueOnce(
      {} as unknown as Awaited<ReturnType<typeof opfs.ensureSwController>>,
    );
    vi.mocked(opfs.streamDownloadViaSw).mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("idle");
  });

  it("download() SW-Tier-1 Fehler → fällt auf Tier-3-Blob zurück", async () => {
    const apiMod = await import("../../src/lib/api.js");
    const opfs = await import("../../src/lib/opfs-download.js");
    vi.mocked(opfs.ensureSwController).mockResolvedValueOnce(
      {} as unknown as Awaited<ReturnType<typeof opfs.ensureSwController>>,
    );
    vi.mocked(opfs.streamDownloadViaSw).mockRejectedValueOnce(new Error("SW unavailable"));
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
  });

  it("download() Tier-2 (showSaveFilePicker) → phase='done'", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    const mockWritable = new WritableStream({ write() {} });
    const mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };
    vi.stubGlobal("showSaveFilePicker", vi.fn().mockResolvedValue(mockFileHandle));

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
    expect(mockFileHandle.createWritable).toHaveBeenCalledOnce();
  });

  it("download() Tier-2 showSaveFilePicker Fehler → Tier-3-Blob-Fallback", async () => {
    const apiMod = await import("../../src/lib/api.js");
    vi.mocked(apiMod.fetchInfo).mockResolvedValueOnce(makeUploadInfo());
    vi.mocked(apiMod.downloadFile).mockResolvedValueOnce({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      size: 3,
      fileCount: 1,
    });

    vi.stubGlobal("showSaveFilePicker", vi.fn().mockRejectedValue(new Error("picker error")));

    const { useDownload } = await import("../../src/hooks/useDownload.js");
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download("f-1", "secret64");
    });

    expect(result.current.phase).toBe("done");
  });
});

