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
    contentType: text("content_type").notNull(), // "blocks", or a legacy type: "text" | "password" | "code" | "markdown" | "sshkey"
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

/**
 * A file request: someone asks for files, senders upload them, only the requester opens them.
 *
 * The server holds the requester's private key only as the sealed vault, which opens with a
 * key derived from the inbox link. It never stores the public key, the brief in plaintext, or
 * anything that identifies the requester. The three tokens are derived and do not reverse.
 */
export const fileRequests = sqliteTable(
  "file_requests",
  {
    id: text("id").primaryKey(),
    vault: blob("vault", { mode: "buffer" }).notNull(),
    vaultNonce: blob("vault_nonce", { mode: "buffer" }).notNull(),
    inboxAuthToken: text("inbox_auth_token").notNull(),
    inboxOwnerToken: text("inbox_owner_token").notNull(),
    uploadToken: text("upload_token").notNull(),
    /**
     * The encrypted brief: title, what is asked for, the note template. Set for every request,
     * nullable only because migration 0004 renamed the columns of the title it replaced.
     */
    briefCiphertext: blob("brief_ciphertext", { mode: "buffer" }),
    briefNonce: blob("brief_nonce", { mode: "buffer" }),
    hasPassword: integer("has_password", { mode: "boolean" }).default(false).notNull(),
    maxUploads: integer("max_uploads").notNull(),
    /** Most bytes one upload may have. */
    maxSize: integer("max_size").notNull(),
    /** Uploads started or finished. An upload that is abandoned gives its slot back. */
    reservedUploads: integer("reserved_uploads").default(0).notNull(),
    /**
     * Uploads that finished. Never goes down, so a deleted upload keeps its slot. No session
     * survives a restart, so at startup the reservations are set back to this.
     */
    finishedUploads: integer("finished_uploads").default(0).notNull(),
    /** Bytes of uploads that finished. */
    finishedBytes: integer("finished_bytes").default(0).notNull(),
    closed: integer("closed", { mode: "boolean" }).default(false).notNull(),
    closesAt: integer("closes_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [index("idx_file_requests_closes_at").on(table.closesAt)],
);

export type FileRequest = typeof fileRequests.$inferSelect;
export type NewFileRequest = typeof fileRequests.$inferInsert;

/**
 * A file uploaded into a request. Kept apart from `uploads`, so no route for normal shares
 * can ever hand it out. The file secret is only stored wrapped to the requester's key.
 */
export const requestUploads = sqliteTable(
  "request_uploads",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => fileRequests.id, { onDelete: "cascade" }),
    size: integer("size").notNull(),
    fileCount: integer("file_count").default(1).notNull(),
    salt: blob("salt", { mode: "buffer" }).notNull(),
    wrapEnc: blob("wrap_enc", { mode: "buffer" }).notNull(),
    wrapCiphertext: blob("wrap_ciphertext", { mode: "buffer" }).notNull(),
    encryptedMeta: blob("encrypted_meta", { mode: "buffer" }).notNull(),
    metaNonce: blob("meta_nonce", { mode: "buffer" }).notNull(),
    maxDownloads: integer("max_downloads").notNull(),
    downloadCount: integer("download_count").default(0).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    storagePath: text("storage_path").notNull(),
  },
  (table) => [
    index("idx_request_uploads_request_id").on(table.requestId),
    index("idx_request_uploads_expires_at").on(table.expiresAt),
  ],
);

export type RequestUpload = typeof requestUploads.$inferSelect;
export type NewRequestUpload = typeof requestUploads.$inferInsert;

export const quotaUsage = sqliteTable("quota_usage", {
  hashedIp: text("hashed_ip").primaryKey(),
  bytesUsed: integer("bytes_used").default(0).notNull(),
  resetAt: integer("reset_at").notNull(),
});

export const quotaState = sqliteTable("quota_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
