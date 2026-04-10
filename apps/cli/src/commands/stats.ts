import { sql, gt, and } from "drizzle-orm";
import { uploads } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes } from "../lib/format.js";

interface StatsOptions {
  json?: boolean;
}

export async function showStats(ctx: CliContext, options: StatsOptions): Promise<void> {
  const now = new Date();

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

  const stats = {
    total: {
      count: totalResult.count,
      size: totalResult.totalSize,
      downloads: totalResult.totalDownloads,
    },
    active: {
      count: activeResult.count,
      size: activeResult.totalSize,
    },
    expired: {
      count: totalResult.count - activeResult.count,
      size: totalResult.totalSize - activeResult.totalSize,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log("Storage Overview");
  console.log("================");
  console.log(`Total uploads:    ${stats.total.count} (${formatBytes(stats.total.size)})`);
  console.log(`Active uploads:   ${stats.active.count} (${formatBytes(stats.active.size)})`);
  console.log(`Expired uploads:  ${stats.expired.count} (${formatBytes(stats.expired.size)})`);
  console.log(`Total downloads:  ${stats.total.downloads}`);
}
