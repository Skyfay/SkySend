import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, createTestStorage, insertTestUpload, insertTestNote, TEST_UUID } from "./helpers.js";
import { uploads, notes } from "../src/db/schema.js";

// We need to mock getDb since cleanup.ts imports it directly
vi.mock("../src/db/index.js", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../src/db/index.js";
import { runCleanup, startCleanupJob } from "../src/lib/cleanup.js";

describe("cleanup", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;

  beforeEach(async () => {
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
  });

  afterEach(() => {
    dbCtx.cleanup();
    storageCtx.cleanup();
    vi.restoreAllMocks();
  });

  function createStream(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  it("should delete expired uploads", async () => {
    const id = TEST_UUID;
    insertTestUpload(dbCtx.db, {
      id,
      expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
    });
    await storageCtx.storage.save(id, createStream(new Uint8Array([1, 2, 3])));

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(1);

    // DB record should be gone
    const result = await dbCtx.db.query.uploads.findFirst({
      where: eq(uploads.id, id),
    });
    expect(result).toBeUndefined();

    // File should be gone
    expect(await storageCtx.storage.exists(id)).toBe(false);
  });

  it("should delete uploads that reached download limit", async () => {
    const id = TEST_UUID;
    insertTestUpload(dbCtx.db, {
      id,
      maxDownloads: 5,
      downloadCount: 5,
      expiresAt: new Date(Date.now() + 86400 * 1000), // not expired
    });
    await storageCtx.storage.save(id, createStream(new Uint8Array([1])));

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(1);
  });

  it("should not delete active uploads", async () => {
    const id = TEST_UUID;
    insertTestUpload(dbCtx.db, {
      id,
      maxDownloads: 10,
      downloadCount: 3,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    });
    await storageCtx.storage.save(id, createStream(new Uint8Array([1])));

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(0);

    // Record should still exist
    const result = await dbCtx.db.query.uploads.findFirst({
      where: eq(uploads.id, id),
    });
    expect(result).toBeDefined();
    expect(await storageCtx.storage.exists(id)).toBe(true);
  });

  it("should return 0 when nothing to clean", async () => {
    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(0);
  });

  it("should handle missing files gracefully", async () => {
    insertTestUpload(dbCtx.db, {
      id: TEST_UUID,
      expiresAt: new Date(Date.now() - 1000),
    });
    // Don't create the file on disk

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(1);

    // DB record should still be cleaned
    const result = await dbCtx.db.query.uploads.findFirst({
      where: eq(uploads.id, TEST_UUID),
    });
    expect(result).toBeUndefined();
  });

  it("should clean multiple expired uploads", async () => {
    const ids = [
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440003",
    ];

    for (const id of ids) {
      insertTestUpload(dbCtx.db, {
        id,
        storagePath: `${id}.bin`,
        expiresAt: new Date(Date.now() - 1000),
      });
      await storageCtx.storage.save(id, createStream(new Uint8Array([1])));
    }

    // Also add one active upload
    const activeId = "550e8400-e29b-41d4-a716-446655440004";
    insertTestUpload(dbCtx.db, {
      id: activeId,
      storagePath: `${activeId}.bin`,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    });

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(3);

    // Active upload should remain
    const active = await dbCtx.db.query.uploads.findFirst({
      where: eq(uploads.id, activeId),
    });
    expect(active).toBeDefined();
  });

  // ── Note Cleanup ──────────────────────────────────────

  it("should delete expired notes", async () => {
    const noteId = "550e8400-e29b-41d4-a716-446655440010";
    insertTestNote(dbCtx.db, {
      id: noteId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(1);

    const result = await dbCtx.db.query.notes.findFirst({
      where: eq(notes.id, noteId),
    });
    expect(result).toBeUndefined();
  });

  it("should delete notes that reached view limit", async () => {
    const noteId = "550e8400-e29b-41d4-a716-446655440011";
    insertTestNote(dbCtx.db, {
      id: noteId,
      maxViews: 3,
      viewCount: 3,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    });

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(1);
  });

  it("should not delete active notes", async () => {
    const noteId = "550e8400-e29b-41d4-a716-446655440012";
    insertTestNote(dbCtx.db, {
      id: noteId,
      maxViews: 10,
      viewCount: 2,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    });

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(0);

    const result = await dbCtx.db.query.notes.findFirst({
      where: eq(notes.id, noteId),
    });
    expect(result).toBeDefined();
  });

  it("should not delete unlimited-view notes (maxViews=0)", async () => {
    const noteId = "550e8400-e29b-41d4-a716-446655440014";
    insertTestNote(dbCtx.db, {
      id: noteId,
      maxViews: 0,
      viewCount: 50,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    });

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(0);

    const result = await dbCtx.db.query.notes.findFirst({
      where: eq(notes.id, noteId),
    });
    expect(result).toBeDefined();
  });

  it("should clean both expired uploads and notes together", async () => {
    // Expired upload
    insertTestUpload(dbCtx.db, {
      id: TEST_UUID,
      expiresAt: new Date(Date.now() - 1000),
    });
    await storageCtx.storage.save(TEST_UUID, createStream(new Uint8Array([1])));

    // Expired note
    const noteId = "550e8400-e29b-41d4-a716-446655440013";
    insertTestNote(dbCtx.db, {
      id: noteId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const deleted = await runCleanup(storageCtx.storage);
    expect(deleted).toBe(2);
  });
});

// ── startCleanupJob ───────────────────────────────────────────────────────────

describe("startCleanupJob", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
  });

  afterEach(() => {
    vi.useRealTimers();
    dbCtx.cleanup();
    storageCtx.cleanup();
    vi.restoreAllMocks();
  });

  it("should run cleanup on each interval tick", async () => {
    // Mock storage.delete to avoid real I/O that outlives the fake timer advance
    const deleteSpy = vi.spyOn(storageCtx.storage, "delete").mockResolvedValue(undefined);

    insertTestUpload(dbCtx.db, {
      id: TEST_UUID,
      expiresAt: new Date(Date.now() - 1000),
    });

    const stop = startCleanupJob(storageCtx.storage, 60);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(deleteSpy).toHaveBeenCalledWith(TEST_UUID);
  });

  it("should return a stop function that cancels the interval", async () => {
    const deleteSpy = vi.spyOn(storageCtx.storage, "delete").mockResolvedValue(undefined);

    insertTestUpload(dbCtx.db, {
      id: TEST_UUID,
      expiresAt: new Date(Date.now() - 1000),
    });

    const stop = startCleanupJob(storageCtx.storage, 60);
    stop(); // Cancel BEFORE advancing time

    await vi.advanceTimersByTimeAsync(120_000);

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("should log when records are deleted", async () => {
    vi.spyOn(storageCtx.storage, "delete").mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    insertTestUpload(dbCtx.db, {
      id: TEST_UUID,
      expiresAt: new Date(Date.now() - 1000),
    });

    const stop = startCleanupJob(storageCtx.storage, 60);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Removed 1 expired record(s)"),
    );
  });

  it("should not log when nothing is deleted", async () => {
    vi.spyOn(storageCtx.storage, "delete").mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const stop = startCleanupJob(storageCtx.storage, 60);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("should catch errors and log them, then continue on next tick", async () => {
    vi.spyOn(storageCtx.storage, "delete").mockResolvedValue(undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // First tick throws, second tick should still run without crashing
    vi.mocked(getDb)
      .mockImplementationOnce(() => { throw new Error("DB unavailable"); })
      .mockReturnValue(dbCtx.db);

    const stop = startCleanupJob(storageCtx.storage, 60);
    await vi.advanceTimersByTimeAsync(60_000); // First tick - throws
    await vi.advanceTimersByTimeAsync(60_000); // Second tick - recovers
    stop();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[cleanup] Error"),
      expect.any(Error),
    );
  });
});
