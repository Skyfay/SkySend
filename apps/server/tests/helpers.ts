import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as schema from "../src/db/schema.js";
import { FileStorage } from "../src/storage/filesystem.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(currentDir, "../src/db/migrations");

/**
 * Create an isolated test database with migrations applied.
 * Each test gets its own temp directory and SQLite instance.
 */
export function createTestDb() {
  const tempDir = mkdtempSync(join(tmpdir(), "skysend-test-"));
  const dbPath = join(tempDir, "test.db");
  const sqlite = new Database(dbPath);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });

  return {
    db,
    sqlite,
    tempDir,
    cleanup() {
      sqlite.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a FileStorage instance in a temp directory.
 */
export async function createTestStorage() {
  const tempDir = mkdtempSync(join(tmpdir(), "skysend-storage-"));
  const storage = new FileStorage(tempDir);
  await storage.init();

  return {
    storage,
    tempDir,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/** A valid UUID for testing */
export const TEST_UUID = "550e8400-e29b-41d4-a716-446655440000";

/** Generate a fake base64url token (32 bytes) */
export function fakeBase64urlToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** Insert a test upload record into the database */
export function insertTestUpload(
  db: ReturnType<typeof drizzle<typeof schema>>,
  overrides: Partial<schema.NewUpload> = {},
) {
  const defaults: schema.NewUpload = {
    id: TEST_UUID,
    ownerToken: fakeBase64urlToken(),
    authToken: fakeBase64urlToken(),
    salt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
    size: 1024,
    fileCount: 1,
    hasPassword: false,
    maxDownloads: 10,
    downloadCount: 0,
    expiresAt: new Date(Date.now() + 86400 * 1000),
    createdAt: new Date(),
    storagePath: `${TEST_UUID}.bin`,
  };

  const values = { ...defaults, ...overrides };
  db.insert(schema.uploads).values(values).run();
  return values;
}
