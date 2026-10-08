import { and, eq, lte, notExists, or, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { fileRequests, notes, requestUploads, uploads } from "../db/schema.js";
import { SESSION_MAX_LIFETIME_MS } from "./chunked-upload.js";
import type { StorageBackend } from "../storage/types.js";
import { describeError } from "./log-error.js";

/**
 * An upload into a request can still finish as long as its session lives, because the
 * session started before the request closed. The request row stays until then, with a
 * margin for the finalize itself.
 */
export const REQUEST_GRACE_MS = SESSION_MAX_LIFETIME_MS + 5 * 60 * 1000;

/**
 * Deletes a file request with every upload in it, for the inbox and the admin CLI.
 *
 * The IDs are read and the request row deleted in one synchronous step, so an upload that
 * finishes meanwhile either is among the IDs or fails on the foreign key and drops its own
 * blob. The blobs go after that. Returns whether there was such a request.
 */
export async function deleteFileRequest(storage: StorageBackend, id: string): Promise<boolean> {
  const db = getDb();
  const { uploadIds, deleted } = db.transaction((tx) => {
    const rows = tx
      .select({ id: requestUploads.id })
      .from(requestUploads)
      .where(eq(requestUploads.requestId, id))
      .all();
    // The upload rows go with the request through the foreign key.
    const result = tx.delete(fileRequests).where(eq(fileRequests.id, id)).run();
    return { uploadIds: rows.map((row) => row.id), deleted: result.changes > 0 };
  });
  await Promise.allSettled(uploadIds.map((uploadId) => storage.delete(uploadId)));
  return deleted;
}

/**
 * Delete expired uploads and uploads that have reached their download limit, the same
 * for notes and for files uploaded into a request, and requests that are over and empty.
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

  // Files uploaded into a request, blob first like above
  const expiredRequestUploads = db
    .select({ id: requestUploads.id })
    .from(requestUploads)
    .where(
      or(
        lte(requestUploads.expiresAt, now),
        sql`${requestUploads.downloadCount} >= ${requestUploads.maxDownloads}`,
      ),
    )
    .all();

  if (expiredRequestUploads.length > 0) {
    await Promise.allSettled(expiredRequestUploads.map((u) => storage.delete(u.id)));
    for (const { id } of expiredRequestUploads) {
      deleted += db.delete(requestUploads).where(eq(requestUploads.id, id)).run().changes;
    }
  }

  // A request goes once it is over and no upload is left in it. Until then its inbox
  // still lists the uploads that are kept.
  deleted += db
    .delete(fileRequests)
    .where(
      and(
        lte(fileRequests.closesAt, new Date(now.getTime() - REQUEST_GRACE_MS)),
        notExists(
          db
            .select({ id: requestUploads.id })
            .from(requestUploads)
            .where(eq(requestUploads.requestId, fileRequests.id)),
        ),
      ),
    )
    .run().changes;

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
      console.error("[cleanup] Error during cleanup:", describeError(err));
    }
  }, intervalMs);

  timer.unref();

  return () => clearInterval(timer);
}
