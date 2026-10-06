import { eq } from "drizzle-orm";
import { uploads, notes, fileRequests, requestUploads } from "@skysend/server/db/schema";
import { deleteFileRequest } from "@skysend/server/lib/cleanup";
import type { CliContext } from "../lib/context.js";
import { formatBytes } from "../lib/format.js";

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export async function deleteUpload(ctx: CliContext, id: string): Promise<void> {
  if (!UUID_RE.test(id)) {
    console.error("Invalid ID format. Expected a UUID.");
    process.exitCode = 1;
    return;
  }

  // Try uploads first
  const upload = ctx.db
    .select({ id: uploads.id, size: uploads.size, fileCount: uploads.fileCount })
    .from(uploads)
    .where(eq(uploads.id, id))
    .get();

  if (upload) {
    await ctx.storage.delete(id);
    ctx.db.delete(uploads).where(eq(uploads.id, id)).run();
    console.log(`Deleted upload ${id} (${formatBytes(upload.size)}, ${upload.fileCount} file(s))`);
    return;
  }

  // Try notes
  const note = ctx.db
    .select({ id: notes.id, contentType: notes.contentType })
    .from(notes)
    .where(eq(notes.id, id))
    .get();

  if (note) {
    ctx.db.delete(notes).where(eq(notes.id, id)).run();
    console.log(`Deleted note ${id} (${note.contentType})`);
    return;
  }

  // A file request goes with every upload in it
  const request = ctx.db
    .select({ id: fileRequests.id })
    .from(fileRequests)
    .where(eq(fileRequests.id, id))
    .get();

  if (request) {
    const kept = ctx.db
      .select({ size: requestUploads.size })
      .from(requestUploads)
      .where(eq(requestUploads.requestId, id))
      .all();
    await deleteFileRequest(ctx.storage, id);
    const size = kept.reduce((sum, u) => sum + u.size, 0);
    console.log(`Deleted file request ${id} with ${kept.length} upload(s) (${formatBytes(size)})`);
    return;
  }

  // One upload inside a file request
  const requestUpload = ctx.db
    .select({
      id: requestUploads.id,
      size: requestUploads.size,
      requestId: requestUploads.requestId,
    })
    .from(requestUploads)
    .where(eq(requestUploads.id, id))
    .get();

  if (requestUpload) {
    await ctx.storage.delete(id);
    ctx.db.delete(requestUploads).where(eq(requestUploads.id, id)).run();
    console.log(
      `Deleted upload ${id} (${formatBytes(requestUpload.size)}) from file request ${requestUpload.requestId}`,
    );
    return;
  }

  console.error(`Upload, note or file request ${id} not found.`);
  process.exitCode = 1;
}
