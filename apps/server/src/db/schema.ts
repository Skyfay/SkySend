import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    ownerToken: text("owner_token").notNull(),
    authToken: text("auth_token").notNull(),
    salt: blob("salt", { mode: "buffer" }).notNull(),
    encryptedMeta: blob("encrypted_meta", { mode: "buffer" }),
    nonce: blob("nonce", { mode: "buffer" }),
    size: integer("size").notNull(),
    fileCount: integer("file_count").default(1).notNull(),
    hasPassword: integer("has_password", { mode: "boolean" }).default(false).notNull(),
    passwordSalt: blob("password_salt", { mode: "buffer" }),
    passwordAlgo: text("password_algo"),
    maxDownloads: integer("max_downloads").notNull(),
    downloadCount: integer("download_count").default(0).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    storagePath: text("storage_path").notNull(),
  },
  (table) => [index("idx_uploads_expires_at").on(table.expiresAt)],
);

export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
