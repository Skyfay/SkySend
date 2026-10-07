import { z } from "zod";
import type { NOTE_KIND } from "@skysend/note-format";

const configResponseSchema = z.object({
  // Service toggles
  enabledServices: z.array(z.enum(["file", "note"])),
  // File configuration
  fileMaxSize: z.number(),
  fileMaxFilesPerUpload: z.number(),
  fileExpireOptions: z.array(z.number()),
  fileDefaultExpire: z.number(),
  fileDownloadOptions: z.array(z.number()),
  fileDefaultDownload: z.number(),
  fileUploadQuotaBytes: z.number(),
  fileUploadQuotaWindow: z.number(),
  fileUploadConcurrentChunks: z.number(),
  fileUploadSpeedLimit: z.number().optional().default(0),
  fileUploadWs: z.boolean().optional().default(false),
  // File requests. A server from before v4 sends none of these and offers no requests.
  fileRequestsEnabled: z.boolean().optional().default(false),
  fileRequestExpireOptions: z.array(z.number()).optional().default([]),
  fileRequestDefaultExpire: z.number().optional().default(0),
  fileRequestMaxUploads: z.number().optional().default(0),
  fileRequestMaxSize: z.number().optional().default(0),
  fileRequestRetention: z.number().optional().default(0),
  fileRequestDownloads: z.number().optional().default(0),
  // Note configuration
  noteMaxSize: z.number(),
  noteExpireOptions: z.array(z.number()),
  noteDefaultExpire: z.number(),
  noteViewOptions: z.array(z.number()),
  noteDefaultViews: z.number(),
  // General
  customTitle: z.string(),
  customColor: z.string().nullable(),
  customLogo: z.string().nullable(),
  customPrivacy: z.string().nullable(),
  customLegal: z.string().nullable(),
  customLinkUrl: z.string().nullable(),
  customLinkName: z.string().nullable(),
  customReportUrl: z.string().nullable(),
  // UI defaults
  // A server from before v3 sends a color scheme as defaultTheme, catch() keeps the default.
  defaultTheme: z.enum(["aurora", "midnight", "graphite"]).catch("graphite"),
  defaultColorScheme: z.enum(["dark", "light", "system"]).catch("system"),
  defaultTab: z.enum(["file", "note", "text", "password", "code", "sshkey"]).optional().default("file"),
  forceFilePassword: z.boolean().optional().default(false),
  forceNotePassword: z.boolean().optional().default(false),
  // OIDC auth
  oidcEnabled: z.boolean().optional().default(false),
  oidcProtectFiles: z.boolean().optional().default(false),
  oidcProtectNotes: z.boolean().optional().default(false),
});

export type ServerConfig = z.infer<typeof configResponseSchema>;

const quotaResponseSchema = z.object({
  enabled: z.boolean(),
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
  resetsAt: z.string().nullable(),
  window: z.number(),
});

export type QuotaStatus = z.infer<typeof quotaResponseSchema>;

const infoResponseSchema = z.object({
  id: z.string(),
  size: z.number(),
  fileCount: z.number(),
  hasPassword: z.boolean(),
  passwordAlgo: z.enum(["argon2id-v2"]).optional(),
  passwordSalt: z.string().optional(),
  salt: z.string(),
  encryptedMeta: z.string().nullable(),
  nonce: z.string().nullable(),
  downloadCount: z.number(),
  maxDownloads: z.number(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type UploadInfo = z.infer<typeof infoResponseSchema>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(
      response.status,
      (body as { error?: string }).error ?? `Request failed (${response.status})`,
    );
  }
  const data = await response.json();
  return schema.parse(data);
}

export async function fetchConfig(): Promise<ServerConfig> {
  const res = await fetch("/api/config");
  return handleResponse(res, configResponseSchema);
}

export async function fetchQuota(): Promise<QuotaStatus> {
  const res = await fetch("/api/quota");
  return handleResponse(res, quotaResponseSchema);
}

export async function fetchInfo(id: string): Promise<UploadInfo> {
  const res = await fetch(`/api/info/${encodeURIComponent(id)}`);
  return handleResponse(res, infoResponseSchema);
}

export async function checkExists(id: string): Promise<boolean> {
  const res = await fetch(`/api/exists/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) throw new ApiError(res.status, "Failed to check existence");
  return true;
}

export async function uploadFile(
  encryptedStream: ReadableStream<Uint8Array>,
  headers: Record<string, string>,
  onProgress?: (loaded: number) => void,
): Promise<{ id: string; ownerToken: string; url: string }> {
  // Wrap the stream with a byte counter for progress tracking.
  // The stream is piped directly into fetch - no buffering in memory.
  let loaded = 0;
  const countingStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      onProgress?.(loaded);
      controller.enqueue(chunk);
    },
  });
  const trackedStream = encryptedStream.pipeThrough(countingStream);

  const res = await fetch("/api/upload", {
    method: "POST",
    headers,
    body: trackedStream,
    // @ts-expect-error -- Required for streaming upload in Chrome/Firefox
    duplex: "half",
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Upload failed",
    );
  }

  const data = await res.json();
  return data as { id: string; ownerToken: string; url: string };
}

export async function saveMeta(
  id: string,
  ownerToken: string,
  encryptedMeta: string,
  nonce: string,
): Promise<void> {
  const res = await fetch(`/api/meta/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Token": ownerToken,
    },
    body: JSON.stringify({ encryptedMeta, nonce }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to save metadata" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Failed to save metadata",
    );
  }
}

export async function verifyPassword(
  id: string,
  authToken: string,
): Promise<boolean> {
  const res = await fetch(`/api/password/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  if (res.status === 401) return false;
  if (res.status === 429) throw new ApiError(429, "rate-limited");
  if (!res.ok) {
    throw new ApiError(res.status, "Password verification failed");
  }
  return true;
}

const presignedResponseSchema = z.object({
  url: z.string(),
  size: z.number(),
  fileCount: z.number(),
});

/** Fetches a ciphertext from an API endpoint, following a presigned S3 URL when one comes back. */
async function fetchCiphertext(
  path: string,
  headers: Record<string, string>,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; fileCount: number; storageBackend: "s3" | "filesystem" }> {
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Download failed" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Download failed",
    );
  }

  // S3 backend returns JSON with a presigned URL
  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const data = presignedResponseSchema.parse(await res.json());
    let s3Res: Response;
    try {
      s3Res = await fetch(data.url);
    } catch {
      throw new Error(
        "S3 CORS error: The bucket must allow cross-origin GET requests from this origin. " +
        "Add this origin to the CORS policy of your S3/R2 bucket.",
      );
    }
    if (!s3Res.ok) throw new ApiError(s3Res.status, "S3 download failed");
    if (!s3Res.body) throw new Error("No response body from S3");
    return {
      stream: s3Res.body,
      size: data.size,
      fileCount: data.fileCount,
      storageBackend: "s3",
    };
  }

  // Filesystem backend returns the stream directly
  if (!res.body) throw new Error("No response body");

  return {
    stream: res.body,
    size: parseInt(res.headers.get("Content-Length") ?? "0", 10),
    fileCount: parseInt(res.headers.get("X-File-Count") ?? "1", 10),
    storageBackend: "filesystem",
  };
}

export function downloadFile(id: string, authToken: string) {
  return fetchCiphertext(`/api/download/${encodeURIComponent(id)}`, { "X-Auth-Token": authToken });
}

export async function deleteUpload(
  id: string,
  ownerToken: string,
): Promise<void> {
  const res = await fetch(`/api/upload/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Owner-Token": ownerToken },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Delete failed" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Delete failed",
    );
  }
}

// ── Note API ───────────────────────────────────────────

export interface CreateNoteRequest {
  encryptedContent: string;
  nonce: string;
  salt: string;
  ownerToken: string;
  authToken: string;
  /** Every note this app creates is made of blocks. */
  contentType: typeof NOTE_KIND;
  maxViews: number;
  expireSec: number;
  hasPassword: boolean;
  passwordSalt?: string;
  passwordAlgo?: string;
}

export interface CreateNoteResponse {
  id: string;
  expiresAt: string;
}

export async function createNote(
  data: CreateNoteRequest,
): Promise<CreateNoteResponse> {
  const res = await fetch("/api/note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Failed to create note" }));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? "Failed to create note",
    );
  }
  return (await res.json()) as CreateNoteResponse;
}

// ── Note Info / View / Password ────────────────────────

const noteInfoResponseSchema = z.object({
  id: z.string(),
  // "blocks" since v3. LEGACY(notes-v1): the other values are notes from before v3.
  contentType: z.enum(["blocks", "text", "password", "code", "markdown", "sshkey"]),
  hasPassword: z.boolean(),
  passwordAlgo: z.enum(["argon2id-v2"]).optional(),
  passwordSalt: z.string().optional(),
  salt: z.string(),
  maxViews: z.number(),
  viewCount: z.number(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type NoteInfo = z.infer<typeof noteInfoResponseSchema>;

const noteViewResponseSchema = z.object({
  encryptedContent: z.string(),
  nonce: z.string(),
  viewCount: z.number(),
  maxViews: z.number(),
});

export type NoteViewResponse = z.infer<typeof noteViewResponseSchema>;

export async function fetchNoteInfo(id: string): Promise<NoteInfo> {
  const res = await fetch(`/api/note/${encodeURIComponent(id)}`);
  return handleResponse(res, noteInfoResponseSchema);
}

export async function viewNote(
  id: string,
  authToken: string,
): Promise<NoteViewResponse> {
  const res = await fetch(`/api/note/${encodeURIComponent(id)}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  return handleResponse(res, noteViewResponseSchema);
}

export async function verifyNotePassword(
  id: string,
  authToken: string,
): Promise<boolean> {
  const res = await fetch(`/api/note/${encodeURIComponent(id)}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  if (res.status === 401) return false;
  if (res.status === 429) throw new ApiError(429, "rate-limited");
  if (!res.ok) {
    throw new ApiError(res.status, "Password verification failed");
  }
  return true;
}

export async function deleteNote(
  id: string,
  ownerToken: string,
): Promise<void> {
  const res = await fetch(`/api/note/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Owner-Token": ownerToken },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Delete failed" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Delete failed",
    );
  }
}

// ── File Request API ──────────────────────────────────

/** Binary fields of the request API are base64url without padding. */
const base64url = z.string().regex(/^[A-Za-z0-9_-]*$/);

// Every request carries a brief. A server that drops it shows the sender a broken request.
const encryptedBriefSchema = z.object({ ciphertext: base64url, nonce: base64url });

export interface CreateRequestBody {
  vault: string;
  vaultNonce: string;
  inboxAuthToken: string;
  inboxOwnerToken: string;
  uploadToken: string;
  brief: { ciphertext: string; nonce: string };
  expireSec: number;
  maxUploads: number;
  maxSize: number;
  hasPassword: boolean;
}

const createRequestResponseSchema = z.object({ id: z.string().uuid(), closesAt: z.string() });

export async function createRequest(body: CreateRequestBody): Promise<z.infer<typeof createRequestResponseSchema>> {
  const res = await fetch("/api/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse(res, createRequestResponseSchema);
}

const senderRequestSchema = z.object({
  // Null only from a server that dropped it, which leaves the request broken, never plain.
  brief: encryptedBriefSchema.nullable(),
  open: z.boolean(),
  closesAt: z.string().datetime(),
  uploadsLeft: z.number().int().nonnegative(),
  maxUploadSize: z.number().int().nonnegative(),
  maxFilesPerUpload: z.number().int().positive(),
});

export type SenderRequest = z.infer<typeof senderRequestSchema>;

/** What a sender sees of a request. Needs the token from the upload link. */
export async function fetchRequestForSender(id: string, uploadToken: string): Promise<SenderRequest> {
  const res = await fetch(`/api/request/${encodeURIComponent(id)}`, {
    headers: { "X-Upload-Token": uploadToken },
  });
  return handleResponse(res, senderRequestSchema);
}

const inboxUploadSchema = z.object({
  id: z.string().uuid(),
  size: z.number(),
  fileCount: z.number(),
  salt: base64url,
  wrapEnc: base64url,
  wrapCiphertext: base64url,
  encryptedMeta: base64url,
  metaNonce: base64url,
  downloadCount: z.number(),
  maxDownloads: z.number(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type InboxUpload = z.infer<typeof inboxUploadSchema>;

const inboxResponseSchema = z.object({
  vault: base64url,
  vaultNonce: base64url,
  // Null only from a server that dropped it, which leaves the request broken, never plain.
  brief: encryptedBriefSchema.nullable(),
  hasPassword: z.boolean(),
  open: z.boolean(),
  closesAt: z.string(),
  createdAt: z.string(),
  maxUploads: z.number(),
  maxSize: z.number(),
  usedUploads: z.number(),
  usedBytes: z.number(),
  // FILE_REQUEST_MAX_UPLOADS is at most 1000, so a longer list did not come from SkySend.
  uploads: z.array(inboxUploadSchema).max(1000),
});

export type Inbox = z.infer<typeof inboxResponseSchema>;

/** The inbox of a request. Listing never counts as a download. */
export async function fetchInbox(id: string, inboxToken: string): Promise<Inbox> {
  const res = await fetch(`/api/inbox/${encodeURIComponent(id)}`, {
    headers: { "X-Inbox-Token": inboxToken },
  });
  return handleResponse(res, inboxResponseSchema);
}

export function inboxFilePath(id: string, uploadId: string): string {
  return `/api/inbox/${encodeURIComponent(id)}/file/${encodeURIComponent(uploadId)}`;
}

export function downloadInboxFile(id: string, uploadId: string, inboxToken: string) {
  return fetchCiphertext(inboxFilePath(id, uploadId), { "X-Inbox-Token": inboxToken });
}

const okResponseSchema = z.object({ ok: z.literal(true) });

async function manageInbox(path: string, method: "POST" | "DELETE", ownerToken: string): Promise<void> {
  const res = await fetch(path, { method, headers: { "X-Inbox-Owner-Token": ownerToken } });
  await handleResponse(res, okResponseSchema);
}

export function deleteInboxFile(id: string, uploadId: string, ownerToken: string): Promise<void> {
  return manageInbox(inboxFilePath(id, uploadId), "DELETE", ownerToken);
}

export function closeRequest(id: string, ownerToken: string): Promise<void> {
  return manageInbox(`/api/inbox/${encodeURIComponent(id)}/close`, "POST", ownerToken);
}

export function deleteRequest(id: string, ownerToken: string): Promise<void> {
  return manageInbox(`/api/inbox/${encodeURIComponent(id)}`, "DELETE", ownerToken);
}

// ── OIDC Auth API ─────────────────────────────────────

export interface OidcUser {
  sub: string;
  name: string;
  email: string;
}

/**
 * Fetch the current OIDC session from the server.
 * Returns the logged-in user or null when unauthenticated / OIDC is disabled.
 */
export async function fetchAuthSession(): Promise<OidcUser | null> {
  try {
    const res = await fetch("/auth/session");
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const data = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      typeof data.sub === "string" &&
      typeof data.name === "string" &&
      typeof data.email === "string"
    ) {
      return data as OidcUser;
    }
    return null;
  } catch {
    return null;
  }
}
