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

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    ownerToken: text("owner_token").notNull(),
    authToken: text("auth_token").notNull(),
    salt: blob("salt", { mode: "buffer" }).notNull(),
    encryptedContent: blob("encrypted_content", { mode: "buffer" }).notNull(),
    nonce: blob("nonce", { mode: "buffer" }).notNull(),
    contentType: text("content_type").notNull(), // "text" | "password" | "code"
    hasPassword: integer("has_password", { mode: "boolean" }).default(false).notNull(),
    passwordSalt: blob("password_salt", { mode: "buffer" }),
    passwordAlgo: text("password_algo"),
    maxViews: integer("max_views").notNull(),
    viewCount: integer("view_count").default(0).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index("idx_notes_expires_at").on(table.expiresAt)],
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

export const quotaUsage = sqliteTable("quota_usage", {
  hashedIp: text("hashed_ip").primaryKey(),
  bytesUsed: integer("bytes_used").default(0).notNull(),
  resetAt: integer("reset_at").notNull(),
});

export const quotaState = sqliteTable("quota_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
