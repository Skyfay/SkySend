import { eq } from "drizzle-orm";
import { uploads } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes } from "../lib/format.js";

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export async function deleteUpload(ctx: CliContext, id: string): Promise<void> {
  if (!UUID_RE.test(id)) {
    console.error("Invalid upload ID format. Expected a UUID.");
    process.exitCode = 1;
    return;
  }

  const upload = ctx.db
    .select({ id: uploads.id, size: uploads.size, fileCount: uploads.fileCount })
    .from(uploads)
    .where(eq(uploads.id, id))
    .get();

  if (!upload) {
    console.error(`Upload ${id} not found.`);
    process.exitCode = 1;
    return;
  }

  // Delete file from disk
  await ctx.storage.delete(id);

  // Delete from database
  ctx.db.delete(uploads).where(eq(uploads.id, id)).run();

  console.log(`Deleted upload ${id} (${formatBytes(upload.size)}, ${upload.fileCount} file(s))`);
}
