import { lte, or, sql } from "drizzle-orm";
import { runCleanup } from "@skysend/server/lib/cleanup";
import { uploads } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes } from "../lib/format.js";

interface CleanupOptions {
  dryRun?: boolean;
}

export async function runCleanupCommand(ctx: CliContext, options: CleanupOptions): Promise<void> {
  const now = new Date();

  // Find expired uploads (same criteria as the server cleanup job)
  const expired = ctx.db
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

  if (expired.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  const totalSize = expired.reduce((sum, u) => sum + u.size, 0);

  if (options.dryRun) {
    console.log(`Would remove ${expired.length} upload(s) (${formatBytes(totalSize)}):`);
    for (const u of expired) {
      console.log(`  ${u.id} (${formatBytes(u.size)}, ${u.fileCount} file(s))`);
    }
    return;
  }

  const deleted = await runCleanup(ctx.storage);
  console.log(`Cleaned up ${deleted} upload(s) (${formatBytes(totalSize)})`);
}
