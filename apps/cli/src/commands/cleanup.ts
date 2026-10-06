import { eq, lte, or, sql } from "drizzle-orm";
import { REQUEST_GRACE_MS, runCleanup } from "@skysend/server/lib/cleanup";
import { uploads, notes, fileRequests, requestUploads } from "@skysend/server/db/schema";
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

  // Files uploaded into a request that expired or used up their downloads
  const expiredRequestUploads = ctx.db
    .select({
      id: requestUploads.id,
      size: requestUploads.size,
      requestId: requestUploads.requestId,
    })
    .from(requestUploads)
    .where(
      or(
        lte(requestUploads.expiresAt, now),
        sql`${requestUploads.downloadCount} >= ${requestUploads.maxDownloads}`,
      ),
    )
    .all();

  // Requests that are over and keep no upload once the expired ones are gone
  const expiredIds = new Set(expiredRequestUploads.map((u) => u.id));
  const expiredRequests = ctx.db
    .select({ id: fileRequests.id })
    .from(fileRequests)
    .where(lte(fileRequests.closesAt, new Date(now.getTime() - REQUEST_GRACE_MS)))
    .all()
    .filter(({ id }) =>
      ctx.db
        .select({ id: requestUploads.id })
        .from(requestUploads)
        .where(eq(requestUploads.requestId, id))
        .all()
        .every((u) => expiredIds.has(u.id)),
    );

  if (
    expiredUploads.length === 0 &&
    expiredNotes.length === 0 &&
    expiredRequestUploads.length === 0 &&
    expiredRequests.length === 0
  ) {
    console.log("Nothing to clean up.");
    return;
  }

  const totalSize =
    expiredUploads.reduce((sum, u) => sum + u.size, 0) +
    expiredRequestUploads.reduce((sum, u) => sum + u.size, 0);

  if (options.dryRun) {
    if (expiredUploads.length > 0) {
      console.log(`Would remove ${expiredUploads.length} upload(s):`);
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
    if (expiredRequestUploads.length > 0) {
      console.log(`Would remove ${expiredRequestUploads.length} upload(s) from file requests:`);
      for (const u of expiredRequestUploads) {
        console.log(`  ${u.id} (${formatBytes(u.size)}) in request ${u.requestId}`);
      }
    }
    if (expiredRequests.length > 0) {
      console.log(
        `Would remove ${expiredRequests.length} file request(s) that are over and empty:`,
      );
      for (const r of expiredRequests) {
        console.log(`  ${r.id}`);
      }
    }
    console.log(`Total: ${formatBytes(totalSize)}`);
    return;
  }

  const deleted = await runCleanup(ctx.storage);
  console.log(`Cleaned up ${deleted} item(s) (${formatBytes(totalSize)} of files)`);
}
