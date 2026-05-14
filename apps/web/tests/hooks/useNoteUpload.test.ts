// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
        content: "hello",
        contentType: "text",
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
        content: "oops",
        contentType: "text",
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
        content: "x",
        contentType: "text",
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
        content: "secret",
        contentType: "password",
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
        content: "hello",
        contentType: "text",
        maxViews: 1,
        expireSec: 3600,
        password: "",
      });
    });

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("Note creation failed");
  });
});
