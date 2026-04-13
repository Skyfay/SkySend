import { desc, and, gt, sql, or } from "drizzle-orm";
import { uploads, notes } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes, formatDate, formatDuration, table } from "../lib/format.js";

interface ListOptions {
  all?: boolean;
  json?: boolean;
}

export async function listUploads(ctx: CliContext, options: ListOptions): Promise<void> {
  const now = new Date();

  const uploadConditions = options.all
    ? undefined
    : and(
        gt(uploads.expiresAt, now),
        sql`${uploads.downloadCount} < ${uploads.maxDownloads}`,
      );

  const uploadResults = ctx.db
    .select()
    .from(uploads)
    .where(uploadConditions)
    .orderBy(desc(uploads.createdAt))
    .all();

  const noteConditions = options.all
    ? undefined
    : and(
        gt(notes.expiresAt, now),
        or(
          sql`${notes.maxViews} = 0`,
          sql`${notes.viewCount} < ${notes.maxViews}`,
        ),
      );

  const noteResults = ctx.db
    .select()
    .from(notes)
    .where(noteConditions)
    .orderBy(desc(notes.createdAt))
    .all();

  if (options.json) {
    const safeUploads = uploadResults.map(({ salt: _s, encryptedMeta: _e, nonce: _n, passwordSalt: _p, ...r }) => ({
      ...r,
      type: "upload" as const,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
    const safeNotes = noteResults.map(({ salt: _s, encryptedContent: _e, nonce: _n, passwordSalt: _p, authToken: _a, ownerToken: _o, ...r }) => ({
      ...r,
      type: "note" as const,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
    console.log(JSON.stringify({ uploads: safeUploads, notes: safeNotes }, null, 2));
    return;
  }

  if (uploadResults.length === 0 && noteResults.length === 0) {
    console.log(options.all ? "No uploads or notes found." : "No active uploads or notes. Use --all to include expired.");
    return;
  }

  if (uploadResults.length > 0) {
    const headers = ["ID", "Size", "Files", "DLs", "Expires", "Created"];
    const rows = uploadResults.map((u) => {
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
    console.log("Uploads");
    console.log(table(headers, rows));
    console.log(`${uploadResults.length} upload(s)\n`);
  }

  if (noteResults.length > 0) {
    const headers = ["ID", "Type", "Views", "Expires", "Created"];
    const rows = noteResults.map((n) => {
      const remaining = n.expiresAt.getTime() - now.getTime();
      const views = n.maxViews === 0
        ? `${n.viewCount} / ∞`
        : `${n.viewCount}/${n.maxViews}`;
      return [
        n.id,
        n.contentType,
        views,
        formatDuration(remaining),
        formatDate(n.createdAt),
      ];
    });
    console.log("Notes");
    console.log(table(headers, rows));
    console.log(`${noteResults.length} note(s)`);
  }
}
