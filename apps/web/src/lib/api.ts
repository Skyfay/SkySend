import { z } from "zod";

const configResponseSchema = z.object({
  maxFileSize: z.number(),
  maxFilesPerUpload: z.number(),
  expireOptions: z.array(z.number()),
  defaultExpire: z.number(),
  downloadOptions: z.array(z.number()),
  defaultDownload: z.number(),
  siteTitle: z.string(),
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
  // Collect the encrypted stream and track progress
  const body = await collectStream(
    encryptedStream,
    onProgress ?? (() => {}),
  );

  const res = await fetch("/api/upload", {
    method: "POST",
    headers,
    body: body as BodyInit,
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

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  onProgress: (loaded: number) => void,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded);
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
