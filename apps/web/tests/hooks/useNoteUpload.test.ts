// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@skysend/crypto", () => ({
  generateSecret: vi.fn(() => new Uint8Array(32)),
  generateSalt: vi.fn(() => new Uint8Array(32)),
  deriveKeys: vi.fn(async () => ({ metaKey: {}, authKey: {} })),
  computeAuthToken: vi.fn(async () => new Uint8Array(32)),
  computeOwnerToken: vi.fn(async () => new Uint8Array(32)),
  encryptNoteContent: vi.fn(async () => ({
    ciphertext: new Uint8Array([1, 2, 3]),
    nonce: new Uint8Array([4, 5, 6]),
  })),
  toBase64url: vi.fn(() => "b64url"),
  applyPasswordProtection: vi.fn((_secret: Uint8Array, _key: Uint8Array) => new Uint8Array(32)),
  deriveKeyFromPassword: vi.fn(async () => ({
    key: new Uint8Array(32),
    algorithm: "pbkdf2" as const,
  })),
  randomBytes: vi.fn(() => new Uint8Array(16)),
  PASSWORD_SALT_LENGTH: 16,
}));

vi.mock("../../src/lib/argon2.js", () => ({
  hashWasmArgon2: vi.fn(),
}));

vi.mock("../../src/lib/api.js", () => ({
  createNote: vi.fn(),
}));

vi.mock("../../src/lib/upload-store.js", () => ({
  saveNote: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCreateNote() {
  const { createNote } = await import("../../src/lib/api.js");
  return vi.mocked(createNote);
}

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useNoteUpload", () => {
  it("starts in idle state", async () => {
    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());

    expect(result.current.phase).toBe("idle");
    expect(result.current.shareLink).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("transitions idle → encrypting → uploading → done on success", async () => {
    const createNote = await getCreateNote();
    createNote.mockResolvedValueOnce({ id: "note-abc", expiresAt: "2099-01-01" });

    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());

    act(() => {
      result.current.upload({
        blocks: [{ type: "text", format: "plain", text: "hello" }],
        maxViews: 1,
        expireSec: 3600,
        password: "",
      });
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(result.current.shareLink).toContain("/note/note-abc");
    expect(result.current.error).toBeNull();
  });

  it("sets phase=error when createNote rejects", async () => {
    const createNote = await getCreateNote();
    createNote.mockRejectedValueOnce(new Error("server error"));

    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());

    act(() => {
      result.current.upload({
        blocks: [{ type: "text", format: "plain", text: "oops" }],
        maxViews: 1,
        expireSec: 3600,
        password: "",
      });
    });

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("server error");
  });

  it("reset() returns to idle state", async () => {
    const createNote = await getCreateNote();
    createNote.mockResolvedValueOnce({ id: "note-xyz", expiresAt: "2099-01-01" });

    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());

    act(() => {
      result.current.upload({
        blocks: [{ type: "text", format: "plain", text: "x" }],
        maxViews: 1,
        expireSec: 3600,
        password: "",
      });
    });
    await waitFor(() => expect(result.current.phase).toBe("done"));

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.shareLink).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("calls deriveKeyFromPassword when a password is provided", async () => {
    const createNote = await getCreateNote();
    createNote.mockResolvedValueOnce({ id: "note-pw", expiresAt: "2099-01-01" });

    const { deriveKeyFromPassword } = await import("@skysend/crypto");

    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());

    act(() => {
      result.current.upload({
        blocks: [{ type: "text", format: "plain", text: "secret" }],
        maxViews: 1,
        expireSec: 3600,
        password: "hunter2",
      });
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(vi.mocked(deriveKeyFromPassword)).toHaveBeenCalled();
  });

  it("createNote wirft Non-Error \u2192 error='Note creation failed'", async () => {
    const createNote = await getCreateNote();
    createNote.mockRejectedValueOnce("unexpected string throw");

    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());

    act(() => {
      result.current.upload({
        blocks: [{ type: "text", format: "plain", text: "hello" }],
        maxViews: 1,
        expireSec: 3600,
        password: "",
      });
    });

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("Note creation failed");
  });

  it("encrypts the blocks as one document and tells the server only that it is made of blocks", async () => {
    const createNote = await getCreateNote();
    createNote.mockResolvedValueOnce({ id: "note-blocks", expiresAt: "2099-01-01" });
    const crypto = await import("@skysend/crypto");
    const store = await import("../../src/lib/upload-store.js");

    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());
    const blocks = [
      { type: "text" as const, format: "markdown" as const, text: "# Access" },
      { type: "password" as const, entries: [{ label: "root", value: "pw" }] },
    ];

    act(() => {
      result.current.upload({ blocks, maxViews: 1, expireSec: 3600, password: "" });
    });
    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(vi.mocked(crypto.encryptNoteContent)).toHaveBeenCalledWith(
      JSON.stringify({ v: 1, blocks }),
      expect.anything(),
    );
    const request = createNote.mock.calls[0]![0];
    expect(request.contentType).toBe("blocks");
    // Nothing about the blocks goes into the request in plaintext.
    expect(JSON.stringify(request)).not.toMatch(/markdown|password|Access|root/);

    // The kinds are kept for "My Uploads", in this browser only.
    expect(vi.mocked(store.saveNote)).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-blocks", contentType: "blocks", kinds: ["markdown", "password"] }),
    );
  });
});
