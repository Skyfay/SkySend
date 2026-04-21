import { describe, expect, it, beforeEach, vi } from "vitest";
import type { StoredUpload, StoredNote } from "../../src/lib/upload-store.js";

/**
 * Mock idb-keyval with a simple in-memory Map.
 * This avoids needing IndexedDB (unavailable in Node) while testing all logic
 * in upload-store.ts accurately.
 */
const store = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: (key: string) => Promise.resolve(store.get(key)),
  set: (key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  },
  del: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
  keys: () => Promise.resolve([...store.keys()]),
}));

// Import AFTER setting up the mock
const {
  saveUpload,
  getUpload,
  removeUpload,
  getAllUploads,
  clearExpiredUploads,
  saveNote,
  getNote,
  removeNote,
  getAllNotes,
  clearExpiredNotes,
} = await import("../../src/lib/upload-store.js");

function makeUpload(overrides: Partial<StoredUpload> = {}): StoredUpload {
  return {
    id: "upload-1",
    ownerToken: "tok",
    secret: "sec",
    fileNames: ["file.txt"],
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeNote(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    id: "note-1",
    ownerToken: "tok",
    secret: "sec",
    contentType: "text/plain",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
});

// ── Upload CRUD ───────────────────────────────────────────────────────────────

describe("saveUpload / getUpload", () => {
  it("saves and retrieves an upload by id", async () => {
    const upload = makeUpload();
    await saveUpload(upload);
    expect(await getUpload("upload-1")).toEqual(upload);
  });

  it("returns undefined for a non-existent upload", async () => {
    expect(await getUpload("missing")).toBeUndefined();
  });

  it("overwrites an existing upload with the same id", async () => {
    await saveUpload(makeUpload({ fileNames: ["old.txt"] }));
    await saveUpload(makeUpload({ fileNames: ["new.txt"] }));
    const result = await getUpload("upload-1");
    expect(result?.fileNames).toEqual(["new.txt"]);
  });
});

describe("removeUpload", () => {
  it("removes an upload so it can no longer be retrieved", async () => {
    await saveUpload(makeUpload());
    await removeUpload("upload-1");
    expect(await getUpload("upload-1")).toBeUndefined();
  });

  it("does not throw when removing a non-existent upload", async () => {
    await expect(removeUpload("nonexistent")).resolves.toBeUndefined();
  });
});

describe("getAllUploads", () => {
  it("returns empty array when no uploads are stored", async () => {
    expect(await getAllUploads()).toEqual([]);
  });

  it("returns all stored uploads", async () => {
    await saveUpload(makeUpload({ id: "a" }));
    await saveUpload(makeUpload({ id: "b" }));
    const uploads = await getAllUploads();
    expect(uploads).toHaveLength(2);
  });

  it("sorts uploads newest first by createdAt", async () => {
    await saveUpload(makeUpload({ id: "old", createdAt: "2024-01-01T00:00:00.000Z" }));
    await saveUpload(makeUpload({ id: "new", createdAt: "2024-06-01T00:00:00.000Z" }));
    const uploads = await getAllUploads();
    expect(uploads[0]?.id).toBe("new");
    expect(uploads[1]?.id).toBe("old");
  });

  it("does not include notes in the result", async () => {
    await saveUpload(makeUpload({ id: "upload-a" }));
    await saveNote(makeNote({ id: "note-a" }));
    const uploads = await getAllUploads();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.id).toBe("upload-a");
  });
});

// ── clearExpiredUploads ───────────────────────────────────────────────────────

describe("clearExpiredUploads", () => {
  it("removes uploads not in the active set", async () => {
    await saveUpload(makeUpload({ id: "active" }));
    await saveUpload(makeUpload({ id: "stale" }));
    await clearExpiredUploads(new Set(["active"]));
    expect(await getUpload("active")).toBeDefined();
    expect(await getUpload("stale")).toBeUndefined();
  });

  it("removes all uploads when active set is empty", async () => {
    await saveUpload(makeUpload({ id: "a" }));
    await saveUpload(makeUpload({ id: "b" }));
    await clearExpiredUploads(new Set());
    expect(await getAllUploads()).toHaveLength(0);
  });

  it("does not affect notes", async () => {
    await saveNote(makeNote({ id: "some-note" }));
    await clearExpiredUploads(new Set());
    expect(await getNote("some-note")).toBeDefined();
  });
});

// ── Note CRUD ─────────────────────────────────────────────────────────────────

describe("saveNote / getNote", () => {
  it("saves and retrieves a note by id", async () => {
    const note = makeNote();
    await saveNote(note);
    expect(await getNote("note-1")).toEqual(note);
  });

  it("returns undefined for a non-existent note", async () => {
    expect(await getNote("missing")).toBeUndefined();
  });
});

describe("removeNote", () => {
  it("removes a note so it can no longer be retrieved", async () => {
    await saveNote(makeNote());
    await removeNote("note-1");
    expect(await getNote("note-1")).toBeUndefined();
  });
});

describe("getAllNotes", () => {
  it("returns empty array when no notes are stored", async () => {
    expect(await getAllNotes()).toEqual([]);
  });

  it("sorts notes newest first by createdAt", async () => {
    await saveNote(makeNote({ id: "old", createdAt: "2024-01-01T00:00:00.000Z" }));
    await saveNote(makeNote({ id: "new", createdAt: "2024-06-01T00:00:00.000Z" }));
    const notes = await getAllNotes();
    expect(notes[0]?.id).toBe("new");
    expect(notes[1]?.id).toBe("old");
  });

  it("does not include uploads in the result", async () => {
    await saveNote(makeNote({ id: "note-a" }));
    await saveUpload(makeUpload({ id: "upload-a" }));
    const notes = await getAllNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("note-a");
  });
});

// ── clearExpiredNotes ─────────────────────────────────────────────────────────

describe("clearExpiredNotes", () => {
  it("removes notes not in the active set", async () => {
    await saveNote(makeNote({ id: "active" }));
    await saveNote(makeNote({ id: "stale" }));
    await clearExpiredNotes(new Set(["active"]));
    expect(await getNote("active")).toBeDefined();
    expect(await getNote("stale")).toBeUndefined();
  });

  it("does not affect uploads", async () => {
    await saveUpload(makeUpload({ id: "upload-a" }));
    await clearExpiredNotes(new Set());
    expect(await getUpload("upload-a")).toBeDefined();
  });
});
