import { sql, gt, and, or } from "drizzle-orm";
import { uploads, notes } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes } from "../lib/format.js";

interface StatsOptions {
  json?: boolean;
}

export async function showStats(ctx: CliContext, options: StatsOptions): Promise<void> {
  const now = new Date();

  // Upload stats
  const totalResult = ctx.db
    .select({
      count: sql<number>`count(*)`,
      totalSize: sql<number>`coalesce(sum(${uploads.size}), 0)`,
      totalDownloads: sql<number>`coalesce(sum(${uploads.downloadCount}), 0)`,
    })
    .from(uploads)
    .get()!;

  const activeResult = ctx.db
    .select({
      count: sql<number>`count(*)`,
      totalSize: sql<number>`coalesce(sum(${uploads.size}), 0)`,
    })
    .from(uploads)
    .where(
      and(
        gt(uploads.expiresAt, now),
        sql`${uploads.downloadCount} < ${uploads.maxDownloads}`,
      ),
    )
    .get()!;

  // Note stats
  const totalNotes = ctx.db
    .select({
      count: sql<number>`count(*)`,
      totalViews: sql<number>`coalesce(sum(${notes.viewCount}), 0)`,
    })
    .from(notes)
    .get()!;

  const activeNotes = ctx.db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(notes)
    .where(
      and(
        gt(notes.expiresAt, now),
        or(
          sql`${notes.maxViews} = 0`,
          sql`${notes.viewCount} < ${notes.maxViews}`,
        ),
      ),
    )
    .get()!;

  const stats = {
    uploads: {
      total: totalResult.count,
      active: activeResult.count,
      expired: totalResult.count - activeResult.count,
      size: totalResult.totalSize,
      activeSize: activeResult.totalSize,
      downloads: totalResult.totalDownloads,
    },
    notes: {
      total: totalNotes.count,
      active: activeNotes.count,
      expired: totalNotes.count - activeNotes.count,
      views: totalNotes.totalViews,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log("Storage Overview");
  console.log("================");
  console.log(`Total uploads:    ${stats.uploads.total} (${formatBytes(stats.uploads.size)})`);
  console.log(`Active uploads:   ${stats.uploads.active} (${formatBytes(stats.uploads.activeSize)})`);
  console.log(`Expired uploads:  ${stats.uploads.expired}`);
  console.log(`Total downloads:  ${stats.uploads.downloads}`);
  console.log();
  console.log(`Total notes:      ${stats.notes.total}`);
  console.log(`Active notes:     ${stats.notes.active}`);
  console.log(`Expired notes:    ${stats.notes.expired}`);
  console.log(`Total views:      ${stats.notes.views}`);
}
