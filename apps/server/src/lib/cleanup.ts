import { lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { notes, uploads } from "../db/schema.js";
import type { StorageBackend } from "../storage/types.js";

/**
 * Delete expired uploads and uploads that have reached their download limit.
 * Returns the number of deleted records.
 */
export async function runCleanup(storage: StorageBackend): Promise<number> {
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

  let deleted = 0;

  if (expiredUploads.length > 0) {
    // L-1 (Security Audit): Storage is deleted before the DB record intentionally
    // (fire-and-forget via Promise.allSettled). In the rare case of a server crash
    // between storage deletion and DB deletion, the DB record remains but the file
    // is gone - the next download attempt will return 500 instead of 404.
    // This is a non-critical edge case: there is no data leak (the file is already
    // gone), only a minor UX degradation. The DB record will be cleaned up on the
    // next cleanup run when the expiry/limit check fires again.
    await Promise.allSettled(
      expiredUploads.map((u) => storage.delete(u.id)),
    );

    // Delete from database
    for (const { id } of expiredUploads) {
      const result = db
        .delete(uploads)
        .where(sql`${uploads.id} = ${id}`)
        .run();
      deleted += result.changes;
    }
  }

  // Clean up expired notes and notes that have reached their view limit
  const expiredNotes = db
    .select({ id: notes.id })
    .from(notes)
    .where(
      or(
        lte(notes.expiresAt, now),
        sql`${notes.maxViews} > 0 AND ${notes.viewCount} >= ${notes.maxViews}`,
      ),
    )
    .all();

  for (const { id } of expiredNotes) {
    const result = db
      .delete(notes)
      .where(sql`${notes.id} = ${id}`)
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
  storage: StorageBackend,
  intervalSec: number,
): () => void {
  const intervalMs = intervalSec * 1000;

  const timer = setInterval(async () => {
    try {
      const deleted = await runCleanup(storage);
      if (deleted > 0) {
        console.log(`[cleanup] Removed ${deleted} expired record(s)`);
      }
    } catch (err) {
      console.error("[cleanup] Error during cleanup:", err);
    }
  }, intervalMs);

  timer.unref();

  return () => clearInterval(timer);
}
