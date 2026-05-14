// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
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
  isSafari: false,
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
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useDownload", () => {
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
});
