import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { fromBase64url } from "@skysend/crypto";
import type { StorageBackend } from "../storage/types.js";
import {
  uploadHeadersSchema,
  validateUploadHeaders,
  type UploadHeaders,
} from "../lib/upload-validation.js";
import { createWsUploadHandler } from "../lib/ws-upload.js";
import type { createUploadQuota } from "../middleware/quota.js";

/**
 * WebSocket upload transport for normal uploads, on top of lib/ws-upload.ts.
 *
 * The init frame carries the same fields as the headers of the HTTP upload route:
 *   {"type":"init", headers: { authToken, ownerToken, salt, maxDownloads,
 *     expireSec, fileCount, contentLength, hasPassword,
 *     passwordSalt?, passwordAlgo? }}
 * and is validated identically. The finalize frame is {"type":"finalize"}.
 */

export interface UploadWsRouteDeps {
  storage: StorageBackend;
  upgradeWebSocket: UpgradeWebSocket;
  /** Reserves the bytes of an upload in its init. The session layer commits or releases them. */
  quota: Pick<ReturnType<typeof createUploadQuota>, "reserve">;
}

export function createUploadWsRoute(deps: UploadWsRouteDeps) {
  const route = new Hono();

  route.get(
    "/",
    createWsUploadHandler<UploadHeaders>(deps, {
      async open(init, { ip }) {
        const envelopeHeaders = init.headers;
        if (!envelopeHeaders || typeof envelopeHeaders !== "object") {
          return { error: "First message must be of type 'init'", code: 1003 };
        }

        // Coerce header values to strings for the shared schema.
        const headerInput: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(envelopeHeaders)) {
          if (v === undefined || v === null) continue;
          headerInput[k] = typeof v === "string" ? v : String(v);
        }

        const headerResult = uploadHeadersSchema.safeParse(headerInput);
        if (!headerResult.success) {
          return { error: "Invalid upload headers", code: 1008 };
        }
        const headers = headerResult.data;

        const validationError = validateUploadHeaders(headers, getConfig());
        if (validationError) {
          return { error: validationError.message, code: 1008 };
        }

        // Quota: reserves the declared size until the upload is stored or ends.
        const quotaResult = deps.quota.reserve(ip, headers.contentLength);
        if (!quotaResult.ok) {
          return { error: quotaResult.reason, code: 1008, status: quotaResult.status };
        }

        return {
          contentLength: headers.contentLength,
          meta: headers,
          quotaReservation: quotaResult.reservation,
        };
      },

      async commit({ id, bytesReceived, meta: headers }) {
        let passwordSaltBuffer: Buffer | null = null;
        if (headers.hasPassword && headers.passwordSalt) {
          passwordSaltBuffer = Buffer.from(fromBase64url(headers.passwordSalt));
        }
        const now = new Date();
        const expiresAt = new Date(now.getTime() + headers.expireSec * 1000);

        getDb()
          .insert(uploads)
          .values({
            id,
            ownerToken: headers.ownerToken,
            authToken: headers.authToken,
            salt: Buffer.from(fromBase64url(headers.salt)),
            size: bytesReceived,
            fileCount: headers.fileCount,
            hasPassword: headers.hasPassword,
            passwordSalt: passwordSaltBuffer,
            passwordAlgo: headers.hasPassword ? (headers.passwordAlgo ?? null) : null,
            maxDownloads: headers.maxDownloads,
            downloadCount: 0,
            expiresAt,
            createdAt: now,
            storagePath: `${id}.bin`,
          })
          .run();
      },
    }),
  );

  return route;
}
