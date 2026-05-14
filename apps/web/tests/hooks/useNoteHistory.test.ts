// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../../src/lib/api.js", () => ({
  fetchNoteInfo: vi.fn(),
  deleteNote: vi.fn().mockResolvedValue(undefined),
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
  getAllNotes: vi.fn(),
  removeNote: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function storedNote(id: string) {
  return {
    id,
    ownerToken: `tok-${id}`,
    secret: `sec-${id}`,
    contentType: "text" as const,
    createdAt: "2024-01-01T00:00:00Z",
  };
}

function noteInfo(id: string) {
  return {
    id,
    contentType: "text" as const,
    hasPassword: false,
    salt: "salt",
    maxViews: 3,
    viewCount: 0,
    expiresAt: "2099-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useNoteHistory", () => {
  it("shows no notes when the store is empty", async () => {
    const { getAllNotes } = await import("../../src/lib/upload-store.js");
    vi.mocked(getAllNotes).mockResolvedValueOnce([]);

    const { useNoteHistory } = await import("../../src/hooks/useNoteHistory.js");
    const { result } = renderHook(() => useNoteHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notes).toHaveLength(0);
  });

  it("loads notes and enriches them with live server status", async () => {
    const { getAllNotes } = await import("../../src/lib/upload-store.js");
    const { fetchNoteInfo } = await import("../../src/lib/api.js");

    vi.mocked(getAllNotes).mockResolvedValueOnce([storedNote("n-1"), storedNote("n-2")]);
    vi.mocked(fetchNoteInfo)
      .mockResolvedValueOnce(noteInfo("n-1"))
      .mockResolvedValueOnce(noteInfo("n-2"));

    const { useNoteHistory } = await import("../../src/hooks/useNoteHistory.js");
    const { result } = renderHook(() => useNoteHistory());

    await waitFor(() => {
      expect(result.current.notes.length).toBe(2);
      expect(result.current.notes.every((n) => !n.loading)).toBe(true);
    });

    expect(result.current.notes).toHaveLength(2);
    expect(result.current.notes[0]?.info?.id).toBe("n-1");
  });

  it("removes note from list when server returns 410", async () => {
    const { getAllNotes, removeNote } = await import("../../src/lib/upload-store.js");
    const api = await import("../../src/lib/api.js");

    vi.mocked(getAllNotes).mockResolvedValueOnce([storedNote("gone-1")]);
    vi.mocked(api.fetchNoteInfo).mockRejectedValueOnce(new api.ApiError(410, "Gone"));

    const { useNoteHistory } = await import("../../src/hooks/useNoteHistory.js");
    const { result } = renderHook(() => useNoteHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notes).toHaveLength(0);
    expect(vi.mocked(removeNote)).toHaveBeenCalledWith("gone-1");
  });

  it("deleteNoteById calls API, removes from store, and updates list", async () => {
    const { getAllNotes, removeNote } = await import("../../src/lib/upload-store.js");
    const { fetchNoteInfo, deleteNote } = await import("../../src/lib/api.js");

    vi.mocked(getAllNotes)
      .mockResolvedValueOnce([storedNote("d-1")])
      .mockResolvedValue([]);  // persistent fallback for any extra loadData() calls
    vi.mocked(fetchNoteInfo).mockResolvedValueOnce(noteInfo("d-1"));
    vi.mocked(deleteNote).mockResolvedValueOnce(undefined);
    vi.mocked(removeNote).mockResolvedValueOnce(undefined);

    const { useNoteHistory } = await import("../../src/hooks/useNoteHistory.js");
    const { result } = renderHook(() => useNoteHistory());

    await waitFor(() => {
      expect(result.current.notes.find((n) => n.id === "d-1" && !n.loading)).toBeDefined();
    });

    await act(async () => {
      await result.current.deleteNote("d-1", "tok-d-1");
    });

    expect(vi.mocked(deleteNote)).toHaveBeenCalledWith("d-1", "tok-d-1");
    expect(vi.mocked(removeNote)).toHaveBeenCalledWith("d-1");
    expect(result.current.notes.find((n) => n.id === "d-1")).toBeUndefined();

    // trigger refresh to cover emitNoteRefresh body (lines 26-27)
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("generischer Netzwerkfehler von fetchNoteInfo \u2192 Note bleibt sichtbar, loading=false", async () => {
    const { getAllNotes } = await import("../../src/lib/upload-store.js");
    const { fetchNoteInfo } = await import("../../src/lib/api.js");

    vi.mocked(getAllNotes).mockResolvedValue([storedNote("e-1")]);
    vi.mocked(fetchNoteInfo).mockRejectedValue(new Error("Network error"));

    const { useNoteHistory } = await import("../../src/hooks/useNoteHistory.js");
    const { result } = renderHook(() => useNoteHistory());

    await waitFor(() => {
      const note = result.current.notes.find((n) => n.id === "e-1");
      expect(note).toBeDefined();
      expect(note?.loading).toBe(false);
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]?.loading).toBe(false);
    expect(result.current.notes[0]?.gone).toBe(false);
  });
});
