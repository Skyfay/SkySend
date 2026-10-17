// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Keys, the password check, the view and the reading of the note are the shared core's,
// tested in packages/transfer.
vi.mock("@skysend/transfer", () => ({
  openNote: vi.fn(),
}));

vi.mock("../../src/lib/argon2.js", () => ({
  hashWasmArgon2: vi.fn(),
}));

vi.mock("../../src/lib/api.js", () => ({
  fetchNoteInfo: vi.fn(),
  viewNote: vi.fn(),
  verifyNotePassword: vi.fn(),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNoteInfo(overrides = {}) {
  return {
    id: "n-1",
    contentType: "text" as const,
    hasPassword: false,
    salt: "salt64",
    maxViews: 3,
    viewCount: 0,
    expiresAt: "2099-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeOpenedNote(overrides = {}) {
  return {
    blocks: [{ type: "text" as const, format: "plain" as const, text: "decrypted content" }],
    unreadable: false,
    viewCount: 1,
    maxViews: 3,
    ...overrides,
  };
}

async function getOpenNote() {
  const { openNote } = await import("@skysend/transfer");
  return vi.mocked(openNote);
}

/** A hook that has loaded the info of the note, like the page does first. */
async function loaded(info = makeNoteInfo()) {
  const api = await import("../../src/lib/api.js");
  vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(info);
  const { useNoteView } = await import("../../src/hooks/useNoteView.js");
  const { result } = renderHook(() => useNoteView());
  await act(async () => {
    await result.current.loadInfo("n-1");
  });
  return result;
}

afterEach(() => {
  vi.resetAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useNoteView", () => {
  it("starts in idle state", async () => {
    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    expect(result.current.phase).toBe("idle");
    expect(result.current.blocks).toBeNull();
    expect(result.current.unreadable).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("loadInfo() sets phase=idle and stores info when note has no password", async () => {
    const result = await loaded();

    expect(result.current.phase).toBe("idle");
    expect(result.current.info?.id).toBe("n-1");
  });

  it("loadInfo() sets phase=needs-password when note has a password", async () => {
    const result = await loaded(
      makeNoteInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "argon2id-v2" }),
    );

    expect(result.current.phase).toBe("needs-password");
  });

  it("loadInfo() sets phase=error on ApiError", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockRejectedValueOnce(new api.ApiError(404, "Not Found"));

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Not Found");
  });

  it("loadInfo() sets error='Failed to load note info' on another error", async () => {
    const { fetchNoteInfo } = await import("../../src/lib/api.js");
    vi.mocked(fetchNoteInfo).mockRejectedValueOnce(new Error("Network failure"));

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Failed to load note info");
  });

  it("view() shows the blocks the core opened", async () => {
    const openNote = await getOpenNote();
    openNote.mockResolvedValueOnce(makeOpenedNote());
    const result = await loaded();

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("viewing");
    expect(result.current.blocks).toEqual([
      { type: "text", format: "plain", text: "decrypted content" },
    ]);
    expect(result.current.viewCount).toBe(1);
  });

  it("view() hands the link, the info, the password and the Argon2id of the page to the core", async () => {
    const openNote = await getOpenNote();
    openNote.mockResolvedValueOnce(makeOpenedNote());
    const info = makeNoteInfo({
      hasPassword: true,
      passwordSalt: "ps64",
      passwordAlgo: "argon2id-v2",
    });
    const result = await loaded(info);
    const api = await import("../../src/lib/api.js");
    const { hashWasmArgon2 } = await import("../../src/lib/argon2.js");

    await act(async () => {
      await result.current.view("n-1", "secretb64", "correctpass");
    });

    expect(openNote).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "n-1",
        info,
        secret: "secretb64",
        password: "correctpass",
        argon2id: hashWasmArgon2,
      }),
    );
    const { api: given } = openNote.mock.calls[0]![0];
    expect(given.viewNote).toBe(api.viewNote);
    expect(given.verifyNotePassword).toBe(api.verifyNotePassword);
    expect(result.current.phase).toBe("viewing");
  });

  it("view() sets phase=destroyed when last view consumed", async () => {
    const openNote = await getOpenNote();
    openNote.mockResolvedValueOnce(makeOpenedNote({ viewCount: 1, maxViews: 1 }));
    const result = await loaded(makeNoteInfo({ maxViews: 1 }));

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("destroyed");
  });

  it("view() keeps an unlimited note viewable", async () => {
    const openNote = await getOpenNote();
    openNote.mockResolvedValueOnce(makeOpenedNote({ viewCount: 7, maxViews: 0 }));
    const result = await loaded(makeNoteInfo({ maxViews: 0 }));

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("viewing");
  });

  it("view() sets phase=needs-password and error=wrong-password when the core finds it wrong", async () => {
    const openNote = await getOpenNote();
    openNote.mockResolvedValueOnce(null);
    const result = await loaded(
      makeNoteInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "argon2id-v2" }),
    );

    await act(async () => {
      await result.current.view("n-1", "secretb64", "wrongpass");
    });

    expect(result.current.phase).toBe("needs-password");
    expect(result.current.error).toBe("wrong-password");
  });

  it("view() sets phase=needs-password and error=rate-limited on 429", async () => {
    const api = await import("../../src/lib/api.js");
    const openNote = await getOpenNote();
    openNote.mockRejectedValueOnce(new api.ApiError(429, "rate-limited"));
    const result = await loaded();

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("needs-password");
    expect(result.current.error).toBe("rate-limited");
  });

  it("view() sets error='Failed to view note' when the core fails without an ApiError", async () => {
    const openNote = await getOpenNote();
    openNote.mockRejectedValueOnce(new Error("Missing password salt"));
    const result = await loaded(makeNoteInfo({ hasPassword: true, passwordAlgo: "argon2id-v2" }));

    await act(async () => {
      await result.current.view("n-1", "secretb64", "anypassword");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Failed to view note");
  });

  it("view() without loadInfo(): fetchNoteInfo returns null → phase='error'", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(null as never);

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    // Do NOT call loadInfo() - state.info stays null, so the ?? fetchNoteInfo() branch is taken
    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("error");
  });

  it("view() passes on that a note did not read in its format", async () => {
    const openNote = await getOpenNote();
    openNote.mockResolvedValueOnce(
      makeOpenedNote({
        unreadable: true,
        blocks: [{ type: "text", format: "plain", text: "not a document" }],
      }),
    );
    const result = await loaded(makeNoteInfo({ contentType: "blocks" }));

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("viewing");
    expect(result.current.unreadable).toBe(true);
  });
});
