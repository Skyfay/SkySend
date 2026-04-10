import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, insertTestUpload, TEST_UUID } from "./helpers.js";
import { uploads } from "../src/db/schema.js";

describe("database schema", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should create uploads table via migration", () => {
    const tables = ctx.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='uploads'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("should create expires_at index", () => {
    const indexes = ctx.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_uploads_expires_at'")
      .all();
    expect(indexes).toHaveLength(1);
  });

  it("should have drizzle migrations table", () => {
    const tables = ctx.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("should insert and retrieve an upload record", async () => {
    const values = insertTestUpload(ctx.db);

    const result = await ctx.db.query.uploads.findFirst({
      where: eq(uploads.id, TEST_UUID),
    });

    expect(result).toBeDefined();
    expect(result!.id).toBe(TEST_UUID);
    expect(result!.size).toBe(values.size);
    expect(result!.fileCount).toBe(1);
    expect(result!.hasPassword).toBe(false);
    expect(result!.downloadCount).toBe(0);
    expect(result!.maxDownloads).toBe(10);
  });

  it("should store and retrieve binary salt", async () => {
    const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
    insertTestUpload(ctx.db, { salt });

    const result = await ctx.db.query.uploads.findFirst({
      where: eq(uploads.id, TEST_UUID),
    });

    expect(Buffer.from(result!.salt)).toEqual(salt);
  });

  it("should store and retrieve encrypted metadata", async () => {
    insertTestUpload(ctx.db);

    const meta = Buffer.from("encrypted-metadata-bytes");
    const nonce = Buffer.from("twelve-bytes");

    ctx.db
      .update(uploads)
      .set({ encryptedMeta: meta, nonce })
      .where(eq(uploads.id, TEST_UUID))
      .run();

    const result = await ctx.db.query.uploads.findFirst({
      where: eq(uploads.id, TEST_UUID),
    });

    expect(Buffer.from(result!.encryptedMeta!)).toEqual(meta);
    expect(Buffer.from(result!.nonce!)).toEqual(nonce);
  });

  it("should delete an upload record", async () => {
    insertTestUpload(ctx.db);

    ctx.db.delete(uploads).where(eq(uploads.id, TEST_UUID)).run();

    const result = await ctx.db.query.uploads.findFirst({
      where: eq(uploads.id, TEST_UUID),
    });
    expect(result).toBeUndefined();
  });

  it("should handle multiple uploads", () => {
    insertTestUpload(ctx.db, { id: "550e8400-e29b-41d4-a716-446655440001", storagePath: "1.bin" });
    insertTestUpload(ctx.db, { id: "550e8400-e29b-41d4-a716-446655440002", storagePath: "2.bin" });
    insertTestUpload(ctx.db, { id: "550e8400-e29b-41d4-a716-446655440003", storagePath: "3.bin" });

    const all = ctx.db.select().from(uploads).all();
    expect(all).toHaveLength(3);
  });

  it("should set default created_at timestamp", async () => {
    insertTestUpload(ctx.db);

    const result = await ctx.db.query.uploads.findFirst({
      where: eq(uploads.id, TEST_UUID),
    });

    expect(result!.createdAt).toBeInstanceOf(Date);
  });
});
