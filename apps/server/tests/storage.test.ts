import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTestStorage, TEST_UUID } from "./helpers.js";
import type { FileStorage } from "../src/storage/filesystem.js";

describe("FileStorage", () => {
  let storage: FileStorage;
  let cleanup: () => void;

  beforeEach(async () => {
    const ctx = await createTestStorage();
    storage = ctx.storage;
    cleanup = ctx.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  function createStream(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  describe("save", () => {
    it("should save a stream to disk and return bytes written", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const bytes = await storage.save(TEST_UUID, createStream(data));
      expect(bytes).toBe(5);
    });

    it("should save large data correctly", async () => {
      const data = new Uint8Array(100_000);
      for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
      const bytes = await storage.save(TEST_UUID, createStream(data));
      expect(bytes).toBe(100_000);
    });
  });

  describe("exists", () => {
    it("should return false for non-existent file", async () => {
      expect(await storage.exists(TEST_UUID)).toBe(false);
    });

    it("should return true after saving", async () => {
      await storage.save(TEST_UUID, createStream(new Uint8Array([1])));
      expect(await storage.exists(TEST_UUID)).toBe(true);
    });
  });

  describe("size", () => {
    it("should return null for non-existent file", async () => {
      expect(await storage.size(TEST_UUID)).toBeNull();
    });

    it("should return correct size after saving", async () => {
      const data = new Uint8Array(42);
      await storage.save(TEST_UUID, createStream(data));
      expect(await storage.size(TEST_UUID)).toBe(42);
    });
  });

  describe("delete", () => {
    it("should delete an existing file", async () => {
      await storage.save(TEST_UUID, createStream(new Uint8Array([1])));
      expect(await storage.exists(TEST_UUID)).toBe(true);

      await storage.delete(TEST_UUID);
      expect(await storage.exists(TEST_UUID)).toBe(false);
    });

    it("should not throw when deleting non-existent file", async () => {
      await expect(storage.delete(TEST_UUID)).resolves.toBeUndefined();
    });
  });

  describe("createReadStream", () => {
    it("should read back saved data", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      await storage.save(TEST_UUID, createStream(data));

      const readStream = storage.createReadStream(TEST_UUID);
      const chunks: Buffer[] = [];
      for await (const chunk of readStream) {
        chunks.push(chunk as Buffer);
      }
      const result = Buffer.concat(chunks);
      expect(new Uint8Array(result)).toEqual(data);
    });
  });

  describe("getPath", () => {
    it("should return a valid path for a UUID", () => {
      const path = storage.getPath(TEST_UUID);
      expect(path).toContain(TEST_UUID);
      expect(path).toMatch(/\.bin$/);
    });

    it("should reject path traversal attempts", () => {
      expect(() => storage.getPath("../../../etc/passwd")).toThrow("Invalid upload ID format");
    });

    it("should reject non-UUID strings", () => {
      expect(() => storage.getPath("not-a-valid-uuid")).toThrow("Invalid upload ID format");
    });

    it("should reject empty string", () => {
      expect(() => storage.getPath("")).toThrow("Invalid upload ID format");
    });

    it("should reject IDs with uppercase", () => {
      expect(() => storage.getPath("550E8400-E29B-41D4-A716-446655440000")).toThrow("Invalid upload ID format");
    });
  });

  describe("clear", () => {
    it("should remove all files", async () => {
      await storage.save(TEST_UUID, createStream(new Uint8Array([1])));
      const uuid2 = "550e8400-e29b-41d4-a716-446655440001";
      await storage.save(uuid2, createStream(new Uint8Array([2])));

      await storage.clear();

      expect(await storage.exists(TEST_UUID)).toBe(false);
      expect(await storage.exists(uuid2)).toBe(false);
    });
  });
});
