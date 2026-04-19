import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { select, input, confirm, password } from "@inquirer/prompts";
import {
  createEncryptStream,
  createDecryptStream,
  calculateEncryptedSize,
  encryptMetadata,
  decryptMetadata,
  encryptNoteContent,
  toBase64url,
  type FileMetadata,
  type SingleFileMetadata,
  type ArchiveMetadata,
  type NoteContentType,
} from "@skysend/crypto";
import { Zip, ZipDeflate } from "fflate";
import {
  fetchConfig,
  fetchInfo,
  fetchNoteInfo,
  fetchQuota,
  downloadFile,
  verifyPassword,
  uploadInit,
  uploadChunk,
  uploadFinalize,
  saveMeta,
  createNote,
  deleteUpload,
  deleteNote,
  type ServerConfig,
  type QuotaStatus,
} from "../lib/api.js";
import { prepareUpload, prepareDownload } from "../lib/auth.js";
import { buildShareUrl, parseShareUrl } from "../lib/url.js";
import { resolveServer } from "../lib/config.js";
import {
  formatBytes,
  formatExpiry,
  renderProgress,
  clearLine,
  writeProgress,
  writeLine,
  type ProgressState,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";
import {
  addUpload,
  addNote,
  getUploads,
  getNotes,
  removeUpload,
  removeNote,
  cleanupExpired,
  type StoredUpload,
  type StoredNote,
} from "../lib/history.js";

// ── Helpers ────────────────────────────────────────────

function printHeader(config: ServerConfig, quota?: QuotaStatus): void {
  const title = config.customTitle || "SkySend";
  const line = "─".repeat(50);
  writeLine("");
  writeLine(`  ${title}`);
  writeLine(`  ${line}`);
  writeLine("");

  const services = config.enabledServices.join(", ");
  writeLine(`  Services:       ${services}`);
  writeLine(`  Max file size:  ${formatBytes(config.fileMaxSize)}`);
  writeLine(`  Max files:      ${config.fileMaxFilesPerUpload}`);

  if (quota?.enabled) {
    const windowMin = Math.round(quota.window / 60);
    writeLine(`  Upload quota:   ${formatBytes(quota.used)} / ${formatBytes(quota.limit)} (${formatBytes(quota.remaining)} remaining, resets every ${windowMin}min)`);
  } else if (config.fileUploadQuotaBytes > 0) {
    const windowMin = Math.round(config.fileUploadQuotaWindow / 60);
    writeLine(`  Upload quota:   ${formatBytes(config.fileUploadQuotaBytes)} / ${windowMin}min`);
  }

  if (config.noteMaxSize > 0) {
    writeLine(`  Max note size:  ${formatBytes(config.noteMaxSize)}`);
  }

  writeLine("");
}

// ── Upload Flow ────────────────────────────────────────

function createFileStream(filePath: string): ReadableStream<Uint8Array> {
  const nodeStream = fs.createReadStream(filePath);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); },
  });
}

async function createZipStream(
  filePaths: string[],
): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
  const outputChunks: Uint8Array[] = [];
  let outputSize = 0;

  const zipper = new Zip((_err, chunk) => {
    outputChunks.push(chunk);
    outputSize += chunk.length;
  });

  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    const entry = new ZipDeflate(name, { level: 6 });
    zipper.add(entry);
    const nodeStream = fs.createReadStream(filePath);
    for await (const chunk of nodeStream) {
      entry.push(new Uint8Array(chunk as Buffer));
    }
    entry.push(new Uint8Array(0), true);
  }
  zipper.end();

  let chunkIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunkIndex >= outputChunks.length) { controller.close(); return; }
      controller.enqueue(outputChunks[chunkIndex]!);
      chunkIndex++;
    },
  });

  return { stream, size: outputSize };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function uploadHttpTransport(
  server: string,
  headers: Record<string, string>,
  ownerTokenB64: string,
  encryptedStream: ReadableStream<Uint8Array>,
  _encryptedSize: number,
  maxConcurrent: number,
  onProgress: (loaded: number) => void,
): Promise<{ id: string }> {
  const CHUNK_SIZE = 10 * 1024 * 1024;
  const { id: uploadId } = await uploadInit(server, headers);

  const reader = encryptedStream.getReader();
  let loaded = 0;
  let chunkParts: Uint8Array[] = [];
  let chunkSize = 0;
  let chunkIdx = 0;
  let uploadError: Error | null = null;
  const active: Array<Promise<void>> = [];

  const sendChunk = async (data: Uint8Array, index: number, size: number) => {
    await uploadChunk(server, uploadId, index, data);
    loaded += size;
    onProgress(loaded);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkParts.push(value);
    chunkSize += value.byteLength;

    if (chunkSize >= CHUNK_SIZE) {
      const combined = concatChunks(chunkParts);
      const sz = chunkSize;
      chunkParts = [];
      chunkSize = 0;
      const ci = chunkIdx++;
      const p = sendChunk(combined, ci, sz)
        .catch((err) => { uploadError = err instanceof Error ? err : new Error(String(err)); })
        .finally(() => { const idx = active.indexOf(p); if (idx !== -1) active.splice(idx, 1); });
      active.push(p);
      if (active.length >= maxConcurrent) await Promise.race(active);
      if (uploadError) throw uploadError;
    }
  }

  if (chunkSize > 0) {
    const combined = concatChunks(chunkParts);
    const sz = chunkSize;
    const ci = chunkIdx++;
    const p = sendChunk(combined, ci, sz)
      .catch((err) => { uploadError = err instanceof Error ? err : new Error(String(err)); })
      .finally(() => { const idx = active.indexOf(p); if (idx !== -1) active.splice(idx, 1); });
    active.push(p);
  }

  await Promise.all(active);
  if (uploadError) throw uploadError;
  await uploadFinalize(server, uploadId, ownerTokenB64);
  return { id: uploadId };
}

async function interactiveUpload(server: string, config: ServerConfig): Promise<void> {
  // File selection
  const fileInput = await input({
    message: "File path(s) (comma-separated for multiple):",
    validate: (val) => {
      const paths = val.split(",").map((p) => p.trim()).filter(Boolean);
      if (paths.length === 0) return "Enter at least one file path";
      for (const p of paths) {
        const resolved = path.resolve(p);
        if (!fs.existsSync(resolved)) return `File not found: ${resolved}`;
        if (!fs.statSync(resolved).isFile()) return `Not a file: ${resolved}`;
      }
      if (paths.length > config.fileMaxFilesPerUpload) {
        return `Too many files (max ${config.fileMaxFilesPerUpload})`;
      }
      return true;
    },
  });

  const files = fileInput.split(",").map((p) => path.resolve(p.trim())).filter(Boolean);
  const totalSize = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);

  if (totalSize > config.fileMaxSize) {
    throw new Error(`Total size ${formatBytes(totalSize)} exceeds limit ${formatBytes(config.fileMaxSize)}`);
  }

  // Expiry
  const expireSec = await select({
    message: "Expiry time:",
    choices: config.fileExpireOptions.map((s) => ({
      name: formatExpiry(s),
      value: s,
    })),
    default: config.fileDefaultExpire,
  });

  // Max downloads
  const maxDownloads = await select({
    message: "Max downloads:",
    choices: config.fileDownloadOptions.map((d) => ({
      name: String(d),
      value: d,
    })),
    default: config.fileDefaultDownload,
  });

  // Password
  const usePassword = await confirm({ message: "Password protect?", default: false });
  let pw: string | undefined;
  if (usePassword) {
    pw = await password({ message: "Password:", mask: "*" });
    if (!pw) throw new Error("Password cannot be empty");
  }

  // Confirm
  const isMulti = files.length > 1;
  writeLine("");
  writeLine(`  Files:     ${files.length} (${formatBytes(totalSize)})`);
  writeLine(`  Expires:   ${formatExpiry(expireSec)}`);
  writeLine(`  Downloads: ${maxDownloads}`);
  writeLine(`  Password:  ${usePassword ? "yes" : "no"}`);
  writeLine("");

  const ok = await confirm({ message: "Start upload?" });
  if (!ok) { writeLine("Cancelled."); return; }

  // Prepare
  writeLine("Preparing encryption...");
  let plaintextStream: ReadableStream<Uint8Array>;
  let plaintextSize: number;

  if (isMulti) {
    writeLine("Packing files...");
    const zipResult = await createZipStream(files);
    writeLine("Packing complete.");
    plaintextStream = zipResult.stream;
    plaintextSize = zipResult.size;
  } else {
    plaintextSize = fs.statSync(files[0]!).size;
    plaintextStream = createFileStream(files[0]!);
  }

  const creds = await prepareUpload(pw);
  const encryptedStream = plaintextStream.pipeThrough(createEncryptStream(creds.keys.fileKey));
  const encryptedSize = calculateEncryptedSize(plaintextSize);

  const headers: Record<string, string> = {
    "X-Auth-Token": creds.authTokenB64,
    "X-Owner-Token": creds.ownerTokenB64,
    "X-Salt": toBase64url(creds.salt),
    "X-Max-Downloads": String(maxDownloads),
    "X-Expire-Sec": String(expireSec),
    "X-File-Count": String(files.length),
    "X-Has-Password": String(creds.hasPassword),
    "X-Content-Length": String(encryptedSize),
  };

  if (creds.hasPassword && creds.passwordSalt && creds.passwordAlgo) {
    headers["X-Password-Salt"] = toBase64url(creds.passwordSalt);
    headers["X-Password-Algo"] = creds.passwordAlgo;
  }

  const progressState: ProgressState = { loaded: 0, total: encryptedSize, startTime: Date.now() };
  const onProgress = (loaded: number) => {
    progressState.loaded = loaded;
    writeProgress(renderProgress(progressState, "Uploading"));
  };

  const uploadResult = await uploadHttpTransport(
    server, headers, creds.ownerTokenB64, encryptedStream,
    encryptedSize, config.fileUploadConcurrentChunks, onProgress,
  );

  clearLine();
  writeLine("Upload complete.");

  // Save metadata
  const metadata: FileMetadata = isMulti
    ? {
        type: "archive",
        files: files.map((f) => ({ name: path.basename(f), size: fs.statSync(f).size })),
        totalSize: files.reduce((sum, f) => sum + fs.statSync(f).size, 0),
      } satisfies ArchiveMetadata
    : {
        type: "single",
        name: path.basename(files[0]!),
        size: plaintextSize,
        mimeType: "application/octet-stream",
      } satisfies SingleFileMetadata;

  const encMeta = await encryptMetadata(metadata, creds.keys.metaKey);
  const encryptedMeta = Buffer.from(encMeta.ciphertext).toString("base64");
  const nonce = Buffer.from(encMeta.iv).toString("base64");
  await saveMeta(server, uploadResult.id, creds.ownerTokenB64, encryptedMeta, nonce);

  const shareUrl = buildShareUrl(server, "file", uploadResult.id, creds.effectiveSecretB64);

  // Save to history
  addUpload({
    id: uploadResult.id,
    server,
    url: shareUrl,
    ownerToken: creds.ownerTokenB64,
    fileNames: files.map((f) => path.basename(f)),
    totalSize: totalSize,
    hasPassword: creds.hasPassword,
    createdAt: new Date().toISOString(),
    expireSec,
  });

  writeLine("");
  writeLine(`Share URL: ${shareUrl}`);
  writeLine(`Files: ${files.length} | Size: ${formatBytes(totalSize)} | Expires: ${formatExpiry(expireSec)} | Downloads: ${maxDownloads}`);
  if (creds.hasPassword) writeLine("Password protected: yes");
}

// ── Note Flow ──────────────────────────────────────────

async function interactiveNote(server: string, config: ServerConfig): Promise<void> {
  const contentType = await select<NoteContentType>({
    message: "Note type:",
    choices: [
      { name: "Text", value: "text" },
      { name: "Password", value: "password" },
      { name: "Code", value: "code" },
      { name: "Markdown", value: "markdown" },
      { name: "SSH Key", value: "sshkey" },
    ],
  });

  const content = await input({
    message: contentType === "sshkey" ? "Path to SSH key file:" : "Content (or file path with @prefix):",
    validate: (val) => {
      if (!val.trim()) return "Content cannot be empty";
      return true;
    },
  });

  let noteContent: string;
  if (contentType === "sshkey") {
    const resolved = path.resolve(content.trim());
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
    noteContent = fs.readFileSync(resolved, "utf-8");
  } else if (content.startsWith("@")) {
    const resolved = path.resolve(content.slice(1).trim());
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
    noteContent = fs.readFileSync(resolved, "utf-8");
  } else {
    noteContent = content;
  }

  if (new TextEncoder().encode(noteContent).byteLength > config.noteMaxSize) {
    throw new Error(`Note too large (max ${formatBytes(config.noteMaxSize)})`);
  }

  // Expiry
  const expireSec = await select({
    message: "Expiry time:",
    choices: config.noteExpireOptions.map((s) => ({
      name: formatExpiry(s),
      value: s,
    })),
    default: config.noteDefaultExpire,
  });

  // Max views
  const maxViews = await select({
    message: "Max views:",
    choices: config.noteViewOptions.map((v) => ({
      name: String(v),
      value: v,
    })),
    default: config.noteDefaultViews,
  });

  // Password
  const usePassword = await confirm({ message: "Password protect?", default: false });
  let pw: string | undefined;
  if (usePassword) {
    pw = await password({ message: "Password:", mask: "*" });
    if (!pw) throw new Error("Password cannot be empty");
  }

  // Confirm
  writeLine("");
  writeLine(`  Type:      ${contentType}`);
  writeLine(`  Size:      ${formatBytes(new TextEncoder().encode(noteContent).byteLength)}`);
  writeLine(`  Expires:   ${formatExpiry(expireSec)}`);
  writeLine(`  Views:     ${maxViews}`);
  writeLine(`  Password:  ${usePassword ? "yes" : "no"}`);
  writeLine("");

  const ok = await confirm({ message: "Create note?" });
  if (!ok) { writeLine("Cancelled."); return; }

  writeLine("Encrypting...");
  const creds = await prepareUpload(pw);

  const encrypted = await encryptNoteContent(noteContent, creds.keys.metaKey);

  const result = await createNote(server, {
    encryptedContent: Buffer.from(encrypted.ciphertext).toString("base64"),
    nonce: Buffer.from(encrypted.nonce).toString("base64"),
    salt: toBase64url(creds.salt),
    ownerToken: creds.ownerTokenB64,
    authToken: creds.authTokenB64,
    contentType,
    maxViews,
    expireSec,
    hasPassword: creds.hasPassword,
    ...(creds.hasPassword && creds.passwordSalt && creds.passwordAlgo
      ? { passwordSalt: toBase64url(creds.passwordSalt), passwordAlgo: creds.passwordAlgo }
      : {}),
  });

  const shareUrl = buildShareUrl(server, "note", result.id, creds.effectiveSecretB64);

  // Save to history
  addNote({
    id: result.id,
    server,
    url: shareUrl,
    ownerToken: creds.ownerTokenB64,
    contentType,
    hasPassword: creds.hasPassword,
    createdAt: new Date().toISOString(),
    expireSec,
  });

  writeLine("");
  writeLine(`Share URL: ${shareUrl}`);
  writeLine(`Type: ${contentType} | Expires: ${formatExpiry(expireSec)} | Views: ${maxViews}`);
  if (creds.hasPassword) writeLine("Password protected: yes");
}

// ── Download Flow ──────────────────────────────────────

async function interactiveDownload(_server: string): Promise<void> {
  const url = await input({
    message: "Share URL:",
    validate: (val) => {
      if (!val.trim()) return "Enter a share URL";
      try { parseShareUrl(val.trim()); return true; } catch { return "Invalid share URL"; }
    },
  });

  const parsed = parseShareUrl(url.trim());
  if (parsed.type !== "file") {
    throw new Error("This URL is a note. Use 'View note' instead.");
  }

  writeLine("Fetching file info...");
  const info = await fetchInfo(parsed.server, parsed.id);

  let pw: string | undefined;
  if (info.hasPassword) {
    pw = await password({ message: "Password:", mask: "*" });
    if (!pw) throw new Error("Password is required for this file");
  }

  writeLine("Deriving keys...");
  const creds = await prepareDownload(
    parsed.secret,
    info.salt,
    pw,
    info.passwordSalt,
    info.passwordAlgo,
  );

  if (info.hasPassword) {
    const valid = await verifyPassword(parsed.server, parsed.id, creds.authTokenB64);
    if (!valid) throw new Error("Invalid password");
  }

  let metadata: FileMetadata | undefined;
  if (info.encryptedMeta && info.nonce) {
    const ciphertext = new Uint8Array(Buffer.from(info.encryptedMeta, "base64")) as Uint8Array<ArrayBuffer>;
    const iv = new Uint8Array(Buffer.from(info.nonce, "base64")) as Uint8Array<ArrayBuffer>;
    metadata = await decryptMetadata(ciphertext, iv, creds.keys.metaKey);
  }

  const defaultName = metadata?.type === "single"
    ? metadata.name
    : metadata?.type === "archive"
      ? "archive.zip"
      : `download-${parsed.id}`;

  const outputInput = await input({
    message: "Save to:",
    default: path.join(process.cwd(), defaultName),
  });

  const outputPath = path.resolve(outputInput.trim());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  writeLine(`Downloading to: ${outputPath}`);
  const { stream } = await downloadFile(parsed.server, parsed.id, creds.authTokenB64);
  const decryptedStream = stream.pipeThrough(createDecryptStream(creds.keys.fileKey));

  const progressState: ProgressState = { loaded: 0, total: info.size, startTime: Date.now() };
  const writer = fs.createWriteStream(outputPath);
  const reader = decryptedStream.getReader();

  let totalWritten = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(value);
    totalWritten += value.byteLength;
    progressState.loaded = totalWritten;
    writeProgress(renderProgress(progressState, "Downloading"));
  }

  await new Promise<void>((resolve, reject) => {
    writer.end(() => resolve());
    writer.on("error", reject);
  });

  clearLine();
  writeLine("Download complete.");
  writeLine(`Saved: ${outputPath} (${formatBytes(totalWritten)})`);
  if (metadata?.type === "archive") {
    writeLine(`Archive contains ${metadata.files.length} files`);
  }
}

// ── My Uploads Flow ────────────────────────────────────

async function interactiveMyUploads(server: string): Promise<void> {
  // Clean up locally expired entries across all servers
  const cleaned = cleanupExpired();
  if (cleaned.removedUploads > 0 || cleaned.removedNotes > 0) {
    const parts: string[] = [];
    if (cleaned.removedUploads > 0) parts.push(`${cleaned.removedUploads} upload(s)`);
    if (cleaned.removedNotes > 0) parts.push(`${cleaned.removedNotes} note(s)`);
    writeLine(`Cleaned ${parts.join(" and ")} (expired).`);
  }

  const uploads = getUploads().filter((u) => u.server === server);
  const notes = getNotes().filter((n) => n.server === server);

  if (uploads.length === 0 && notes.length === 0) {
    writeLine("No uploads or notes in history.");
    return;
  }

  const choices: Array<{ name: string; value: string }> = [];

  for (const u of uploads) {
    const age = formatAge(u.createdAt);
    const names = u.fileNames.join(", ");
    const label = `[File] ${names} (${formatBytes(u.totalSize)}) - ${age}`;
    choices.push({ name: label, value: `upload:${u.id}` });
  }

  for (const n of notes) {
    const age = formatAge(n.createdAt);
    const label = `[Note] ${n.contentType} - ${age}`;
    choices.push({ name: label, value: `note:${n.id}` });
  }

  choices.push({ name: "Back", value: "back" });

  const selected = await select({ message: "Your uploads:", choices });
  if (selected === "back") return;

  const [type, id] = selected.split(":") as [string, string];

  if (type === "upload") {
    const upload = uploads.find((u) => u.id === id);
    if (!upload) return;
    await showUploadDetail(upload);
  } else if (type === "note") {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    await showNoteDetail(note);
  }
}

async function showUploadDetail(upload: StoredUpload): Promise<void> {
  writeLine("");
  writeLine(`  ID:        ${upload.id}`);
  writeLine(`  Files:     ${upload.fileNames.join(", ")}`);
  writeLine(`  Size:      ${formatBytes(upload.totalSize)}`);
  writeLine(`  Password:  ${upload.hasPassword ? "yes" : "no"}`);
  writeLine(`  Created:   ${formatAge(upload.createdAt)}`);

  // Fetch live info from server
  try {
    const info = await fetchInfo(upload.server, upload.id);
    const remaining = info.maxDownloads - info.downloadCount;
    const expiresAt = new Date(info.expiresAt);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();

    writeLine(`  Downloads: ${info.downloadCount} / ${info.maxDownloads} (${remaining} remaining)`);
    if (diffMs > 0) {
      writeLine(`  Expires:   ${formatTimeRemaining(diffMs)}`);
    } else {
      writeLine(`  Expires:   expired`);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      writeLine(`  Status:    deleted or expired on server`);
      writeLine(`  URL:       ${upload.url}`);
      writeLine("");
      const action = await select({
        message: "Action:",
        choices: [
          { name: "Remove from history", value: "remove" },
          { name: "Back", value: "back" },
        ],
      });
      if (action === "remove") {
        removeUpload(upload.id);
        writeLine("Removed from history.");
      }
      return;
    }
    writeLine(`  Status:    unable to fetch live info`);
  }

  writeLine(`  URL:       ${upload.url}`);
  writeLine("");

  const action = await select({
    message: "Action:",
    choices: [
      { name: "Copy URL (print)", value: "url" },
      { name: "Delete from server", value: "delete" },
      { name: "Remove from history", value: "remove" },
      { name: "Back", value: "back" },
    ],
  });

  if (action === "url") {
    writeLine(upload.url);
  } else if (action === "delete") {
    const ok = await confirm({ message: "Delete this upload from the server?" });
    if (ok) {
      await deleteUpload(upload.server, upload.id, upload.ownerToken);
      removeUpload(upload.id);
      writeLine("Deleted.");
    }
  } else if (action === "remove") {
    removeUpload(upload.id);
    writeLine("Removed from history.");
  }
}

async function showNoteDetail(note: StoredNote): Promise<void> {
  writeLine("");
  writeLine(`  ID:        ${note.id}`);
  writeLine(`  Type:      ${note.contentType}`);
  writeLine(`  Password:  ${note.hasPassword ? "yes" : "no"}`);
  writeLine(`  Created:   ${formatAge(note.createdAt)}`);

  // Fetch live info from server
  try {
    const info = await fetchNoteInfo(note.server, note.id);
    const remaining = info.maxViews - info.viewCount;
    const expiresAt = new Date(info.expiresAt);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();

    writeLine(`  Views:     ${info.viewCount} / ${info.maxViews} (${remaining} remaining)`);
    if (diffMs > 0) {
      writeLine(`  Expires:   ${formatTimeRemaining(diffMs)}`);
    } else {
      writeLine(`  Expires:   expired`);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      writeLine(`  Status:    deleted or expired on server`);
      writeLine(`  URL:       ${note.url}`);
      writeLine("");
      const action = await select({
        message: "Action:",
        choices: [
          { name: "Remove from history", value: "remove" },
          { name: "Back", value: "back" },
        ],
      });
      if (action === "remove") {
        removeNote(note.id);
        writeLine("Removed from history.");
      }
      return;
    }
    writeLine(`  Status:    unable to fetch live info`);
  }

  writeLine(`  URL:       ${note.url}`);
  writeLine("");

  const action = await select({
    message: "Action:",
    choices: [
      { name: "Copy URL (print)", value: "url" },
      { name: "Delete from server", value: "delete" },
      { name: "Remove from history", value: "remove" },
      { name: "Back", value: "back" },
    ],
  });

  if (action === "url") {
    writeLine(note.url);
  } else if (action === "delete") {
    const ok = await confirm({ message: "Delete this note from the server?" });
    if (ok) {
      await deleteNote(note.server, note.id, note.ownerToken);
      removeNote(note.id);
      writeLine("Deleted.");
    }
  } else if (action === "remove") {
    removeNote(note.id);
    writeLine("Removed from history.");
  }
}

function formatTimeRemaining(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Update Flow ────────────────────────────────────────

async function interactiveUpdate(): Promise<void> {
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"),
  ) as { version: string };
  const currentVersion = pkg.version;

  writeLine(`Current version: v${currentVersion}`);
  writeLine("Checking for updates...");

  const res = await fetch(
    "https://api.github.com/repos/skyfay/SkySend/releases/latest",
    { headers: { "User-Agent": "skysend-cli", Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);

  const release = (await res.json()) as {
    tag_name: string;
    html_url: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };

  const latestVersion = release.tag_name.replace(/^v/, "");
  const compare = compareVersions(latestVersion, currentVersion);

  if (compare <= 0) {
    writeLine(`Already up to date (v${currentVersion}).`);
    return;
  }

  writeLine(`New version available: v${latestVersion}`);
  writeLine(`Release: ${release.html_url}`);

  const ok = await confirm({ message: "Install update?" });
  if (!ok) return;

  const { platform, arch } = await import("node:os").then((os) => ({
    platform: os.platform(),
    arch: os.arch(),
  }));

  let osName: string;
  switch (platform) {
    case "linux":  osName = "linux"; break;
    case "darwin": osName = "darwin"; break;
    case "win32":  osName = "windows"; break;
    default: throw new Error(`Unsupported platform: ${platform}`);
  }

  let archName: string;
  switch (arch) {
    case "x64":   archName = "x64"; break;
    case "arm64": archName = "arm64"; break;
    default: throw new Error(`Unsupported architecture: ${arch}`);
  }

  const platformStr = `${osName}-${archName}`;
  const assetName = platformStr === "windows-x64" ? `skysend-${platformStr}.exe` : `skysend-${platformStr}`;
  const asset = release.assets.find((a) => a.name === assetName);

  if (!asset) throw new Error(`No binary found for ${platformStr}`);

  writeLine(`Downloading ${assetName}...`);
  const dlRes = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "skysend-cli" },
    redirect: "follow",
  });
  if (!dlRes.ok || !dlRes.body) throw new Error(`Download failed: ${dlRes.status}`);

  const data = new Uint8Array(await dlRes.arrayBuffer());

  // Verify checksum
  const checksumAsset = release.assets.find((a) => a.name === "checksums.txt");
  if (checksumAsset) {
    try {
      const csRes = await fetch(checksumAsset.browser_download_url, {
        headers: { "User-Agent": "skysend-cli" },
        redirect: "follow",
      });
      if (csRes.ok) {
        const csText = await csRes.text();
        const line = csText.split("\n").find((l) => l.includes(assetName));
        if (line) {
          const expected = line.split(/\s+/)[0]!;
          const hashBuffer = await crypto.subtle.digest("SHA-256", data);
          const actual = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (expected !== actual) throw new Error("Checksum mismatch! Aborting.");
          writeLine("Checksum verified.");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Checksum")) throw err;
    }
  }

  const execPath = process.execPath;
  const tmpPath = `${execPath}.update`;

  fs.writeFileSync(tmpPath, data);
  fs.chmodSync(tmpPath, 0o755);
  fs.renameSync(tmpPath, execPath);
  writeLine(`Updated to v${latestVersion}.`);
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Main Menu ──────────────────────────────────────────

export function registerInteractiveCommand(program: Command): void {
  program
    .command("interactive", { isDefault: true })
    .alias("i")
    .description("Interactive mode with menus")
    .option("-s, --server <url>", "Server URL")
    .action(async (options: { server?: string }) => {
      try {
        const server = resolveServer(options.server);

        writeLine("Connecting to server...");
        const config = await fetchConfig(server);
        let quota: QuotaStatus | undefined;
        try {
          quota = await fetchQuota(server);
        } catch {
          // Quota endpoint may not be available
        }
        printHeader(config, quota);

        while (true) {
          const choices: Array<{ name: string; value: string }> = [];

          if (config.enabledServices.includes("file")) {
            choices.push({ name: "Upload file(s)", value: "upload" });
            choices.push({ name: "Download file", value: "download" });
          }
          if (config.enabledServices.includes("note")) {
            choices.push({ name: "Create note", value: "note" });
          }
          choices.push({ name: "My uploads", value: "history" });
          choices.push({ name: "Check for updates", value: "update" });
          choices.push({ name: "Exit", value: "exit" });

          const action = await select({
            message: "What would you like to do?",
            choices,
          });

          if (action === "exit") break;

          try {
            if (action === "upload") {
              await interactiveUpload(server, config);
            } else if (action === "download") {
              await interactiveDownload(server);
            } else if (action === "note") {
              await interactiveNote(server, config);
            } else if (action === "history") {
              await interactiveMyUploads(server);
            } else if (action === "update") {
              await interactiveUpdate();
            }
          } catch (err) {
            if (err instanceof ApiError) {
              writeLine(`Error: ${err.message} (HTTP ${err.status})`);
            } else {
              writeLine(`Error: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          writeLine("");
        }

        writeLine("Bye!");
      } catch (err) {
        if (err instanceof ApiError) {
          console.error(`Error: ${err.message} (HTTP ${err.status})`);
        } else {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
      }
    });
}
