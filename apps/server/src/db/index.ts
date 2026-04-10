import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _sqlite: Database.Database | undefined;

/**
 * Initialize the SQLite database connection with optimal settings.
 * Creates the data directory and database file if they do not exist.
 */
export function initDatabase(dataDir: string): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, "skysend.db");
  const sqlite = new Database(dbPath);

  // Apply SQLite performance and safety pragmas
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  // Create tables if they do not exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id              TEXT PRIMARY KEY,
      owner_token     TEXT NOT NULL,
      auth_token      TEXT NOT NULL,
      salt            BLOB NOT NULL,
      encrypted_meta  BLOB,
      nonce           BLOB,
      size            INTEGER NOT NULL,
      file_count      INTEGER NOT NULL DEFAULT 1,
      has_password    INTEGER NOT NULL DEFAULT 0,
      password_salt   BLOB,
      password_algo   TEXT,
      max_downloads   INTEGER NOT NULL,
      download_count  INTEGER NOT NULL DEFAULT 0,
      expires_at      INTEGER NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      storage_path    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uploads_expires_at ON uploads(expires_at);
  `);

  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

/**
 * Get the already-initialized database. Throws if initDatabase() has not been called.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) throw new Error("Database not initialized. Call initDatabase() first.");
  return _db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = undefined;
    _db = undefined;
  }
}
