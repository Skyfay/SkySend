import { z } from "zod";
import type { NoteContentType } from "@skysend/crypto";
import { ApiError } from "./errors.js";

// ── Response Schemas ───────────────────────────────────

const configResponseSchema = z.object({
  enabledServices: z.array(z.enum(["file", "note"])),
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
  noteMaxSize: z.number(),
  noteExpireOptions: z.array(z.number()),
  noteDefaultExpire: z.number(),
  noteViewOptions: z.array(z.number()),
  noteDefaultViews: z.number(),
  customTitle: z.string(),
  customColor: z.string().nullable(),
  customLogo: z.string().nullable(),
  customPrivacy: z.string().nullable(),
  customLegal: z.string().nullable(),
  customLinkUrl: z.string().nullable(),
  customLinkName: z.string().nullable(),
});

export type ServerConfig = z.infer<typeof configResponseSchema>;

const infoResponseSchema = z.object({
  id: z.string(),
  size: z.number(),
  fileCount: z.number(),
  hasPassword: z.boolean(),
  passwordAlgo: z.enum(["argon2id", "pbkdf2"]).optional(),
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

const noteInfoResponseSchema = z.object({
  id: z.string(),
  contentType: z.enum(["text", "password", "code", "markdown", "sshkey"]),
  hasPassword: z.boolean(),
  passwordAlgo: z.enum(["argon2id", "pbkdf2"]).optional(),
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

const quotaResponseSchema = z.object({
  enabled: z.boolean(),
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
  resetsAt: z.string().nullable(),
  window: z.number(),
});

export type QuotaStatus = z.infer<typeof quotaResponseSchema>;

// ── Helpers ────────────────────────────────────────────

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

function apiUrl(server: string, path: string): string {
  return `${server.replace(/\/+$/, "")}${path}`;
}

// ── Config ─────────────────────────────────────────────

export async function fetchConfig(server: string): Promise<ServerConfig> {
  const res = await fetch(apiUrl(server, "/api/config"));
  return handleResponse(res, configResponseSchema);
}

export async function fetchQuota(server: string): Promise<QuotaStatus> {
  const res = await fetch(apiUrl(server, "/api/quota"));
  return handleResponse(res, quotaResponseSchema);
}

// ── Upload ─────────────────────────────────────────────

export async function uploadInit(
  server: string,
  headers: Record<string, string>,
): Promise<{ id: string }> {
  const res = await fetch(apiUrl(server, "/api/upload/init"), {
    method: "POST",
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Upload init failed" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Upload init failed",
    );
  }
  return (await res.json()) as { id: string };
}

export async function uploadChunk(
  server: string,
  id: string,
  index: number,
  data: Uint8Array,
): Promise<void> {
  const res = await fetch(
    apiUrl(server, `/api/upload/${encodeURIComponent(id)}/chunk?index=${index}`),
    { method: "POST", body: data },
  );
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: "Chunk upload failed" }));
    throw new ApiError(
      res.status,
      (errData as { error?: string }).error ?? "Chunk upload failed",
    );
  }
  await res.json(); // consume body
}

export async function uploadFinalize(
  server: string,
  id: string,
  ownerToken: string,
): Promise<void> {
  const res = await fetch(
    apiUrl(server, `/api/upload/${encodeURIComponent(id)}/finalize`),
    {
      method: "POST",
      headers: { "X-Owner-Token": ownerToken },
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Upload finalize failed" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Upload finalize failed",
    );
  }
}

export async function saveMeta(
  server: string,
  id: string,
  ownerToken: string,
  encryptedMeta: string,
  nonce: string,
): Promise<void> {
  const res = await fetch(apiUrl(server, `/api/meta/${encodeURIComponent(id)}`), {
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

// ── Info / Download ────────────────────────────────────

export async function fetchInfo(server: string, id: string): Promise<UploadInfo> {
  const res = await fetch(apiUrl(server, `/api/info/${encodeURIComponent(id)}`));
  return handleResponse(res, infoResponseSchema);
}

export async function downloadFile(
  server: string,
  id: string,
  authToken: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; fileCount: number }> {
  const res = await fetch(apiUrl(server, `/api/download/${encodeURIComponent(id)}`), {
    headers: { "X-Auth-Token": authToken },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Download failed" }));
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? "Download failed",
    );
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as { url: string; size: number; fileCount: number };
    const s3Res = await fetch(data.url);
    if (!s3Res.ok) throw new ApiError(s3Res.status, "S3 download failed");
    if (!s3Res.body) throw new Error("No response body from S3");
    return { stream: s3Res.body, size: data.size, fileCount: data.fileCount };
  }

  if (!res.body) throw new Error("No response body");
  return {
    stream: res.body,
    size: parseInt(res.headers.get("Content-Length") ?? "0", 10),
    fileCount: parseInt(res.headers.get("X-File-Count") ?? "1", 10),
  };
}

// ── Password ───────────────────────────────────────────

export async function verifyPassword(
  server: string,
  id: string,
  authToken: string,
): Promise<boolean> {
  const res = await fetch(apiUrl(server, `/api/password/${encodeURIComponent(id)}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  if (res.status === 401) return false;
  if (!res.ok) throw new ApiError(res.status, "Password verification failed");
  return true;
}

// ── Delete ─────────────────────────────────────────────

export async function deleteUpload(
  server: string,
  id: string,
  ownerToken: string,
): Promise<void> {
  const res = await fetch(apiUrl(server, `/api/upload/${encodeURIComponent(id)}`), {
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

// ── Notes ──────────────────────────────────────────────

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

export async function createNote(
  server: string,
  data: CreateNoteRequest,
): Promise<{ id: string; expiresAt: string }> {
  const res = await fetch(apiUrl(server, "/api/note"), {
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
  return (await res.json()) as { id: string; expiresAt: string };
}

export async function fetchNoteInfo(server: string, id: string): Promise<NoteInfo> {
  const res = await fetch(apiUrl(server, `/api/note/${encodeURIComponent(id)}`));
  return handleResponse(res, noteInfoResponseSchema);
}

export async function viewNote(
  server: string,
  id: string,
  authToken: string,
): Promise<NoteViewResponse> {
  const res = await fetch(apiUrl(server, `/api/note/${encodeURIComponent(id)}/view`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  return handleResponse(res, noteViewResponseSchema);
}

export async function verifyNotePassword(
  server: string,
  id: string,
  authToken: string,
): Promise<boolean> {
  const res = await fetch(
    apiUrl(server, `/api/note/${encodeURIComponent(id)}/password`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authToken }),
    },
  );
  if (res.status === 401) return false;
  if (!res.ok) throw new ApiError(res.status, "Password verification failed");
  return true;
}

export async function deleteNote(
  server: string,
  id: string,
  ownerToken: string,
): Promise<void> {
  const res = await fetch(apiUrl(server, `/api/note/${encodeURIComponent(id)}`), {
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
