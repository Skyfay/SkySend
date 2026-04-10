import { lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import type { FileStorage } from "../storage/filesystem.js";

/**
 * Delete expired uploads and uploads that have reached their download limit.
 * Returns the number of deleted records.
 */
export async function runCleanup(storage: FileStorage): Promise<number> {
  const db = getDb();
  const now = new Date();

  // Find all uploads that are either expired or have reached their download limit
  const expiredUploads = db
    .select({ id: uploads.id })
    .from(uploads)
    .where(
      or(
        lte(uploads.expiresAt, now),
        sql`${uploads.downloadCount} >= ${uploads.maxDownloads}`,
      ),
    )
    .all();

  if (expiredUploads.length === 0) return 0;

  // Delete files from disk
  await Promise.allSettled(
    expiredUploads.map((u) => storage.delete(u.id)),
  );

  // Delete from database
  const ids = expiredUploads.map((u) => u.id);
  let deleted = 0;
  for (const id of ids) {
    const result = db
      .delete(uploads)
      .where(sql`${uploads.id} = ${id}`)
      .run();
    deleted += result.changes;
  }

  return deleted;
}

/**
 * Start the periodic cleanup job.
 * Returns a function to stop the job.
 */
export function startCleanupJob(
  storage: FileStorage,
  intervalSec: number,
): () => void {
  const intervalMs = intervalSec * 1000;

  const timer = setInterval(async () => {
    try {
      const deleted = await runCleanup(storage);
      if (deleted > 0) {
        console.log(`[cleanup] Removed ${deleted} expired upload(s)`);
      }
    } catch (err) {
      console.error("[cleanup] Error during cleanup:", err);
    }
  }, intervalMs);

  timer.unref();

  return () => clearInterval(timer);
}
