import { initDatabase, closeDatabase, getDb } from "@skysend/server/db";
import { loadConfig } from "@skysend/server/lib/config";
import { FileStorage } from "@skysend/server/storage/filesystem";
import type { Config } from "@skysend/server/lib/config";

export interface CliContext {
  config: Config;
  db: ReturnType<typeof getDb>;
  storage: FileStorage;
}

export function createContext(): CliContext {
  const config = loadConfig();
  const db = initDatabase(config.DATA_DIR);
  const storage = new FileStorage(config.DATA_DIR);
  return { config, db, storage };
}

export function destroyContext(): void {
  closeDatabase();
}
