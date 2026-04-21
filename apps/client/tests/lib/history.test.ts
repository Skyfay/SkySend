import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoredUpload, StoredNote } from "../../src/lib/history.js";

let tempDir: string;

async function freshHistory() {
  vi.resetModules();
  return import("../../src/lib/history.js");
}

function makeUpload(overrides: Partial<StoredUpload> = {}): StoredUpload {
  return {
    id: "upload-1",
    server: "https://send.example.com",
    url: "https://send.example.com/file/upload-1#secret",
    ownerToken: "token-abc",
    fileNames: ["file.txt"],
    totalSize: 1024,
    hasPassword: false,
    createdAt: new Date().toISOString(),
    expireSec: 86400,
    ...overrides,
  };
}

function makeNote(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    id: "note-1",
    server: "https://send.example.com",
    url: "https://send.example.com/note/note-1#secret",
    ownerToken: "token-xyz",
    contentType: "text/plain",
    hasPassword: false,
    createdAt: new Date().toISOString(),
    expireSec: 3600,
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "skysend-history-test-"));
  process.env["XDG_CONFIG_HOME"] = tempDir;
});

afterEach(() => {
  delete process.env["XDG_CONFIG_HOME"];
  rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

// ── Upload CRUD ───────────────────────────────────────────────────────────────

describe("uploads", () => {
  it("returns empty array when no history exists", async () => {
    const { getUploads } = await freshHistory();
    expect(getUploads()).toEqual([]);
  });

  it("adds and retrieves an upload", async () => {
    const { addUpload, getUploads } = await freshHistory();
    const upload = makeUpload();
    addUpload(upload);
    expect(getUploads()).toHaveLength(1);
    expect(getUploads()[0]).toMatchObject({ id: "upload-1" });
  });

  it("prepends new uploads (newest first)", async () => {
    const { addUpload, getUploads } = await freshHistory();
    addUpload(makeUpload({ id: "first" }));
    addUpload(makeUpload({ id: "second" }));
    const uploads = getUploads();
    expect(uploads[0]?.id).toBe("second");
    expect(uploads[1]?.id).toBe("first");
  });

  it("removes an upload by id", async () => {
    const { addUpload, removeUpload, getUploads } = await freshHistory();
    addUpload(makeUpload({ id: "keep" }));
    addUpload(makeUpload({ id: "delete-me" }));
    removeUpload("delete-me");
    const uploads = getUploads();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.id).toBe("keep");
  });

  it("does nothing when removing a non-existent id", async () => {
    const { addUpload, removeUpload, getUploads } = await freshHistory();
    addUpload(makeUpload({ id: "keep" }));
    removeUpload("nonexistent");
    expect(getUploads()).toHaveLength(1);
  });

  it("caps stored uploads at 100 entries", async () => {
    const { addUpload, getUploads } = await freshHistory();
    for (let i = 0; i < 105; i++) {
      addUpload(makeUpload({ id: `upload-${i}` }));
    }
    expect(getUploads()).toHaveLength(100);
  });

  it("keeps the most recent 100 when capped (oldest are dropped)", async () => {
    const { addUpload, getUploads } = await freshHistory();
    for (let i = 0; i < 105; i++) {
      addUpload(makeUpload({ id: `upload-${i}` }));
    }
    const uploads = getUploads();
    // The last one added should be at index 0 (newest first)
    expect(uploads[0]?.id).toBe("upload-104");
    // upload-0 through upload-4 should be gone
    const ids = uploads.map((u) => u.id);
    expect(ids).not.toContain("upload-0");
    expect(ids).not.toContain("upload-4");
    expect(ids).toContain("upload-5");
  });
});

// ── Note CRUD ─────────────────────────────────────────────────────────────────

describe("notes", () => {
  it("returns empty array when no history exists", async () => {
    const { getNotes } = await freshHistory();
    expect(getNotes()).toEqual([]);
  });

  it("adds and retrieves a note", async () => {
    const { addNote, getNotes } = await freshHistory();
    addNote(makeNote());
    expect(getNotes()).toHaveLength(1);
    expect(getNotes()[0]).toMatchObject({ id: "note-1" });
  });

  it("prepends new notes (newest first)", async () => {
    const { addNote, getNotes } = await freshHistory();
    addNote(makeNote({ id: "first" }));
    addNote(makeNote({ id: "second" }));
    expect(getNotes()[0]?.id).toBe("second");
  });

  it("removes a note by id", async () => {
    const { addNote, removeNote, getNotes } = await freshHistory();
    addNote(makeNote({ id: "keep" }));
    addNote(makeNote({ id: "gone" }));
    removeNote("gone");
    expect(getNotes()).toHaveLength(1);
    expect(getNotes()[0]?.id).toBe("keep");
  });

  it("caps stored notes at 100 entries", async () => {
    const { addNote, getNotes } = await freshHistory();
    for (let i = 0; i < 105; i++) {
      addNote(makeNote({ id: `note-${i}` }));
    }
    expect(getNotes()).toHaveLength(100);
  });
});

// ── cleanupExpired ────────────────────────────────────────────────────────────

describe("cleanupExpired", () => {
  it("removes uploads and notes whose expiry has passed", async () => {
    const { addUpload, addNote, cleanupExpired, getUploads, getNotes } =
      await freshHistory();

    const past = new Date(Date.now() - 2 * 86400 * 1000).toISOString(); // 2 days ago
    addUpload(makeUpload({ id: "expired-upload", createdAt: past, expireSec: 86400 }));
    addNote(makeNote({ id: "expired-note", createdAt: past, expireSec: 3600 }));

    const result = cleanupExpired();
    expect(result.removedUploads).toBe(1);
    expect(result.removedNotes).toBe(1);
    expect(getUploads()).toHaveLength(0);
    expect(getNotes()).toHaveLength(0);
  });

  it("keeps uploads and notes that have not yet expired", async () => {
    const { addUpload, addNote, cleanupExpired, getUploads, getNotes } =
      await freshHistory();

    const future = new Date().toISOString(); // expires in 1 day from now
    addUpload(makeUpload({ id: "active-upload", createdAt: future, expireSec: 86400 }));
    addNote(makeNote({ id: "active-note", createdAt: future, expireSec: 86400 }));

    const result = cleanupExpired();
    expect(result.removedUploads).toBe(0);
    expect(result.removedNotes).toBe(0);
    expect(getUploads()).toHaveLength(1);
    expect(getNotes()).toHaveLength(1);
  });

  it("returns zero counts and does not write if nothing expired", async () => {
    const { addUpload, cleanupExpired } = await freshHistory();
    addUpload(makeUpload({ expireSec: 86400 * 30 }));
    const result = cleanupExpired();
    expect(result.removedUploads).toBe(0);
    expect(result.removedNotes).toBe(0);
  });

  it("mixed: removes only expired entries, keeps non-expired ones", async () => {
    const { addUpload, cleanupExpired, getUploads } = await freshHistory();

    const past = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
    addUpload(makeUpload({ id: "expired", createdAt: past, expireSec: 86400 }));
    addUpload(makeUpload({ id: "active", expireSec: 86400 * 30 }));

    cleanupExpired();
    const remaining = getUploads();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("active");
  });
});

// ── Corrupt history file recovery ────────────────────────────────────────────

describe("corrupt history file recovery", () => {
  it("returns empty arrays when history.json contains invalid JSON", async () => {
    const { getUploads, getNotes } = await freshHistory();
    // Write corrupt file into the expected location
    const historyPath = join(tempDir, "skysend", "history.json");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tempDir, "skysend"), { recursive: true });
    writeFileSync(historyPath, "{ invalid json", "utf-8");
    expect(getUploads()).toEqual([]);
    expect(getNotes()).toEqual([]);
  });
});
