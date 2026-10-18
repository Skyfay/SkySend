// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────────

// The encryption and the request are the shared core's, tested in packages/transfer.
vi.mock("@skysend/transfer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skysend/transfer")>()),
  createEncryptedNote: vi.fn(),
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

async function getCreateEncryptedNote() {
  const { createEncryptedNote } = await import("@skysend/transfer");
  return vi.mocked(createEncryptedNote);
}

function sharedNote(id: string) {
  return { id, ownerToken: "owner-token", effectiveSecret: "link-secret", hasPassword: false };
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

  it("transitions idle → encrypting → done on success", async () => {
    const createEncryptedNote = await getCreateEncryptedNote();
    createEncryptedNote.mockResolvedValueOnce(sharedNote("note-abc"));

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
    expect(result.current.phase).toBe("encrypting");

    await waitFor(() => expect(result.current.phase).toBe("done"));

    expect(result.current.shareLink).toBe(`${window.location.origin}/note/note-abc#link-secret`);
    expect(result.current.error).toBeNull();
  });

  it("sets phase=error when the note cannot be created", async () => {
    const createEncryptedNote = await getCreateEncryptedNote();
    createEncryptedNote.mockRejectedValueOnce(new Error("server error"));

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
    const createEncryptedNote = await getCreateEncryptedNote();
    createEncryptedNote.mockResolvedValueOnce(sharedNote("note-xyz"));

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

  it("hands the password, the limits and the Argon2id of the page to the core", async () => {
    const createEncryptedNote = await getCreateEncryptedNote();
    createEncryptedNote.mockResolvedValueOnce(sharedNote("note-pw"));
    const { hashWasmArgon2 } = await import("../../src/lib/argon2.js");
    const { createNote } = await import("../../src/lib/api.js");

    const { useNoteUpload } = await import("../../src/hooks/useNoteUpload.js");
    const { result } = renderHook(() => useNoteUpload());

    act(() => {
      result.current.upload({
        blocks: [{ type: "text", format: "plain", text: "secret" }],
        maxViews: 5,
        expireSec: 86400,
        password: "hunter2",
      });
    });

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(createEncryptedNote).toHaveBeenCalledWith(
      expect.objectContaining({
        api: { createNote },
        maxViews: 5,
        expireSec: 86400,
        password: "hunter2",
        argon2id: hashWasmArgon2,
      }),
    );
  });

  it("a non-Error throw sets error='Note creation failed'", async () => {
    const createEncryptedNote = await getCreateEncryptedNote();
    createEncryptedNote.mockRejectedValueOnce("unexpected string throw");

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
    const createEncryptedNote = await getCreateEncryptedNote();
    createEncryptedNote.mockResolvedValueOnce(sharedNote("note-blocks"));
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

    // The document, padded with spaces to whole blocks so its length hides how long the
    // password is.
    const document = JSON.stringify({ v: 1, blocks });
    const { plaintext, contentType } = createEncryptedNote.mock.calls[0]![0];
    expect(plaintext.length % 1024).toBe(0);
    expect(plaintext.trimEnd()).toBe(document);
    expect(contentType).toBe("blocks");

    // The kinds are kept for "My Uploads", in this browser only.
    expect(vi.mocked(store.saveNote)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "note-blocks",
        ownerToken: "owner-token",
        secret: "link-secret",
        contentType: "blocks",
        kinds: ["markdown", "password"],
      }),
    );
  });
});
