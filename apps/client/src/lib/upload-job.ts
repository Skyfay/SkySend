import * as fs from "node:fs";
import * as path from "node:path";
import { generateSalt, generateSecret, type FileMetadata } from "@skysend/crypto";
import {
  archiveMetadata,
  archiveMetadataFits,
  plaintextOf,
  uniqueNames,
  uploadEncrypted,
  type ServerConfig,
  type SourceFile,
  type UploadEvents,
} from "@skysend/transfer";
import { apiFor } from "./api.js";
import { hashWasmArgon2 } from "./auth.js";
import { formatBytes } from "./progress.js";
import { buildShareUrl } from "./url.js";

/** One upload of the CLI, from the command and from the TUI alike. */
export interface UploadJob {
  server: string;
  /** The files to send, several go up as one zip. */
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

/**
 * The metadata of these files and checks the server would otherwise only answer at the end:
 * the size of one upload and the length of the file list.
 */
export async function describeUpload(paths: readonly string[], config: ServerConfig) {
  const files = await Promise.all(paths.map(openFile));
  const names = uniqueNames(paths.map((p) => path.basename(p)));
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  let metadata: FileMetadata;
  if (files.length === 1) {
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
  if (size > config.fileMaxSize) {
    throw new Error(`File too large (${formatBytes(size)}). Max: ${formatBytes(config.fileMaxSize)}`);
  }
  return { files, names, totalSize, metadata, size };
}

export async function runUpload(job: UploadJob, events: UploadEvents = {}): Promise<UploadJobResult> {
  const { files, names, totalSize, metadata, size } = await describeUpload(job.paths, job.config);
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
    plaintext: plaintextOf(files, metadata),
    ...events,
    onTransport: (used, fallback, reason) => {
      transport = used;
      events.onTransport?.(used, fallback, reason);
    },
  });
  if (result.kind !== "share") throw new Error("The server treated the upload as a file request");
  return {
    id: result.id,
    url: buildShareUrl(job.server, "file", result.id, result.effectiveSecret),
    ownerToken: result.ownerToken,
    names,
    size,
    totalSize,
    fileCount: files.length,
    hasPassword: (job.password ?? "") !== "",
    transport,
  };
}
