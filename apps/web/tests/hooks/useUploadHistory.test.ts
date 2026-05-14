// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../../src/lib/api.js", () => ({
  fetchInfo: vi.fn(),
  deleteUpload: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../src/lib/upload-store.js", () => ({
  getAllUploads: vi.fn(),
  removeUpload: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function storedUpload(id: string) {
  return {
    id,
    ownerToken: `tok-${id}`,
    secret: `sec-${id}`,
    fileNames: ["file.txt"],
    createdAt: "2024-01-01T00:00:00Z",
  };
}

function uploadInfo(id: string) {
  return {
    id,
    size: 100,
    fileCount: 1,
    hasPassword: false,
    salt: "salt",
    encryptedMeta: null,
    nonce: null,
    downloadCount: 0,
    maxDownloads: 10,
    expiresAt: "2099-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useUploadHistory", () => {
  it("shows no uploads when the store is empty", async () => {
    const { getAllUploads } = await import("../../src/lib/upload-store.js");
    vi.mocked(getAllUploads).mockResolvedValueOnce([]);

    const { useUploadHistory } = await import("../../src/hooks/useUploadHistory.js");
    const { result } = renderHook(() => useUploadHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.uploads).toHaveLength(0);
  });

  it("loads uploads and enriches them with live server status", async () => {
    const { getAllUploads } = await import("../../src/lib/upload-store.js");
    const { fetchInfo } = await import("../../src/lib/api.js");

    vi.mocked(getAllUploads).mockResolvedValueOnce([storedUpload("u-1"), storedUpload("u-2")]);
    vi.mocked(fetchInfo)
      .mockResolvedValueOnce(uploadInfo("u-1"))
      .mockResolvedValueOnce(uploadInfo("u-2"));

    const { useUploadHistory } = await import("../../src/hooks/useUploadHistory.js");
    const { result } = renderHook(() => useUploadHistory());

    await waitFor(() => {
      expect(result.current.uploads.length).toBe(2);
      expect(result.current.uploads.every((u) => !u.loading)).toBe(true);
    });

    expect(result.current.uploads[0]?.info?.id).toBe("u-1");
  });

  it("removes upload from list when server returns 404", async () => {
    const { getAllUploads, removeUpload } = await import("../../src/lib/upload-store.js");
    const api = await import("../../src/lib/api.js");

    vi.mocked(getAllUploads).mockResolvedValueOnce([storedUpload("gone-1")]);
    vi.mocked(api.fetchInfo).mockRejectedValueOnce(new api.ApiError(404, "Not Found"));

    const { useUploadHistory } = await import("../../src/hooks/useUploadHistory.js");
    const { result } = renderHook(() => useUploadHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Upload is marked gone and filtered out
    expect(result.current.uploads).toHaveLength(0);
    expect(vi.mocked(removeUpload)).toHaveBeenCalledWith("gone-1");
  });

  it("deleteUploadById calls API, removes from store, and updates list", async () => {
    const { getAllUploads, removeUpload } = await import("../../src/lib/upload-store.js");
    const { fetchInfo, deleteUpload } = await import("../../src/lib/api.js");

    vi.mocked(getAllUploads).mockResolvedValueOnce([storedUpload("d-1")]);
    vi.mocked(fetchInfo).mockResolvedValueOnce(uploadInfo("d-1"));
    vi.mocked(deleteUpload).mockResolvedValueOnce(undefined);
    vi.mocked(removeUpload).mockResolvedValueOnce(undefined);

    const { useUploadHistory } = await import("../../src/hooks/useUploadHistory.js");
    const { result } = renderHook(() => useUploadHistory());

    await waitFor(() => {
      expect(result.current.uploads.find((u) => u.id === "d-1" && !u.loading)).toBeDefined();
    });

    await act(async () => {
      await result.current.deleteUpload("d-1", "tok-d-1");
    });

    expect(vi.mocked(deleteUpload)).toHaveBeenCalledWith("d-1", "tok-d-1");
    expect(vi.mocked(removeUpload)).toHaveBeenCalledWith("d-1");
    expect(result.current.uploads.find((u) => u.id === "d-1")).toBeUndefined();
  });
});
