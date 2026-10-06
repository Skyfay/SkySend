import { Hono, type Context } from "hono";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { Readable } from "node:stream";
import { getDb } from "../db/index.js";
import { fileRequests, requestUploads, type FileRequest } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { deleteFileRequest } from "../lib/cleanup.js";
import { encodeBytes, tokenHeader, tokenMatches, UUID_PATTERN } from "../lib/request-validation.js";
import type { PasswordLockout } from "../lib/password-lockout.js";
import { getClientIp } from "../middleware/rate-limit.js";
import { requestServiceGuard } from "../middleware/request-service.js";
import type { StorageBackend } from "../storage/types.js";

/** Which inbox token an endpoint needs: reading, or managing the request. */
type InboxTokenHeader = "X-Inbox-Token" | "X-Inbox-Owner-Token";

const notFound = (c: Context) => c.json({ error: "File request not found" }, 404);

/** An upload is listed and downloadable until it expires or its downloads are used up. */
const uploadAvailable = (now: Date) =>
  and(
    gt(requestUploads.expiresAt, now),
    sql`${requestUploads.downloadCount} < ${requestUploads.maxDownloads}`,
  );

export interface InboxRouteOptions {
  storage: StorageBackend;
  /** Shared with the password and note routes. */
  lockout: PasswordLockout;
}

/**
 * /api/inbox: everything the requester does with a request, behind the two inbox tokens.
 *
 * Files uploaded into a request are reachable here only. They are not rows of `uploads`,
 * so /api/download, /api/info and /api/exists never find them.
 */
export function createInboxRoute({ storage, lockout }: InboxRouteOptions) {
  const route = new Hono();
  route.use("*", requestServiceGuard);

  /**
   * The request, if the token in `header` matches. A password protected inbox derives its
   * tokens from the password, so a wrong token counts as a failed attempt and locks the
   * request for this IP like a wrong password does.
   */
  async function authorize(
    c: Context,
    header: InboxTokenHeader,
  ): Promise<{ request: FileRequest } | { response: Response }> {
    const id = c.req.param("id") ?? "";
    if (!UUID_PATTERN.test(id)) return { response: notFound(c) };
    // A request without a well-formed token is no guess at one. Counting it would let any
    // page lock the requester out with a few image tags, which send no custom header.
    if (!tokenHeader(c.req.header(header))) return { response: notFound(c) };

    const ip = getClientIp(c, getConfig().TRUST_PROXY);
    const resourceKey = `request:${id}`;
    const lockState = lockout.check(resourceKey, ip);
    if (lockState.locked) {
      c.header("Retry-After", String(lockState.retryAfter));
      return { response: c.json({ error: "Too many failed attempts. Try again later." }, 429) };
    }

    // A request that does not exist counts as a failure too, so the lockout does not tell
    // which IDs exist. The lockout forgets failures that led to no lock after a while.
    const request = await getDb().query.fileRequests.findFirst({ where: eq(fileRequests.id, id) });
    const stored = header === "X-Inbox-Token" ? request?.inboxAuthToken : request?.inboxOwnerToken;
    if (!request || !stored || !tokenMatches(c.req.header(header), stored)) {
      lockout.recordFailure(resourceKey, ip);
      return { response: notFound(c) };
    }
    lockout.recordSuccess(resourceKey, ip);
    return { request };
  }

  /**
   * GET /api/inbox/:id
   * The vault, the encrypted title and every upload that can still be downloaded, with its
   * wrapped file secret. Listing never counts as a download.
   */
  route.get("/:id", async (c) => {
    const auth = await authorize(c, "X-Inbox-Token");
    if ("response" in auth) return auth.response;
    const { request } = auth;

    const uploads = getDb()
      .select()
      .from(requestUploads)
      .where(and(eq(requestUploads.requestId, request.id), uploadAvailable(new Date())))
      .orderBy(asc(requestUploads.createdAt))
      .all();

    return c.json({
      vault: encodeBytes(request.vault),
      vaultNonce: encodeBytes(request.vaultNonce),
      title:
        request.titleCiphertext && request.titleNonce
          ? {
              ciphertext: encodeBytes(request.titleCiphertext),
              nonce: encodeBytes(request.titleNonce),
            }
          : null,
      hasPassword: request.hasPassword,
      open: !request.closed && request.closesAt > new Date(),
      closesAt: request.closesAt.toISOString(),
      createdAt: request.createdAt.toISOString(),
      maxUploads: request.maxUploads,
      maxSize: request.maxSize,
      // Uploads that finished, deleted ones included. Running ones are not counted.
      usedUploads: request.finishedUploads,
      usedBytes: request.finishedBytes,
      uploads: uploads.map((upload) => ({
        id: upload.id,
        size: upload.size,
        fileCount: upload.fileCount,
        salt: encodeBytes(upload.salt),
        wrapEnc: encodeBytes(upload.wrapEnc),
        wrapCiphertext: encodeBytes(upload.wrapCiphertext),
        encryptedMeta: encodeBytes(upload.encryptedMeta),
        metaNonce: encodeBytes(upload.metaNonce),
        downloadCount: upload.downloadCount,
        maxDownloads: upload.maxDownloads,
        expiresAt: upload.expiresAt.toISOString(),
        createdAt: upload.createdAt.toISOString(),
      })),
    });
  });

  /**
   * GET /api/inbox/:id/file/:uid
   * Streams one upload, or hands out a presigned S3 URL, and counts the download.
   */
  route.get("/:id/file/:uid", async (c) => {
    const auth = await authorize(c, "X-Inbox-Token");
    if ("response" in auth) return auth.response;
    const uid = c.req.param("uid");
    const now = new Date();

    const db = getDb();
    const upload = UUID_PATTERN.test(uid)
      ? await db.query.requestUploads.findFirst({
          where: and(eq(requestUploads.id, uid), eq(requestUploads.requestId, auth.request.id)),
        })
      : undefined;
    if (!upload) return c.json({ error: "Upload not found" }, 404);
    if (upload.expiresAt <= now || upload.downloadCount >= upload.maxDownloads) {
      return c.json({ error: "Upload is no longer available" }, 410);
    }
    if (!(await storage.exists(upload.id))) {
      return c.json({ error: "File not found on disk" }, 500);
    }

    // The same check again in the update, so parallel downloads can never pass the limit.
    const counted = db
      .update(requestUploads)
      .set({ downloadCount: sql`${requestUploads.downloadCount} + 1` })
      .where(and(eq(requestUploads.id, upload.id), uploadAvailable(now)))
      .run();
    if (counted.changes === 0) {
      return c.json({ error: "Upload is no longer available" }, 410);
    }

    if (storage.supportsPresignedUrls()) {
      const url = await storage.getPresignedDownloadUrl(upload.id);
      return c.json({ url, size: upload.size, fileCount: upload.fileCount });
    }
    const stream = Readable.toWeb(storage.createReadStream(upload.id)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(upload.size),
        "Cache-Control": "no-store",
        "X-File-Count": String(upload.fileCount),
      },
    });
  });

  /**
   * DELETE /api/inbox/:id/file/:uid
   * Deletes one upload. Its slot stays used, so a request never takes more than it allowed.
   */
  route.delete("/:id/file/:uid", async (c) => {
    const auth = await authorize(c, "X-Inbox-Owner-Token");
    if ("response" in auth) return auth.response;
    const uid = c.req.param("uid");
    const db = getDb();
    const upload = UUID_PATTERN.test(uid)
      ? await db.query.requestUploads.findFirst({
          where: and(eq(requestUploads.id, uid), eq(requestUploads.requestId, auth.request.id)),
        })
      : undefined;
    if (!upload) return c.json({ error: "Upload not found" }, 404);

    await storage.delete(upload.id);
    db.delete(requestUploads).where(eq(requestUploads.id, upload.id)).run();
    return c.json({ ok: true });
  });

  /**
   * POST /api/inbox/:id/close
   * Stops new uploads. Uploads that already started still finish.
   */
  route.post("/:id/close", async (c) => {
    const auth = await authorize(c, "X-Inbox-Owner-Token");
    if ("response" in auth) return auth.response;
    getDb()
      .update(fileRequests)
      .set({ closed: true })
      .where(eq(fileRequests.id, auth.request.id))
      .run();
    return c.json({ ok: true });
  });

  /**
   * DELETE /api/inbox/:id
   * Deletes the request with every upload in it.
   */
  route.delete("/:id", async (c) => {
    const auth = await authorize(c, "X-Inbox-Owner-Token");
    if ("response" in auth) return auth.response;
    await deleteFileRequest(storage, auth.request.id);
    return c.json({ ok: true });
  });

  return route;
}
