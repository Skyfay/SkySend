import { eq } from "drizzle-orm";
import { uploads, notes } from "@skysend/server/db/schema";
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

  console.error(`Upload or note ${id} not found.`);
  process.exitCode = 1;
}
