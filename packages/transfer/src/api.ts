/**
 * The HTTP API of a SkySend server, for every client. Every response is parsed with Zod before it
 * leaves here, since the server is not trusted with anything but ciphertext.
 *
 * The web app talks to the server it came from, of the same version. The CLI and the mobile app
 * talk to instances of any version, so every field a supported older server does not send has a
 * default or a catch. Keep it that way when the server gains a field.
 */
import { z } from "zod";
import type { LegacyNoteKind, NOTE_KIND } from "@skysend/note-format";
import { trimTrailingSlashes } from "./links.js";

// ── Schemas ────────────────────────────────────────────

const configResponseSchema = z.object({
  // Service toggles. A server lists file and note here, and file requests on their own below,
  // since released CLI clients refuse any other value.
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
  // File requests. A server from before v3 sends none of these and offers no requests.
  fileRequestsEnabled: z.boolean().optional().default(false),
  fileRequestExpireOptions: z.array(z.number()).optional().default([]),
  fileRequestDefaultExpire: z.number().optional().default(0),
  fileRequestUploadOptions: z.array(z.number()).optional().default([]),
  fileRequestDefaultUploads: z.number().optional().default(0),
  fileRequestMaxSize: z.number().optional().default(0),
  fileRequestRetention: z.number().optional().default(0),
  fileRequestDownloadOptions: z.array(z.number()).optional().default([]),
  fileRequestDefaultDownloads: z.number().optional().default(0),
  // Note configuration
  noteMaxSize: z.number(),
  noteExpireOptions: z.array(z.number()),
  noteDefaultExpire: z.number(),
  noteViewOptions: z.array(z.number()),
  noteDefaultViews: z.number(),
  // Since v3. Missing on an older server, which only takes the legacy content types.
  noteBlocks: z.boolean().optional().default(false),
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
  defaultTab: z.enum(["file", "note", "text", "password", "code", "sshkey"]).catch("file"),
  forceFilePassword: z.boolean().optional().default(false),
  forceNotePassword: z.boolean().optional().default(false),
  forceRequestPassword: z.boolean().optional().default(false),
  // OIDC auth
  oidcEnabled: z.boolean().optional().default(false),
  oidcProtectFiles: z.boolean().optional().default(false),
  oidcProtectNotes: z.boolean().optional().default(false),
  oidcProtectRequests: z.boolean().optional().default(false),
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

const requestLimitSchema = z.object({
  /** New requests per day, 0 while there is no limit. */
  dailyLimit: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative().nullable(),
  resetsAt: z.string().datetime().nullable(),
});

export type RequestLimit = z.infer<typeof requestLimitSchema>;

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

// A server before GHSA-rxxj-c5wr-phqp answers { ok: true } and still sends the metadata in the info.
const passwordCheckSchema = z.object({
  ok: z.literal(true),
  encryptedMeta: z.string().nullable().optional(),
  nonce: z.string().nullable().optional(),
});

/** The metadata of a password-protected upload, which the server releases after the check. */
export type UnlockedMeta = Pick<UploadInfo, "encryptedMeta" | "nonce">;

const presignedResponseSchema = z.object({
  url: z.string(),
  size: z.number(),
  fileCount: z.number(),
});

/** The ciphertext of a download, from the server itself or from the bucket it points to. */
export interface Ciphertext {
  stream: ReadableStream<Uint8Array>;
  size: number;
  fileCount: number;
  storageBackend: "s3" | "filesystem";
}

/** Upload IDs come from randomUUID() on the server, and the wrap of a request upload binds one. */
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The token of a slot the server holds for the second part of a submission. */
const SLOT_HOLD = /^[A-Za-z0-9_-]{22}$/;

const uploadSessionSchema = z.object({ id: z.string().regex(UPLOAD_ID) });
const holdAnswerSchema = z.object({ hold: z.string().regex(SLOT_HOLD) });

/** The held slot an answer of the server hands over, if it is a well-formed one. */
export function holdOf(answer: unknown): string | undefined {
  const parsed = holdAnswerSchema.safeParse(answer);
  return parsed.success ? parsed.data.hold : undefined;
}

/** Whether an upload ID has the form the server gives out. */
export function isUploadId(id: string): boolean {
  return UPLOAD_ID.test(id);
}

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

export interface CreateNoteRequest {
  encryptedContent: string;
  nonce: string;
  salt: string;
  ownerToken: string;
  authToken: string;
  /** "blocks". LEGACY(notes-v1): or a legacy type for a server that does not report noteBlocks. */
  contentType: typeof NOTE_KIND | LegacyNoteKind;
  maxViews: number;
  expireSec: number;
  hasPassword: boolean;
  passwordSalt?: string;
  passwordAlgo?: string;
}

const createNoteResponseSchema = z.object({ id: z.string(), expiresAt: z.string() });

export type CreateNoteResponse = z.infer<typeof createNoteResponseSchema>;

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
  /** How often the requester can download each upload. */
  downloads: number;
  hasPassword: boolean;
}

const createRequestResponseSchema = z.object({ id: z.string().uuid(), closesAt: z.string() });

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
  // A request takes at most twice the largest FILE_REQUEST_UPLOAD_OPTIONS, which is at most
  // 1000, so a longer list did not come from SkySend.
  uploads: z.array(inboxUploadSchema).max(2000),
});

export type Inbox = z.infer<typeof inboxResponseSchema>;

const okResponseSchema = z.object({ ok: z.literal(true) });

const oidcUserSchema = z.object({ sub: z.string(), name: z.string(), email: z.string() });

export type OidcUser = z.infer<typeof oidcUserSchema>;

// ── Errors ─────────────────────────────────────────────

/**
 * A request the server answered with an error. The message is the server's word: a terminal
 * cleans it before it prints it, a page shows it as text.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The error message a failed response carries, or `fallback` when it names none. */
async function errorMessageOf(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  const message = (body as { error?: unknown }).error;
  return typeof message === "string" ? message : fallback;
}

/** The JSON a successful response may carry, or null, read so the connection is released. */
async function answerOf(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

// ── The client ─────────────────────────────────────────

export interface ApiClientOptions {
  /** The origin of the instance, like https://send.example.com, or "" for the page's own. */
  baseUrl: string;
  /** The fetch of the platform. The global one by default. */
  fetch?: typeof fetch;
  /**
   * The OIDC session of a client that has no session cookie, like the CLI. Sent only to the
   * routes that create something, which are the only ones the server guards.
   */
  bearer?: string;
  /**
   * Applied to every message of an ApiError before it is thrown. A terminal passes a function
   * that disarms escape sequences, since the message is the server's word and gets printed.
   */
  cleanMessage?: (message: string) => string;
}

/** Where a chunked upload goes: a normal upload, or one into the file request of this ID. */
export type UploadTarget = { requestId?: string };

export function createApiClient(options: ApiClientOptions) {
  const base = trimTrailingSlashes(options.baseUrl);
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = (path: string) => `${base}${path}`;
  const call = (path: string, init?: RequestInit) => doFetch(url(path), init);
  const guarded = (headers: Record<string, string>): Record<string, string> =>
    options.bearer ? { ...headers, Authorization: `Bearer ${options.bearer}` } : headers;
  const id = encodeURIComponent;
  const clean = options.cleanMessage ?? ((message: string) => message);
  const apiError = (status: number, message: string) => new ApiError(status, clean(message));

  /** Throws the error a failed response carries, with `fallback` when it names none. */
  async function failWith(response: Response, fallback: string): Promise<never> {
    throw apiError(response.status, await errorMessageOf(response, fallback));
  }

  async function handleResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) await failWith(response, `Request failed (${response.status})`);
    return schema.parse(await response.json());
  }

  /** The base path of a chunked upload: a normal one, or one into a file request. */
  const uploadBase = (target: UploadTarget = {}) =>
    target.requestId === undefined ? "/api/upload" : `/api/request/${id(target.requestId)}/upload`;

  /** Fetches a ciphertext from an API path, following a presigned S3 URL when one comes back. */
  async function fetchCiphertext(
    path: string,
    headers: Record<string, string>,
  ): Promise<Ciphertext> {
    const res = await call(path, { headers });
    if (!res.ok) await failWith(res, "Download failed");

    // The S3 backend answers with JSON that names a presigned URL.
    if ((res.headers.get("Content-Type") ?? "").includes("application/json")) {
      const data = presignedResponseSchema.parse(await res.json());
      let s3Res: Response;
      try {
        s3Res = await doFetch(data.url);
      } catch {
        throw new Error(
          "S3 CORS error: The bucket must allow cross-origin GET requests from this origin. " +
            "Add this origin to the CORS policy of your S3/R2 bucket.",
        );
      }
      if (!s3Res.ok) throw apiError(s3Res.status, "S3 download failed");
      if (!s3Res.body) throw new Error("No response body from S3");
      return {
        stream: s3Res.body,
        size: data.size,
        fileCount: data.fileCount,
        storageBackend: "s3",
      };
    }

    // The filesystem backend streams the ciphertext itself.
    if (!res.body) throw new Error("No response body");
    return {
      stream: res.body,
      size: parseInt(res.headers.get("Content-Length") ?? "0", 10),
      fileCount: parseInt(res.headers.get("X-File-Count") ?? "1", 10),
      storageBackend: "filesystem",
    };
  }

  /** Checks an auth token derived from a password. True when it matched, false when not. */
  async function passwordCheck(path: string, authToken: string): Promise<Response | false> {
    const res = await call(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authToken }),
    });
    if (res.status === 401) return false;
    if (res.status === 429) throw apiError(429, "rate-limited");
    if (!res.ok) throw apiError(res.status, "Password verification failed");
    return res;
  }

  async function manageInbox(path: string, method: "POST" | "DELETE", ownerToken: string) {
    const res = await call(path, { method, headers: { "X-Inbox-Owner-Token": ownerToken } });
    await handleResponse(res, okResponseSchema);
  }

  const inboxFilePath = (requestId: string, uploadId: string) =>
    `/api/inbox/${id(requestId)}/file/${id(uploadId)}`;

  return {
    /** The full URL of an API path, which a Service Worker or a WebSocket needs. */
    url,

    async fetchConfig(): Promise<ServerConfig> {
      return handleResponse(await call("/api/config"), configResponseSchema);
    },

    async fetchQuota(): Promise<QuotaStatus> {
      return handleResponse(await call("/api/quota"), quotaResponseSchema);
    },

    /** How many new file requests the caller has left today. */
    async fetchRequestLimit(): Promise<RequestLimit> {
      const res = await call("/api/request/limit", { headers: guarded({}) });
      return handleResponse(res, requestLimitSchema);
    },

    // ── Files ──

    async fetchInfo(uploadId: string): Promise<UploadInfo> {
      return handleResponse(await call(`/api/info/${id(uploadId)}`), infoResponseSchema);
    },

    /**
     * Checks the auth token derived from a password. Null for a wrong password, otherwise the
     * encrypted metadata, which GET /api/info holds back for a password-protected upload.
     */
    async verifyPassword(uploadId: string, authToken: string): Promise<UnlockedMeta | null> {
      const res = await passwordCheck(`/api/password/${id(uploadId)}`, authToken);
      if (!res) return null;
      const { encryptedMeta = null, nonce = null } = await handleResponse(res, passwordCheckSchema);
      return { encryptedMeta, nonce };
    },

    downloadFile(uploadId: string, authToken: string): Promise<Ciphertext> {
      return fetchCiphertext(`/api/download/${id(uploadId)}`, { "X-Auth-Token": authToken });
    },

    async deleteUpload(uploadId: string, ownerToken: string): Promise<void> {
      const res = await call(`/api/upload/${id(uploadId)}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": ownerToken },
      });
      if (!res.ok) await failWith(res, "Delete failed");
    },

    /** Stores the encrypted metadata of an upload, base64 as the server takes it. */
    async saveMeta(uploadId: string, ownerToken: string, encryptedMeta: string, nonce: string) {
      const res = await call(`/api/meta/${id(uploadId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Owner-Token": ownerToken },
        body: JSON.stringify({ encryptedMeta, nonce }),
      });
      if (!res.ok) await failWith(res, "Failed to save metadata");
    },

    // ── Chunked uploads, normal ones and into a file request ──

    /** Opens a chunked upload with the headers of its kind and returns its ID. */
    async uploadInit(headers: Record<string, string>, target: UploadTarget = {}): Promise<string> {
      const res = await call(`${uploadBase(target)}/init`, {
        method: "POST",
        // An upload into a request is guarded by its upload token, not by OIDC.
        headers: target.requestId === undefined ? guarded(headers) : headers,
      });
      if (!res.ok) await failWith(res, "Upload init failed");
      const parsed = uploadSessionSchema.safeParse(await answerOf(res));
      if (!parsed.success) throw apiError(res.status, "Upload init failed");
      return parsed.data.id;
    },

    async uploadChunk(
      uploadId: string,
      index: number,
      body: Blob | Uint8Array,
      target: UploadTarget = {},
    ) {
      const res = await call(`${uploadBase(target)}/${id(uploadId)}/chunk?index=${index}`, {
        method: "POST",
        body: body as BodyInit,
      });
      if (!res.ok) await failWith(res, "Chunk upload failed");
      // Reading the body lets Chrome release the HTTP/2 stream.
      await answerOf(res);
    },

    /** Commits a chunked upload. Returns the slot held for the second part of a submission. */
    async uploadFinalize(uploadId: string, init: RequestInit, target: UploadTarget = {}) {
      const res = await call(`${uploadBase(target)}/${id(uploadId)}/finalize`, {
        method: "POST",
        ...init,
      });
      if (!res.ok) await failWith(res, "Upload finalize failed");
      return { hold: holdOf(await answerOf(res)) };
    },

    /** Gives the slot of a cancelled upload into a request back at once. Best effort. */
    async cancelRequestUpload(requestId: string, uploadId: string): Promise<void> {
      await call(`/api/request/${id(requestId)}/upload/${id(uploadId)}`, { method: "DELETE" })
        .then(answerOf)
        .catch(() => {});
    },

    // ── Notes ──

    async createNote(data: CreateNoteRequest): Promise<CreateNoteResponse> {
      const res = await call("/api/note", {
        method: "POST",
        headers: guarded({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      });
      if (!res.ok) await failWith(res, "Failed to create note");
      return createNoteResponseSchema.parse(await res.json());
    },

    async fetchNoteInfo(noteId: string): Promise<NoteInfo> {
      return handleResponse(await call(`/api/note/${id(noteId)}`), noteInfoResponseSchema);
    },

    async viewNote(noteId: string, authToken: string): Promise<NoteViewResponse> {
      const res = await call(`/api/note/${id(noteId)}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });
      return handleResponse(res, noteViewResponseSchema);
    },

    async verifyNotePassword(noteId: string, authToken: string): Promise<boolean> {
      const res = await passwordCheck(`/api/note/${id(noteId)}/password`, authToken);
      if (res) await answerOf(res);
      return res !== false;
    },

    async deleteNote(noteId: string, ownerToken: string): Promise<void> {
      const res = await call(`/api/note/${id(noteId)}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": ownerToken },
      });
      if (!res.ok) await failWith(res, "Delete failed");
    },

    // ── File requests ──

    async createRequest(
      body: CreateRequestBody,
    ): Promise<z.infer<typeof createRequestResponseSchema>> {
      const res = await call("/api/request", {
        method: "POST",
        headers: guarded({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      return handleResponse(res, createRequestResponseSchema);
    },

    /** What a sender sees of a request. Needs the token from the upload link. */
    async fetchRequestForSender(requestId: string, uploadToken: string): Promise<SenderRequest> {
      const res = await call(`/api/request/${id(requestId)}`, {
        headers: { "X-Upload-Token": uploadToken },
      });
      return handleResponse(res, senderRequestSchema);
    },

    /** The inbox of a request. Listing never counts as a download. */
    async fetchInbox(requestId: string, inboxToken: string): Promise<Inbox> {
      const res = await call(`/api/inbox/${id(requestId)}`, {
        headers: { "X-Inbox-Token": inboxToken },
      });
      return handleResponse(res, inboxResponseSchema);
    },

    inboxFilePath,

    downloadInboxFile(
      requestId: string,
      uploadId: string,
      inboxToken: string,
    ): Promise<Ciphertext> {
      return fetchCiphertext(inboxFilePath(requestId, uploadId), { "X-Inbox-Token": inboxToken });
    },

    deleteInboxFile(requestId: string, uploadId: string, ownerToken: string): Promise<void> {
      return manageInbox(inboxFilePath(requestId, uploadId), "DELETE", ownerToken);
    },

    closeRequest(requestId: string, ownerToken: string): Promise<void> {
      return manageInbox(`/api/inbox/${id(requestId)}/close`, "POST", ownerToken);
    },

    deleteRequest(requestId: string, ownerToken: string): Promise<void> {
      return manageInbox(`/api/inbox/${id(requestId)}`, "DELETE", ownerToken);
    },

    // ── OIDC ──

    /** The logged-in user, or null when nobody is or OIDC is off. */
    async fetchAuthSession(): Promise<OidcUser | null> {
      try {
        const res = await call("/auth/session");
        if (!res.ok) return null;
        const parsed = oidcUserSchema.safeParse(await res.json());
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The info with the metadata a password check released, or the info's own from an older server. */
export function withUnlockedMeta(info: UploadInfo, unlocked: UnlockedMeta): UploadInfo {
  return {
    ...info,
    encryptedMeta: unlocked.encryptedMeta ?? info.encryptedMeta,
    nonce: unlocked.nonce ?? info.nonce,
  };
}
