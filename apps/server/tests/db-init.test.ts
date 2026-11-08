import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { closeDatabase, initDatabase } from "../src/db/index.js";

describe("initDatabase", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "skysend-db-init-"));

  afterEach(() => {
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("leaves nothing of a deleted row in the database file", () => {
    const db = initDatabase(dataDir);
    const marker = "deleted-row-marker-".repeat(64);
    db.run(sql`CREATE TABLE leftovers (value TEXT)`);
    db.run(sql`INSERT INTO leftovers (value) VALUES (${marker})`);
    db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    db.run(sql`DELETE FROM leftovers`);
    db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    closeDatabase();

    const dbFile = join(dataDir, "db", "skysend.db");
    const files = [dbFile, `${dbFile}-wal`].filter((file) => existsSync(file));
    for (const file of files) {
      expect(readFileSync(file).includes("deleted-row-marker-")).toBe(false);
    }
  });
});
