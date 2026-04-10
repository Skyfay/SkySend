import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _sqlite: Database.Database | undefined;

/**
 * Initialize the SQLite database connection with optimal settings.
 * Creates the data directory and database file if they do not exist.
 * Automatically runs pending migrations on startup.
 */
export function initDatabase(dataDir: string): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, "skysend.db");
  const sqlite = new Database(dbPath);

  // Apply SQLite performance and safety pragmas
  sqlite.pragma("journal_mode = WAL");
  const walMode = sqlite.pragma("journal_mode", { simple: true });
  if (walMode !== "wal") {
    throw new Error(`Failed to enable WAL mode (got: ${walMode})`);
  }
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });

  // Run pending migrations automatically
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = join(currentDir, "migrations");
  migrate(_db, { migrationsFolder });

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
