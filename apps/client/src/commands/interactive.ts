import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { select, input, confirm, password } from "@inquirer/prompts";
import {
  createEncryptStream,
  calculateEncryptedSize,
  encryptMetadata,
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
  uploadInit,
  uploadChunk,
  uploadFinalize,
  saveMeta,
  createNote,
  type ServerConfig,
} from "../lib/api.js";
import { prepareUpload } from "../lib/auth.js";
import { buildShareUrl } from "../lib/url.js";
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

// ── Helpers ────────────────────────────────────────────

function printHeader(config: ServerConfig): void {
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

  if (config.fileUploadQuotaBytes > 0) {
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

  writeLine("");
  writeLine(`Share URL: ${shareUrl}`);
  writeLine(`Type: ${contentType} | Expires: ${formatExpiry(expireSec)} | Views: ${maxViews}`);
  if (creds.hasPassword) writeLine("Password protected: yes");
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
        printHeader(config);

        while (true) {
          const choices: Array<{ name: string; value: string }> = [];

          if (config.enabledServices.includes("file")) {
            choices.push({ name: "Upload file(s)", value: "upload" });
          }
          if (config.enabledServices.includes("note")) {
            choices.push({ name: "Create note", value: "note" });
          }
          choices.push({ name: "Exit", value: "exit" });

          const action = await select({
            message: "What would you like to do?",
            choices,
          });

          if (action === "exit") break;

          try {
            if (action === "upload") {
              await interactiveUpload(server, config);
            } else if (action === "note") {
              await interactiveNote(server, config);
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
