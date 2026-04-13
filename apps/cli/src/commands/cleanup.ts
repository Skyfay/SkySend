import { lte, or, sql } from "drizzle-orm";
import { runCleanup } from "@skysend/server/lib/cleanup";
import { uploads, notes } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes } from "../lib/format.js";

interface CleanupOptions {
  dryRun?: boolean;
}

export async function runCleanupCommand(ctx: CliContext, options: CleanupOptions): Promise<void> {
  const now = new Date();

  // Find expired uploads
  const expiredUploads = ctx.db
    .select({
      id: uploads.id,
      size: uploads.size,
      fileCount: uploads.fileCount,
    })
    .from(uploads)
    .where(
      or(
        lte(uploads.expiresAt, now),
        sql`${uploads.downloadCount} >= ${uploads.maxDownloads}`,
      ),
    )
    .all();

  // Find expired notes
  const expiredNotes = ctx.db
    .select({
      id: notes.id,
      contentType: notes.contentType,
    })
    .from(notes)
    .where(
      or(
        lte(notes.expiresAt, now),
        sql`${notes.maxViews} > 0 AND ${notes.viewCount} >= ${notes.maxViews}`,
      ),
    )
    .all();

  if (expiredUploads.length === 0 && expiredNotes.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  const totalSize = expiredUploads.reduce((sum, u) => sum + u.size, 0);

  if (options.dryRun) {
    if (expiredUploads.length > 0) {
      console.log(`Would remove ${expiredUploads.length} upload(s) (${formatBytes(totalSize)}):`);
      for (const u of expiredUploads) {
        console.log(`  ${u.id} (${formatBytes(u.size)}, ${u.fileCount} file(s))`);
      }
    }
    if (expiredNotes.length > 0) {
      console.log(`Would remove ${expiredNotes.length} note(s):`);
      for (const n of expiredNotes) {
        console.log(`  ${n.id} (${n.contentType})`);
      }
    }
    return;
  }

  const deleted = await runCleanup(ctx.storage);
  console.log(`Cleaned up ${deleted} item(s) (${formatBytes(totalSize)} from uploads)`);
}
