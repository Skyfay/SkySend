import { z } from "zod";
import type { NoteContentType } from "@skysend/crypto";

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
  passwordAlgo: z.enum(["argon2id", "argon2id-v2", "pbkdf2"]).optional(),
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
  if (!res.ok) {
    throw new ApiError(res.status, "Password verification failed");
  }
  return true;
}

export async function downloadFile(
  id: string,
  authToken: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; fileCount: number }> {
  const res = await fetch(`/api/download/${encodeURIComponent(id)}`, {
    headers: { "X-Auth-Token": authToken },
  });
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
    const data = (await res.json()) as { url: string; size: number; fileCount: number };
    const s3Res = await fetch(data.url);
    if (!s3Res.ok) throw new ApiError(s3Res.status, "S3 download failed");
    if (!s3Res.body) throw new Error("No response body from S3");
    return {
      stream: s3Res.body,
      size: data.size,
      fileCount: data.fileCount,
    };
  }

  // Filesystem backend returns the stream directly
  if (!res.body) throw new Error("No response body");

  return {
    stream: res.body,
    size: parseInt(res.headers.get("Content-Length") ?? "0", 10),
    fileCount: parseInt(res.headers.get("X-File-Count") ?? "1", 10),
  };
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
  contentType: NoteContentType;
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
  contentType: z.enum(["text", "password", "code", "markdown", "sshkey"]),
  hasPassword: z.boolean(),
  passwordAlgo: z.enum(["argon2id", "argon2id-v2", "pbkdf2"]).optional(),
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
