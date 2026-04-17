import { z } from "zod";
import { fromBase64url, SALT_LENGTH } from "@skysend/crypto";
import type { Config } from "./config.js";

const base64urlPattern = /^[A-Za-z0-9_-]+$/;

/**
 * Zod schema for upload metadata. Used by both the HTTP upload route
 * (parsed from request headers) and the WebSocket upload route
 * (parsed from the init message payload).
 */
export const uploadHeadersSchema = z.object({
  authToken: z.string().regex(base64urlPattern, "Invalid base64url"),
  ownerToken: z.string().regex(base64urlPattern, "Invalid base64url"),
  salt: z.string().regex(base64urlPattern, "Invalid base64url"),
  maxDownloads: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  expireSec: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  fileCount: z
    .string()
    .default("1")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  contentLength: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  hasPassword: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  passwordSalt: z.string().regex(base64urlPattern).optional(),
  passwordAlgo: z.enum(["argon2id", "pbkdf2"]).optional(),
});

export type UploadHeaders = z.infer<typeof uploadHeadersSchema>;

/** Validate parsed upload headers against server config. Returns null if valid. */
export function validateUploadHeaders(
  headers: UploadHeaders,
  config: Config,
): { message: string; status: 400 | 413 } | null {
  try {
    const saltBytes = fromBase64url(headers.salt);
    if (saltBytes.length !== SALT_LENGTH) {
      return { message: `Salt must be exactly ${SALT_LENGTH} bytes`, status: 400 };
    }
  } catch {
    return { message: "Invalid salt encoding", status: 400 };
  }

  if (headers.contentLength > config.FILE_MAX_SIZE) {
    return { message: `File size exceeds maximum of ${config.FILE_MAX_SIZE} bytes`, status: 413 };
  }

  if (headers.fileCount > config.FILE_MAX_FILES_PER_UPLOAD) {
    return { message: `Maximum ${config.FILE_MAX_FILES_PER_UPLOAD} files per upload`, status: 400 };
  }

  if (!config.FILE_EXPIRE_OPTIONS_SEC.includes(headers.expireSec)) {
    return { message: "Invalid expiry time. Must be one of the allowed options.", status: 400 };
  }

  if (!config.FILE_DOWNLOAD_OPTIONS.includes(headers.maxDownloads)) {
    return { message: "Invalid download limit. Must be one of the allowed options.", status: 400 };
  }

  if (headers.hasPassword) {
    if (!headers.passwordSalt || !headers.passwordAlgo) {
      return {
        message: "Password-protected uploads require X-Password-Salt and X-Password-Algo",
        status: 400,
      };
    }
    try {
      const pwSaltBytes = fromBase64url(headers.passwordSalt);
      if (pwSaltBytes.length !== SALT_LENGTH) {
        return { message: `Password salt must be exactly ${SALT_LENGTH} bytes`, status: 400 };
      }
    } catch {
      return { message: "Invalid password salt encoding", status: 400 };
    }
  }

  return null;
}
