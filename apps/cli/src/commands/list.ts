import { desc, and, eq, gt, sql, or } from "drizzle-orm";
import { uploads, notes, fileRequests, requestUploads } from "@skysend/server/db/schema";
import type { CliContext } from "../lib/context.js";
import { formatBytes, formatDate, formatDuration, table } from "../lib/format.js";

interface ListOptions {
  all?: boolean;
  json?: boolean;
}

export async function listUploads(ctx: CliContext, options: ListOptions): Promise<void> {
  const now = new Date();

  const uploadConditions = options.all
    ? undefined
    : and(
        gt(uploads.expiresAt, now),
        sql`${uploads.downloadCount} < ${uploads.maxDownloads}`,
      );

  const uploadResults = ctx.db
    .select()
    .from(uploads)
    .where(uploadConditions)
    .orderBy(desc(uploads.createdAt))
    .all();

  const noteConditions = options.all
    ? undefined
    : and(
        gt(notes.expiresAt, now),
        or(
          sql`${notes.maxViews} = 0`,
          sql`${notes.viewCount} < ${notes.maxViews}`,
        ),
      );

  const noteResults = ctx.db
    .select()
    .from(notes)
    .where(noteConditions)
    .orderBy(desc(notes.createdAt))
    .all();

  // A request stays listed while it takes uploads or still holds some.
  const requestResults = ctx.db
    .select()
    .from(fileRequests)
    .orderBy(desc(fileRequests.createdAt))
    .all()
    .map((request) => ({
      request,
      uploads: ctx.db
        .select()
        .from(requestUploads)
        .where(eq(requestUploads.requestId, request.id))
        .orderBy(desc(requestUploads.createdAt))
        .all(),
    }))
    .filter(
      ({ request, uploads: kept }) =>
        options.all || (!request.closed && request.closesAt > now) || kept.length > 0,
    );

  if (options.json) {
    // The vault, the tokens, the title and the wrapped keys stay out, like the salts above.
    const safeRequests = requestResults.map(({ request, uploads: kept }) => ({
      id: request.id,
      hasPassword: request.hasPassword,
      closed: request.closed,
      maxUploads: request.maxUploads,
      maxSize: request.maxSize,
      finishedUploads: request.finishedUploads,
      finishedBytes: request.finishedBytes,
      closesAt: request.closesAt.toISOString(),
      createdAt: request.createdAt.toISOString(),
      uploads: kept.map((u) => ({
        id: u.id,
        size: u.size,
        fileCount: u.fileCount,
        downloadCount: u.downloadCount,
        maxDownloads: u.maxDownloads,
        expiresAt: u.expiresAt.toISOString(),
        createdAt: u.createdAt.toISOString(),
      })),
    }));
    // Like notes, the tokens of an upload stay out too.
    const safeUploads = uploadResults.map(
      ({
        salt: _s,
        encryptedMeta: _e,
        nonce: _n,
        passwordSalt: _p,
        authToken: _a,
        ownerToken: _o,
        ...r
      }) => ({
        ...r,
        type: "upload" as const,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      }),
    );
    const safeNotes = noteResults.map(({ salt: _s, encryptedContent: _e, nonce: _n, passwordSalt: _p, authToken: _a, ownerToken: _o, ...r }) => ({
      ...r,
      type: "note" as const,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
    console.log(
      JSON.stringify({ uploads: safeUploads, notes: safeNotes, requests: safeRequests }, null, 2),
    );
    return;
  }

  if (uploadResults.length === 0 && noteResults.length === 0 && requestResults.length === 0) {
    console.log(
      options.all
        ? "No uploads, notes or file requests found."
        : "No active uploads, notes or file requests. Use --all to include expired.",
    );
    return;
  }

  if (uploadResults.length > 0) {
    const headers = ["ID", "Size", "Files", "DLs", "Expires", "Created"];
    const rows = uploadResults.map((u) => {
      const remaining = u.expiresAt.getTime() - now.getTime();
      return [
        u.id,
        formatBytes(u.size),
        String(u.fileCount),
        `${u.downloadCount}/${u.maxDownloads}`,
        formatDuration(remaining),
        formatDate(u.createdAt),
      ];
    });
    console.log("Uploads");
    console.log(table(headers, rows));
    console.log(`${uploadResults.length} upload(s)\n`);
  }

  if (noteResults.length > 0) {
    const headers = ["ID", "Type", "Views", "Expires", "Created"];
    const rows = noteResults.map((n) => {
      const remaining = n.expiresAt.getTime() - now.getTime();
      const views = n.maxViews === 0
        ? `${n.viewCount} / ∞`
        : `${n.viewCount}/${n.maxViews}`;
      return [
        n.id,
        n.contentType,
        views,
        formatDuration(remaining),
        formatDate(n.createdAt),
      ];
    });
    console.log("Notes");
    console.log(table(headers, rows));
    console.log(`${noteResults.length} note(s)\n`);
  }

  if (requestResults.length > 0) {
    const headers = ["ID", "Uploads", "Used", "Kept", "Closes", "Created"];
    const rows = requestResults.map(({ request, uploads: kept }) => [
      request.id,
      `${request.finishedUploads}/${request.maxUploads}`,
      `${formatBytes(request.finishedBytes)} / ${formatBytes(request.maxSize)}`,
      `${kept.length} (${formatBytes(kept.reduce((sum, u) => sum + u.size, 0))})`,
      request.closed ? "closed" : formatDuration(request.closesAt.getTime() - now.getTime()),
      formatDate(request.createdAt),
    ]);
    console.log("File requests");
    console.log(table(headers, rows));
    console.log(`${requestResults.length} file request(s)`);
  }
}
