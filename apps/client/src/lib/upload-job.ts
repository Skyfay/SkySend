import * as fs from "node:fs";
import * as path from "node:path";
import { generateSalt, generateSecret, type FileMetadata } from "@skysend/crypto";
import {
  archiveMetadata,
  archiveMetadataFits,
  buildShareLink,
  newSubmission,
  openRequestLink,
  parseShareLink,
  plaintextOf,
  uniqueNames,
  uploadEncrypted,
  type RequestAccess,
  type SenderBrief,
  type SenderRequest,
  type ServerConfig,
  type SourceFile,
  type UploadEvents,
} from "@skysend/transfer";
import { apiFor } from "./api.js";
import { hashWasmArgon2 } from "./auth.js";
import { formatBytes } from "./progress.js";

/** One upload of the CLI, from the command and from the TUI alike. */
export interface UploadJob {
  server: string;
  /** The files and folders to send. Several files, or a folder, go up as one zip. */
  paths: readonly string[];
  /** The config the caller checked the options against. */
  config: ServerConfig;
  expireSec: number;
  maxDownloads: number;
  password?: string;
  /** The OIDC session, when the server guards uploads. */
  oidcToken?: string;
  /** False with --no-ws, true lets the upload take the WebSocket when the server offers it. */
  webSocket: boolean;
  /** Ends the upload with "Upload cancelled", the TUI's Escape. */
  signal?: AbortSignal;
}

export interface UploadJobResult {
  id: string;
  /** The share link, the one thing printed with the secret in it. */
  url: string;
  ownerToken: string;
  /** The names in the order sent, unique within the zip. */
  names: string[];
  /** Plaintext bytes: the file, or the zip of several. */
  size: number;
  /** The sum of the files, without the zip around them. */
  totalSize: number;
  fileCount: number;
  hasPassword: boolean;
  transport: "ws" | "http";
}

/**
 * A file as the upload reads it. `fs.openAsBlob` hands out a stream that reads only what the
 * upload takes, in Node and in Bun, so a file never lands in memory when the network is slower
 * than the disk.
 */
async function openFile(filePath: string): Promise<SourceFile & { size: number }> {
  const blob = await fs.openAsBlob(filePath);
  return { size: blob.size, stream: () => blob.stream() as ReadableStream<Uint8Array> };
}

/**
 * Opens the upload WebSocket with the OIDC token in the handshake. Node and Bun take headers as
 * the second argument, which the DOM type of WebSocket does not know.
 */
function openWebSocket(oidcToken: string | undefined) {
  return (url: string): WebSocket => {
    const init = { headers: oidcToken ? { Authorization: `Bearer ${oidcToken}` } : {} };
    return new WebSocket(url, init as unknown as string[]);
  };
}

/** A file to send and its name in the upload, `folder/sub/file.txt` when it came in a folder. */
export interface SourceEntry {
  path: string;
  name: string;
  size: number;
}

/**
 * The files behind the given paths. A folder brings every file below it, named by its path from
 * the folder's parent, so the zip keeps the folder. Links to folders are skipped, which keeps a
 * loop of links from walking forever, links to files are followed. With a `limit`, the walk
 * stops soon after passing it and says so, for measuring a folder that may be huge.
 */
export function listSources(
  paths: readonly string[],
  limit = Infinity,
): { entries: SourceEntry[]; folders: boolean; truncated: boolean } {
  const entries: SourceEntry[] = [];
  let folders = false;
  const walk = (dir: string, prefix: string) => {
    if (entries.length > limit) return;
    const children = fs.readdirSync(dir, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.length > limit) return;
      const full = path.join(dir, child.name);
      const name = `${prefix}/${child.name}`;
      if (child.isDirectory()) {
        walk(full, name);
      } else if (child.isFile() || child.isSymbolicLink()) {
        const stat = fs.statSync(full, { throwIfNoEntry: false });
        if (stat?.isFile()) entries.push({ path: full, name, size: stat.size });
      }
    }
  };
  for (const given of paths) {
    const stat = fs.statSync(given, { throwIfNoEntry: false });
    if (!stat) throw new Error(`File not found: ${given}`);
    if (stat.isDirectory()) {
      folders = true;
      walk(given, path.basename(path.resolve(given)));
    } else if (stat.isFile()) {
      entries.push({ path: given, name: path.basename(given), size: stat.size });
    } else {
      throw new Error(`Not a file or folder: ${given}`);
    }
  }
  return { entries, folders, truncated: entries.length > limit };
}

/** How much one upload may hold: the server's limits, or those of a file request. */
interface UploadLimits {
  maxFiles: number;
  maxSize: number;
}

/**
 * The metadata of these files and checks the server would otherwise only answer at the end:
 * the number of files, the size of one upload and the length of the file list.
 */
export async function describeUpload(paths: readonly string[], limits: UploadLimits) {
  const { entries, folders } = listSources(paths);
  if (entries.length === 0) throw new Error("There are no files to send in what you picked");
  if (entries.length > limits.maxFiles) {
    throw new Error(`Too many files (${entries.length}). Max: ${limits.maxFiles} in one upload`);
  }
  const files = await Promise.all(entries.map((entry) => openFile(entry.path)));
  const names = uniqueNames(entries.map((entry) => entry.name));
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  let metadata: FileMetadata;
  // A folder stays a zip even with one file in it, so its name keeps the folder.
  if (files.length === 1 && !folders) {
    metadata = {
      type: "single",
      name: names[0]!,
      size: files[0]!.size,
      mimeType: "application/octet-stream",
    };
  } else {
    const entries = names.map((name, i) => ({ name, size: files[i]!.size }));
    if (!archiveMetadataFits(entries)) {
      throw new Error("The list of file names is too long for the server, send fewer files at once");
    }
    metadata = archiveMetadata(entries);
  }
  const size = metadata.type === "archive" ? metadata.archiveSize! : metadata.size;
  if (size > limits.maxSize) {
    throw new Error(`File too large (${formatBytes(size)}). Max: ${formatBytes(limits.maxSize)}`);
  }
  return { files, names, totalSize, metadata, size };
}

/**
 * The plaintext, ended with "Upload cancelled" once `signal` aborts. Both transports read the
 * plaintext, so an error here stops either of them at its next read.
 */
function abortable<T extends { stream: ReadableStream<Uint8Array> }>(plaintext: T, signal?: AbortSignal): T {
  if (!signal) return plaintext;
  const reader = plaintext.stream.getReader();
  const cancelled = () => new Error("Upload cancelled");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener("abort", () => {
        controller.error(cancelled());
        void reader.cancel().catch(() => {});
      }, { once: true });
    },
    async pull(controller) {
      if (signal.aborted) throw cancelled();
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { ...plaintext, stream };
}

export async function runUpload(job: UploadJob, events: UploadEvents = {}): Promise<UploadJobResult> {
  const { files, names, totalSize, metadata, size } = await describeUpload(job.paths, {
    maxFiles: job.config.fileMaxFilesPerUpload,
    maxSize: job.config.fileMaxSize,
  });
  let transport: "ws" | "http" = "http";
  const secret = generateSecret();
  const result = await uploadEncrypted({
    api: apiFor(job.server, job.oidcToken),
    ...(job.webSocket ? { openWebSocket: openWebSocket(job.oidcToken) } : {}),
    config: job.config,
    secret,
    salt: generateSalt(),
    password: job.password ?? "",
    argon2id: hashWasmArgon2,
    maxDownloads: job.maxDownloads,
    expireSec: job.expireSec,
    fileCount: files.length,
    metadata,
    plaintext: abortable(plaintextOf(files, metadata), job.signal),
    ...events,
    onTransport: (used, fallback, reason) => {
      transport = used;
      events.onTransport?.(used, fallback, reason);
    },
  });
  if (result.kind !== "share") throw new Error("The server treated the upload as a file request");
  return {
    id: result.id,
    url: buildShareLink(job.server, "file", result.id, result.effectiveSecret),
    ownerToken: result.ownerToken,
    names,
    size,
    totalSize,
    fileCount: files.length,
    hasPassword: (job.password ?? "") !== "",
    transport,
  };
}

/** A file request to send into, opened from its upload link. */
export interface OpenRequest {
  server: string;
  id: string;
  access: RequestAccess;
  status: SenderRequest;
  brief: SenderBrief;
  config: ServerConfig;
}

/**
 * Opens the upload link of a file request, or says in a sentence why the CLI cannot send into
 * it. A request that asks for a note, alone or beside files, is left to the browser: the web app
 * sends files and note as one submission, and files alone would leave half of one.
 */
export async function openRequest(url: string): Promise<OpenRequest> {
  const link = parseShareLink(url, ["request", "inbox"]);
  if (link.type === "inbox") {
    throw new Error(
      "This is the inbox link of a request, which is for whoever made it. To send files, use its upload link.",
    );
  }
  const api = apiFor(link.server);
  const config = await api.fetchConfig();
  const host = new URL(link.server).host;
  if (!config.fileRequestsEnabled) throw new Error(`${host} does not take file requests.`);
  const opened = await openRequestLink(api, link.id, link.secret);
  if (opened.state !== "ready") {
    throw new Error({
      invalid: "This upload link is not complete. Copy it again from where you got it.",
      gone: "This request no longer exists.",
      broken: "This request cannot be read. Ask whoever sent it for a new link.",
    }[opened.state]);
  }
  const { brief, status } = opened;
  if (brief.asks.includes("note")) {
    throw new Error(
      brief.asks.includes("files")
        ? "This request asks for files and a note together, which the CLI cannot send yet. Open the link in a browser."
        : "This request asks for a note, which the CLI cannot write yet. Open the link in a browser.",
    );
  }
  if (!status.open) throw new Error("This request is closed.");
  if (status.uploadsLeft === 0) throw new Error("This request takes no more uploads.");
  return { server: link.server, id: link.id, access: opened.access, status, brief, config };
}

/** The sentence for a request that refused an upload, from the key the shared core gives. */
export function requestFailure(message: string): string {
  switch (message) {
    case "full":
      return "This request takes no more uploads.";
    case "gone":
      return "This request no longer exists.";
    case "closed":
      return "This request closed in the meantime.";
    case "tooLarge":
      return "This is larger than the request takes in one upload.";
    case "quota":
      return "Your upload quota on this server is used up for now.";
    default:
      return message;
  }
}

/** An upload into a file request. The request sets expiry, downloads and protection. */
export interface RequestUploadJob {
  request: OpenRequest;
  paths: readonly string[];
  /** False with --no-ws, true lets the upload take the WebSocket when the server offers it. */
  webSocket: boolean;
  signal?: AbortSignal;
}

export interface RequestUploadResult {
  id: string;
  names: string[];
  size: number;
  totalSize: number;
  fileCount: number;
  transport: "ws" | "http";
}

/**
 * Sends files into a request. The file secret is wrapped to the requester's public key from the
 * link, so only the inbox opens it, and the sender keeps no link. Each send is a submission of
 * its own, the way the web app sends files alone.
 */
export async function runRequestUpload(
  job: RequestUploadJob,
  events: UploadEvents = {},
): Promise<RequestUploadResult> {
  const { request } = job;
  const { files, names, totalSize, metadata, size } = await describeUpload(job.paths, {
    maxFiles: request.status.maxFilesPerUpload,
    maxSize: request.status.maxUploadSize,
  });
  let transport: "ws" | "http" = "http";
  let result;
  try {
    result = await uploadEncrypted({
      api: apiFor(request.server),
      ...(job.webSocket ? { openWebSocket: openWebSocket(undefined) } : {}),
      config: request.config,
      secret: generateSecret(),
      salt: generateSalt(),
      password: "",
      argon2id: hashWasmArgon2,
      maxDownloads: 0,
      expireSec: 0,
      fileCount: files.length,
      metadata: { ...metadata, submission: newSubmission() },
      plaintext: abortable(plaintextOf(files, metadata), job.signal),
      request: { id: request.id, uploadToken: request.access.uploadToken, publicKey: request.access.publicKey },
      ...events,
      onTransport: (used, fallback, reason) => {
        transport = used;
        events.onTransport?.(used, fallback, reason);
      },
    });
  } catch (err) {
    if (job.signal?.aborted) throw err;
    throw new Error(requestFailure(err instanceof Error ? err.message : String(err)), { cause: err });
  }
  if (result.kind !== "delivered") throw new Error("The server did not treat the upload as one into a request");
  return { id: result.id, names, size, totalSize, fileCount: files.length, transport };
}
