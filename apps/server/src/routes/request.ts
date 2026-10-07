import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  REQUEST_NONCE_LENGTH,
  REQUEST_TITLE_MAX_CIPHERTEXT_LENGTH,
  REQUEST_TOKEN_LENGTH,
  REQUEST_VAULT_LENGTH,
  META_IV_LENGTH,
  SALT_LENGTH,
  WRAP_CIPHERTEXT_LENGTH,
  WRAP_ENC_LENGTH,
} from "@skysend/crypto";
import { getDb } from "../db/index.js";
import { fileRequests, requestUploads, type FileRequest } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { createChunkedUploads } from "../lib/chunked-upload.js";
import {
  base64urlBytes,
  encodeBytes,
  hashToken,
  tokenMatches,
  UUID_PATTERN,
} from "../lib/request-validation.js";
import { validateUploadSize } from "../lib/upload-validation.js";
import type { RequestLimiter } from "../lib/request-limit.js";
import { getClientIp } from "../middleware/rate-limit.js";
import type { OidcGuardVariables } from "../middleware/oidc-guard.js";
import type { createUploadQuota } from "../middleware/quota.js";
import { requestServiceGuard } from "../middleware/request-service.js";
import { createWsUploadHandler, type WsUploadRefusal } from "../lib/ws-upload.js";
import type { StorageBackend } from "../storage/types.js";
import type { QuotaVariables } from "../types.js";

/** What an upload session into a request remembers until finalize. */
interface RequestUploadSession {
  requestId: string;
  salt: Buffer;
  fileCount: number;
  contentLength: number;
}

const createSchema = z
  .object({
    vault: base64urlBytes(REQUEST_VAULT_LENGTH),
    vaultNonce: base64urlBytes(REQUEST_NONCE_LENGTH),
    inboxAuthToken: base64urlBytes(REQUEST_TOKEN_LENGTH),
    inboxOwnerToken: base64urlBytes(REQUEST_TOKEN_LENGTH),
    uploadToken: base64urlBytes(REQUEST_TOKEN_LENGTH),
    title: z
      .object({
        ciphertext: base64urlBytes(16, REQUEST_TITLE_MAX_CIPHERTEXT_LENGTH),
        nonce: base64urlBytes(REQUEST_NONCE_LENGTH),
      })
      .strict()
      .nullable()
      .default(null),
    expireSec: z.number().int().positive(),
    maxUploads: z.number().int().positive(),
    maxSize: z.number().int().positive(),
    hasPassword: z.boolean().default(false),
  })
  .strict();

const initSchema = z.object({
  salt: base64urlBytes(SALT_LENGTH),
  contentLength: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()),
  fileCount: z
    .string()
    .regex(/^\d+$/)
    .default("1")
    .transform(Number)
    .pipe(z.number().int().positive()),
});

/** The 100 000 base64 characters POST /api/meta accepts, as bytes. */
const MAX_ENCRYPTED_META_BYTES = 75_000;

const finalizeSchema = z
  .object({
    wrapEnc: base64urlBytes(WRAP_ENC_LENGTH),
    wrapCiphertext: base64urlBytes(WRAP_CIPHERTEXT_LENGTH),
    // At least the AES-GCM tag and one byte of JSON.
    encryptedMeta: base64urlBytes(17, MAX_ENCRYPTED_META_BYTES),
    metaNonce: base64urlBytes(META_IV_LENGTH),
  })
  .strict();

function isOpen(request: FileRequest, now = new Date()): boolean {
  return !request.closed && request.closesAt > now;
}

/** Gives the slot of an upload that did not finish back to its request. */
function release(requestId: string): void {
  getDb()
    .update(fileRequests)
    .set({ reservedUploads: sql`max(${fileRequests.reservedUploads} - 1, 0)` })
    .where(eq(fileRequests.id, requestId))
    .run();
}

/**
 * The request behind an upload link, if the X-Upload-Token header matches. Anything else
 * looks like a request that does not exist, so the endpoint reveals nothing without the link.
 */
async function requestForUploadToken(c: Context, id: string): Promise<FileRequest | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const request = await getDb().query.fileRequests.findFirst({ where: eq(fileRequests.id, id) });
  return request && tokenMatches(c.req.header("X-Upload-Token"), request.uploadToken)
    ? request
    : null;
}

const notFound = (c: Context) => c.json({ error: "File request not found" }, 404);

/** Whether an insert failed because the row it points to is gone. Drizzle may wrap the error. */
function isForeignKeyError(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return (
    code(err) === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
    code((err as { cause?: unknown } | null)?.cause) === "SQLITE_CONSTRAINT_FOREIGNKEY"
  );
}

/**
 * Reserves a slot of a request for an upload of `contentLength` bytes. One statement, so two
 * senders can never both take the last slot. Returns why it refused, or null.
 */
async function reserveSlot(
  id: string,
  contentLength: number,
): Promise<{ status: 409 | 410 | 413; error: string } | null> {
  const db = getDb();
  const reserved = db
    .update(fileRequests)
    .set({ reservedUploads: sql`${fileRequests.reservedUploads} + 1` })
    .where(
      and(
        eq(fileRequests.id, id),
        eq(fileRequests.closed, false),
        gt(fileRequests.closesAt, new Date()),
        sql`${fileRequests.reservedUploads} < ${fileRequests.maxUploads}`,
        sql`${contentLength} <= ${fileRequests.maxSize}`,
      ),
    )
    .run();
  if (reserved.changes > 0) return null;
  const current = await db.query.fileRequests.findFirst({ where: eq(fileRequests.id, id) });
  if (!current || !isOpen(current)) return { status: 410, error: "File request is closed" };
  if (current.reservedUploads >= current.maxUploads) {
    return { status: 409, error: "File request is full" };
  }
  return { status: 413, error: "Upload exceeds the size this file request allows" };
}

/**
 * Stores a finished upload with its wrapped file secret and encrypted metadata, and counts
 * it as finished. The row and the counters change in one step, so a restart can never count
 * an upload that is not there, or miss one that is. False when the request is gone.
 */
function storeRequestUpload(
  upload: { requestId: string; uploadId: string; size: number; session: RequestUploadSession },
  body: z.infer<typeof finalizeSchema>,
): boolean {
  const config = getConfig();
  const now = new Date();
  try {
    getDb().transaction((tx) => {
      tx.insert(requestUploads)
        .values({
          id: upload.uploadId,
          requestId: upload.requestId,
          size: upload.size,
          fileCount: upload.session.fileCount,
          salt: upload.session.salt,
          wrapEnc: body.wrapEnc,
          wrapCiphertext: body.wrapCiphertext,
          encryptedMeta: body.encryptedMeta,
          metaNonce: body.metaNonce,
          maxDownloads: config.FILE_REQUEST_DOWNLOADS,
          downloadCount: 0,
          expiresAt: new Date(now.getTime() + config.FILE_REQUEST_RETENTION_SEC * 1000),
          createdAt: now,
          storagePath: `${upload.uploadId}.bin`,
        })
        .run();
      tx.update(fileRequests)
        .set({
          finishedUploads: sql`${fileRequests.finishedUploads} + 1`,
          finishedBytes: sql`${fileRequests.finishedBytes} + ${upload.size}`,
        })
        .where(eq(fileRequests.id, upload.requestId))
        .run();
    });
  } catch (err) {
    // The request was deleted while the upload ran.
    if (isForeignKeyError(err)) return false;
    throw err;
  }
  return true;
}

/** The init frame of a WebSocket upload into a request, the same fields as the HTTP init. */
const wsInitSchema = z
  .object({
    type: z.literal("init"),
    request: z
      .object({
        uploadToken: z.string().max(64),
        salt: base64urlBytes(SALT_LENGTH),
        contentLength: z.number().int().positive(),
        fileCount: z.number().int().positive().default(1),
      })
      .strict(),
  })
  .strict();

export interface RequestRouteOptions {
  storage: StorageBackend;
  limiter: RequestLimiter;
  /** Where chunk bodies of request uploads wait, apart from the one of normal uploads. */
  chunkDir: string;
  /** Overrides the chunk size limit in tests. */
  maxChunkSize?: number;
  /** The OIDC guard, when OIDC_PROTECT_FILES puts creating a request behind the login. */
  createGuard?: MiddlewareHandler;
  /** The upload quota of the sender, the same one normal uploads count against. */
  quota?: Pick<ReturnType<typeof createUploadQuota>, "middleware" | "recordUsage" | "check">;
  /** Turns on the WebSocket transport, the same as for normal uploads (FILE_UPLOAD_WS). */
  upgradeWebSocket?: UpgradeWebSocket;
}

/**
 * /api/request: creating a request, what a sender sees, and uploading into a request.
 *
 * Uploads take the same two transports as normal uploads: WebSocket first when
 * FILE_UPLOAD_WS is on (lib/ws-upload.ts), chunked HTTP otherwise and as the fallback
 * (lib/chunked-upload.ts). Both share the session layer and its limits with normal uploads,
 * and the slot is reserved at init, so parallel senders can never overfill a request.
 */
export function createRequestRoute({
  storage,
  limiter,
  chunkDir,
  maxChunkSize,
  createGuard,
  quota,
  upgradeWebSocket,
}: RequestRouteOptions) {
  const route = new Hono<{ Variables: QuotaVariables & Partial<OidcGuardVariables> }>();
  route.use("*", requestServiceGuard);
  // Not on a cancel, which only gives a slot back and must work with the quota used up,
  // and not on the WebSocket, which checks the quota in its init like for normal uploads.
  if (quota) {
    const quotaMiddleware = quota.middleware;
    route.use("/:id/upload/*", (c, next) =>
      c.req.method === "DELETE" || c.req.path.endsWith("/upload/ws")
        ? next()
        : quotaMiddleware(c, next),
    );
  }

  // No session survives a restart, so whatever was reserved beyond the finished uploads
  // belonged to a session that is gone.
  getDb()
    .update(fileRequests)
    .set({ reservedUploads: sql`${fileRequests.finishedUploads}` })
    .run();

  const chunked = createChunkedUploads<RequestUploadSession>(storage, {
    chunkDir,
    maxChunkSize,
    onAbandon: (_id, session) => release(session.requestId),
  });

  /**
   * POST /api/request
   * Stores a new request: the sealed vault, the three tokens and the encrypted title.
   */
  route.post(
    "/",
    // Only creating a request needs the login. A sender never does, the upload link is enough.
    createGuard ?? ((_c, next) => next()),
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    async (c) => {
      const config = getConfig();
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      const parsed = createSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: "Invalid request body", details: parsed.error.flatten().fieldErrors },
          400,
        );
      }
      const data = parsed.data;

      if (!config.FILE_REQUEST_EXPIRE_OPTIONS_SEC.includes(data.expireSec)) {
        return c.json({ error: "Invalid expiry time" }, 400);
      }
      if (data.maxUploads > config.FILE_REQUEST_MAX_UPLOADS) {
        return c.json(
          { error: `A request accepts at most ${config.FILE_REQUEST_MAX_UPLOADS} uploads` },
          400,
        );
      }
      if (data.maxSize > config.FILE_REQUEST_MAX_SIZE) {
        return c.json(
          { error: `A request accepts uploads of at most ${config.FILE_REQUEST_MAX_SIZE} bytes` },
          400,
        );
      }
      if (config.FORCE_FILE_PASSWORD && !data.hasPassword) {
        return c.json({ error: "A password is required for file requests on this server" }, 400);
      }

      // The daily limit counts the signed-in user where there is one, the IP otherwise.
      // Neither is stored with the request.
      const user = c.get("oidcUser");
      const identity = user ? `oidc:${user.sub}` : `ip:${getClientIp(c, config.TRUST_PROXY)}`;
      if (!limiter.take(identity)) {
        return c.json({ error: "Too many file requests today. Try again tomorrow." }, 429);
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const closesAt = new Date(now.getTime() + data.expireSec * 1000);
      getDb()
        .insert(fileRequests)
        .values({
          id,
          vault: data.vault,
          vaultNonce: data.vaultNonce,
          // Only the hashes, see hashToken.
          inboxAuthToken: hashToken(data.inboxAuthToken),
          inboxOwnerToken: hashToken(data.inboxOwnerToken),
          uploadToken: hashToken(data.uploadToken),
          titleCiphertext: data.title?.ciphertext ?? null,
          titleNonce: data.title?.nonce ?? null,
          hasPassword: data.hasPassword,
          maxUploads: data.maxUploads,
          maxSize: data.maxSize,
          closesAt,
          createdAt: now,
        })
        .run();

      return c.json({ id, closesAt: closesAt.toISOString() }, 201);
    },
  );

  /**
   * GET /api/request/:id
   * What a sender sees: the encrypted title and how much the request still takes.
   */
  route.get("/:id", async (c) => {
    const request = await requestForUploadToken(c, c.req.param("id"));
    if (!request) return notFound(c);
    const config = getConfig();
    const open = isOpen(request);
    return c.json({
      title:
        request.titleCiphertext && request.titleNonce
          ? {
              ciphertext: encodeBytes(request.titleCiphertext),
              nonce: encodeBytes(request.titleNonce),
            }
          : null,
      open,
      closesAt: request.closesAt.toISOString(),
      uploadsLeft: open ? Math.max(0, request.maxUploads - request.reservedUploads) : 0,
      maxUploadSize: open ? Math.min(config.FILE_MAX_SIZE, request.maxSize) : 0,
      maxFilesPerUpload: config.FILE_MAX_FILES_PER_UPLOAD,
    });
  });

  /**
   * POST /api/request/:id/upload/init
   * Reserves a slot, then opens an upload session.
   */
  route.post("/:id/upload/init", async (c) => {
    const id = c.req.param("id");
    const request = await requestForUploadToken(c, id);
    if (!request) return notFound(c);
    const config = getConfig();

    const parsed = initSchema.safeParse({
      salt: c.req.header("X-Salt"),
      contentLength: c.req.header("X-Content-Length"),
      fileCount: c.req.header("X-File-Count"),
    });
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request headers", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const { salt, contentLength, fileCount } = parsed.data;
    const sizeError = validateUploadSize(contentLength, fileCount, config);
    if (sizeError) return c.json({ error: sizeError.message }, sizeError.status);

    const refused = await reserveSlot(id, contentLength);
    if (refused) return c.json({ error: refused.error }, refused.status);

    try {
      const uploadId = await chunked.open(contentLength, {
        requestId: id,
        salt,
        fileCount,
        contentLength,
      });
      return c.json({ id: uploadId }, 201);
    } catch (err) {
      release(id);
      throw err;
    }
  });

  /**
   * POST /api/request/:id/upload/:uid/chunk?index=N
   * Same as a normal chunk, for a session of this request only.
   */
  route.post("/:id/upload/:uid/chunk", (c) => {
    const uid = c.req.param("uid");
    if (chunked.meta(uid)?.requestId !== c.req.param("id")) {
      return c.json({ error: "Upload session not found or expired" }, 404);
    }
    return chunked.receiveChunk(c, uid);
  });

  /**
   * DELETE /api/request/:id/upload/:uid
   * Ends an upload the sender cancelled, so its slot is free again at once.
   * The upload ID came only from init, so knowing it is what allows this.
   */
  route.delete("/:id/upload/:uid", async (c) => {
    const uid = c.req.param("uid");
    if (chunked.meta(uid)?.requestId !== c.req.param("id") || !(await chunked.abort(uid))) {
      return c.json({ error: "Upload session not found or expired" }, 404);
    }
    return c.json({ ok: true });
  });

  /**
   * POST /api/request/:id/upload/:uid/finalize
   * Stores the upload with its wrapped file secret and encrypted metadata, in one step.
   */
  route.post(
    "/:id/upload/:uid/finalize",
    bodyLimit({
      maxSize: 128 * 1024,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    async (c) => {
      const id = c.req.param("id");
      const uid = c.req.param("uid");
      if (chunked.meta(uid)?.requestId !== id) {
        return c.json({ error: "Upload session not found or expired" }, 404);
      }

      // The body is checked before the session ends, so a broken body does not lose the upload.
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      const parsed = finalizeSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: "Invalid request body", details: parsed.error.flatten().fieldErrors },
          400,
        );
      }

      const session = await chunked.take(uid);
      if (!session) {
        return c.json({ error: "Upload session not found or expired" }, 404);
      }
      const { meta } = session;

      if (session.bytesWritten !== meta.contentLength) {
        await storage.abortChunkedUpload(uid).catch(() => {});
        release(id);
        return c.json({ error: "Body size does not match declared content length" }, 400);
      }

      try {
        await storage.finalizeChunkedUpload(uid);
      } catch (err) {
        await storage.abortChunkedUpload(uid).catch(() => {});
        release(id);
        throw err;
      }

      let stored: boolean;
      try {
        stored = storeRequestUpload(
          { requestId: id, uploadId: uid, size: session.bytesWritten, session: meta },
          parsed.data,
        );
      } catch (err) {
        await storage.delete(uid).catch(() => {});
        release(id);
        throw err;
      }
      if (!stored) {
        await storage.delete(uid).catch(() => {});
        return notFound(c);
      }

      const quotaHashedIp = c.get("quotaHashedIp");
      if (quota && quotaHashedIp) quota.recordUsage(quotaHashedIp, session.bytesWritten);

      return c.json({ id: uid }, 200);
    },
  );

  /**
   * GET /api/request/:id/upload/ws
   * The WebSocket transport of normal uploads, into a request: the init frame carries
   * { request: { uploadToken, salt, contentLength, fileCount } }, the finalize frame the same
   * fields as the HTTP finalize. Registered when FILE_UPLOAD_WS is on.
   */
  if (upgradeWebSocket) {
    const refuse = (status: number, error: string): WsUploadRefusal => ({
      error,
      code: 1008,
      status,
    });
    route.get(
      "/:id/upload/ws",
      createWsUploadHandler<RequestUploadSession>(
        {
          storage,
          upgradeWebSocket,
          quota: quota
            ? { check: quota.check, record: quota.recordUsage }
            : { check: () => ({ ok: true, hashedIp: null }), record: () => {} },
        },
        {
          async open(init, { c, ip }) {
            const id = c.req.param("id") ?? "";
            const parsed = wsInitSchema.safeParse(init);
            if (!parsed.success) return refuse(400, "Invalid upload headers");
            const { uploadToken, salt, contentLength, fileCount } = parsed.data.request;
            const request = UUID_PATTERN.test(id)
              ? await getDb().query.fileRequests.findFirst({ where: eq(fileRequests.id, id) })
              : undefined;
            if (!request || !tokenMatches(uploadToken, request.uploadToken)) {
              return refuse(404, "File request not found");
            }
            const sizeError = validateUploadSize(contentLength, fileCount, getConfig());
            if (sizeError) return refuse(sizeError.status, sizeError.message);
            const quotaResult = quota
              ? quota.check(ip, contentLength)
              : ({ ok: true, hashedIp: null } as const);
            if (!quotaResult.ok) return refuse(429, quotaResult.reason);
            const refused = await reserveSlot(id, contentLength);
            if (refused) return refuse(refused.status, refused.error);
            return {
              contentLength,
              meta: { requestId: id, salt, fileCount, contentLength },
              quotaHashedIp: quotaResult.hashedIp,
            };
          },

          async commit({ id: uploadId, bytesReceived, meta }, finalize) {
            const { type: _type, ...body } = finalize;
            const parsed = finalizeSchema.safeParse(body);
            if (!parsed.success) return refuse(400, "Invalid request body");
            try {
              const stored = storeRequestUpload(
                { requestId: meta.requestId, uploadId, size: bytesReceived, session: meta },
                parsed.data,
              );
              if (!stored) return refuse(404, "File request not found");
            } catch {
              return { error: "Upload could not be stored", code: 1011 };
            }
          },

          abandon: (meta) => release(meta.requestId),
        },
      ),
    );
  }

  return route;
}
