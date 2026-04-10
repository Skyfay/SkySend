import { desc, and, gt, sql } from "drizzle-orm";
import { uploads } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes, formatDate, formatDuration, table } from "../lib/format.js";

interface ListOptions {
  all?: boolean;
  json?: boolean;
}

export async function listUploads(ctx: CliContext, options: ListOptions): Promise<void> {
  const now = new Date();

  const conditions = options.all
    ? undefined
    : and(
        gt(uploads.expiresAt, now),
        sql`${uploads.downloadCount} < ${uploads.maxDownloads}`,
      );

  const results = ctx.db
    .select()
    .from(uploads)
    .where(conditions)
    .orderBy(desc(uploads.createdAt))
    .all();

  if (options.json) {
    const safe = results.map(({ salt: _s, encryptedMeta: _e, nonce: _n, passwordSalt: _p, ...r }) => ({
      ...r,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
    console.log(JSON.stringify(safe, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(options.all ? "No uploads found." : "No active uploads. Use --all to include expired.");
    return;
  }

  const headers = ["ID", "Size", "Files", "DLs", "Expires", "Created"];
  const rows = results.map((u) => {
    const remaining = u.expiresAt.getTime() - now.getTime();
    return [
      u.id,
      formatBytes(u.size),
      String(u.fileCount),
      `${u.downloadCount}/${u.maxDownloads}`,
      formatDuration(remaining),
      formatDate(u.createdAt),
    ];
  });

  console.log(table(headers, rows));
  console.log(`\n${results.length} upload(s)`);
}
