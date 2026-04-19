import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  createEncryptStream,
  calculateEncryptedSize,
  encryptMetadata,
  toBase64url,
  type FileMetadata,
  type SingleFileMetadata,
  type ArchiveMetadata,
} from "@skysend/crypto";
import { Zip, ZipDeflate } from "fflate";
import {
  fetchConfig,
  uploadInit,
  uploadChunk,
  uploadFinalize,
  saveMeta,
} from "../lib/api.js";
import { prepareUpload } from "../lib/auth.js";
import { buildShareUrl } from "../lib/url.js";
import { resolveServer } from "../lib/config.js";
import {
  formatBytes,
  formatExpiry,
  parseDuration,
  renderProgress,
  clearLine,
  writeProgress,
  writeLine,
  promptPassword,
  type ProgressState,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";
import { addUpload } from "../lib/history.js";

interface UploadOptions {
  server?: string;
  expires?: string;
  downloads?: string;
  password?: boolean | string;
  json?: boolean;
}

async function uploadWsTransport(
  server: string,
  headers: Record<string, string>,
  encryptedStream: ReadableStream<Uint8Array>,
  encryptedSize: number,
  speedLimit: number,
  onProgress: (loaded: number) => void,
): Promise<{ id: string }> {
  const FRAME_SIZE = 256 * 1024;
  const HIGH_WATER = 8 * 1024 * 1024;
  const LOW_WATER = 2 * 1024 * 1024;
  const READY_TIMEOUT_MS = 10_000;
  const DONE_TIMEOUT_MS = 5 * 60_000;

  const wsUrl = new URL("/api/upload/ws", server);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  const ws = new WebSocket(wsUrl.toString());

  let fatalError: Error | null = null;
  let doneId: string | null = null;
  let readyId: string | null = null;
  const readyWaiters: Array<() => void> = [];
  const doneWaiters: Array<() => void> = [];

  const notifyReady = () => { for (const f of readyWaiters.splice(0)) f(); };
  const notifyDone = () => { for (const f of doneWaiters.splice(0)) f(); };

  ws.addEventListener("message", (evt) => {
    if (typeof evt.data !== "string") return;
    let msg: { type?: string; id?: string; message?: string };
    try {
      msg = JSON.parse(evt.data as string);
    } catch {
      return;
    }
    if (msg.type === "ready" && typeof msg.id === "string") {
      readyId = msg.id;
      notifyReady();
    } else if (msg.type === "done" && typeof msg.id === "string") {
      doneId = msg.id;
      notifyReady();
      notifyDone();
    } else if (msg.type === "error") {
      fatalError = new Error(msg.message ?? "Server error");
      notifyReady();
      notifyDone();
    }
  });

  ws.addEventListener("close", (evt: CloseEvent) => {
    if (!doneId && !fatalError) {
      fatalError = new Error(`WebSocket closed unexpectedly (code=${evt.code})`);
    }
    notifyReady();
    notifyDone();
  });
  ws.addEventListener("error", () => {
    if (!fatalError) fatalError = new Error("WebSocket error");
    notifyReady();
    notifyDone();
  });

  // Wait for open
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket handshake timed out")), 10_000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebSocket handshake failed")); });
  });

  try {
    ws.send(JSON.stringify({
      type: "init",
      headers: {
        authToken: headers["X-Auth-Token"]!,
        ownerToken: headers["X-Owner-Token"]!,
        salt: headers["X-Salt"]!,
        maxDownloads: parseInt(headers["X-Max-Downloads"]!, 10),
        expireSec: parseInt(headers["X-Expire-Sec"]!, 10),
        fileCount: parseInt(headers["X-File-Count"]!, 10),
        contentLength: encryptedSize,
        hasPassword: headers["X-Has-Password"] === "true",
        passwordSalt: headers["X-Password-Salt"],
        passwordAlgo: headers["X-Password-Algo"],
      },
    }));

    // Wait for ready
    await new Promise<void>((resolve, reject) => {
      if (readyId || fatalError) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error("WebSocket ready timed out")), READY_TIMEOUT_MS);
      readyWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
    if (fatalError) throw fatalError;
    if (!readyId) throw new Error("Server did not return an upload id");

    // Stream frames
    const reader = encryptedStream.getReader();
    let loaded = 0;
    let carry: Uint8Array | null = null;
    const sendStartedAt = Date.now();

    const drain = async () => {
      while ((ws as unknown as { bufferedAmount: number }).bufferedAmount > LOW_WATER) {
        if (fatalError) throw fatalError;
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    const sendFrame = async (frame: Uint8Array) => {
      if (fatalError) throw fatalError;
      if ((ws as unknown as { bufferedAmount: number }).bufferedAmount > HIGH_WATER) await drain();

      if (speedLimit > 0 && loaded > 0) {
        const elapsedMs = Date.now() - sendStartedAt;
        const expectedMs = (loaded / speedLimit) * 1000;
        const delayMs = expectedMs - elapsedMs;
        if (delayMs > 1) await new Promise((r) => setTimeout(r, delayMs));
      }

      const copy = new Uint8Array(frame.byteLength);
      copy.set(frame);
      ws.send(copy.buffer as ArrayBuffer);
      loaded += frame.byteLength;
      onProgress(loaded);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let buf: Uint8Array;
      if (carry && carry.byteLength > 0) {
        buf = new Uint8Array(carry.byteLength + value.byteLength);
        buf.set(carry);
        buf.set(value, carry.byteLength);
        carry = null;
      } else {
        buf = value;
      }

      let offset = 0;
      while (buf.byteLength - offset >= FRAME_SIZE) {
        await sendFrame(buf.subarray(offset, offset + FRAME_SIZE));
        offset += FRAME_SIZE;
      }
      if (offset < buf.byteLength) {
        carry = buf.slice(offset);
      }
    }
    if (carry && carry.byteLength > 0) {
      await sendFrame(carry);
    }

    if (fatalError) throw fatalError;

    // Finalize
    ws.send(JSON.stringify({ type: "finalize" }));
    await new Promise<void>((resolve, reject) => {
      if (doneId || fatalError) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error("WebSocket finalize timed out")), DONE_TIMEOUT_MS);
      doneWaiters.push(() => { clearTimeout(timer); resolve(); });
    });

    if (fatalError) throw fatalError;
    if (!doneId) throw new Error("Server did not confirm upload completion");
    return { id: doneId };
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
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
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

  const { id: uploadId } = await uploadInit(server, headers);

  const reader = encryptedStream.getReader();
  let loaded = 0;
  let chunkParts: Uint8Array[] = [];
  let chunkSize = 0;
  let chunkIndex = 0;
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
      const uploadedSize = chunkSize;
      chunkParts = [];
      chunkSize = 0;
      const currentIndex = chunkIndex++;

      const p = sendChunk(combined, currentIndex, uploadedSize)
        .catch((err) => { uploadError = err instanceof Error ? err : new Error(String(err)); })
        .finally(() => { const idx = active.indexOf(p); if (idx !== -1) active.splice(idx, 1); });
      active.push(p);

      if (active.length >= maxConcurrent) await Promise.race(active);
      if (uploadError) throw uploadError;
    }
  }

  if (chunkSize > 0) {
    const combined = concatChunks(chunkParts);
    const uploadedSize = chunkSize;
    chunkParts = [];
    chunkSize = 0;
    const currentIndex = chunkIndex++;

    const p = sendChunk(combined, currentIndex, uploadedSize)
      .catch((err) => { uploadError = err instanceof Error ? err : new Error(String(err)); })
      .finally(() => { const idx = active.indexOf(p); if (idx !== -1) active.splice(idx, 1); });
    active.push(p);
  }

  await Promise.all(active);
  if (uploadError) throw uploadError;

  await uploadFinalize(server, uploadId, ownerTokenB64);
  return { id: uploadId };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function createFileStream(filePath: string): ReadableStream<Uint8Array> {
  const nodeStream = fs.createReadStream(filePath);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

async function createZipStream(
  filePaths: string[],
  onZipProgress?: (bytesRead: number, totalBytes: number) => void,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
  const totalBytes = filePaths.reduce((sum, p) => sum + fs.statSync(p).size, 0);
  let bytesRead = 0;

  const outputChunks: Uint8Array[] = [];
  let outputSize = 0;

  const zipper = new Zip((_err, chunk, _final) => {
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
      bytesRead += (chunk as Buffer).byteLength;
      onZipProgress?.(bytesRead, totalBytes);
    }
    entry.push(new Uint8Array(0), true);
  }

  zipper.end();

  let chunkIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunkIndex >= outputChunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(outputChunks[chunkIndex]!);
      chunkIndex++;
    },
  });

  return { stream, size: outputSize };
}

export function registerUploadCommand(program: Command): void {
  program
    .command("upload")
    .description("Upload file(s) with end-to-end encryption")
    .argument("<files...>", "File path(s) to upload")
    .option("-s, --server <url>", "Server URL")
    .option("-e, --expires <duration>", "Expiry time (e.g. 5m, 1h, 1d, 7d)")
    .option("-d, --downloads <count>", "Max download count")
    .option("-p, --password [password]", "Password protect (prompts if no value given)")
    .option("--json", "Output as JSON")
    .action(async (files: string[], options: UploadOptions) => {
      try {
        const server = resolveServer(options.server);

        // Validate files exist
        for (const file of files) {
          if (!fs.existsSync(file)) {
            throw new Error(`File not found: ${file}`);
          }
          const stat = fs.statSync(file);
          if (!stat.isFile()) {
            throw new Error(`Not a file: ${file}`);
          }
        }

        // Fetch server config for limits
        const config = await fetchConfig(server);

        // Resolve password
        let password: string | undefined;
        if (options.password === true) {
          password = await promptPassword("Password: ");
          if (!password) throw new Error("Password cannot be empty");
        } else if (typeof options.password === "string") {
          password = options.password;
        }

        // Resolve expiry
        const expireSec = options.expires
          ? parseDuration(options.expires)
          : config.fileDefaultExpire;
        if (!config.fileExpireOptions.includes(expireSec)) {
          throw new Error(
            `Invalid expiry. Options: ${config.fileExpireOptions.map((s) => `${s}s`).join(", ")}`,
          );
        }

        // Resolve download count
        const maxDownloads = options.downloads
          ? parseInt(options.downloads, 10)
          : config.fileDefaultDownload;
        if (!config.fileDownloadOptions.includes(maxDownloads)) {
          throw new Error(
            `Invalid download count. Options: ${config.fileDownloadOptions.join(", ")}`,
          );
        }

        const isMultiFile = files.length > 1;
        const fileCount = files.length;

        // Prepare plaintext stream
        let plaintextStream: ReadableStream<Uint8Array>;
        let plaintextSize: number;

        if (isMultiFile) {
          if (!options.json) writeLine("Packing files...");
          const zipResult = await createZipStream(files, (read, total) => {
            if (!options.json) {
              writeProgress(renderProgress(
                { loaded: read, total, startTime: Date.now() - 1 },
                "Packing",
              ));
            }
          });
          if (!options.json) { clearLine(); writeLine("Packing complete."); }
          plaintextStream = zipResult.stream;
          plaintextSize = zipResult.size;
        } else {
          const stat = fs.statSync(files[0]!);
          plaintextSize = stat.size;
          plaintextStream = createFileStream(files[0]!);
        }

        // Validate size
        if (plaintextSize > config.fileMaxSize) {
          throw new Error(
            `File too large (${formatBytes(plaintextSize)}). Max: ${formatBytes(config.fileMaxSize)}`,
          );
        }

        // Prepare crypto
        if (!options.json) writeLine("Preparing encryption...");
        const creds = await prepareUpload(password);

        const encryptedSize = calculateEncryptedSize(plaintextSize);
        const encryptedStream = plaintextStream.pipeThrough(
          createEncryptStream(creds.keys.fileKey),
        );

        // Build headers
        const headers: Record<string, string> = {
          "X-Auth-Token": creds.authTokenB64,
          "X-Owner-Token": creds.ownerTokenB64,
          "X-Salt": toBase64url(creds.salt),
          "X-Max-Downloads": String(maxDownloads),
          "X-Expire-Sec": String(expireSec),
          "X-File-Count": String(fileCount),
          "X-Has-Password": String(creds.hasPassword),
          "X-Content-Length": String(encryptedSize),
        };

        if (creds.hasPassword && creds.passwordSalt && creds.passwordAlgo) {
          headers["X-Password-Salt"] = toBase64url(creds.passwordSalt);
          headers["X-Password-Algo"] = creds.passwordAlgo;
        }

        // Upload
        const progressState: ProgressState = {
          loaded: 0,
          total: encryptedSize,
          startTime: Date.now(),
        };

        const onProgress = (loaded: number) => {
          progressState.loaded = loaded;
          if (!options.json) {
            writeProgress(renderProgress(progressState, "Uploading"));
          }
        };

        let uploadResult: { id: string };

        // Try WebSocket first, fall back to HTTP chunks
        if (config.fileUploadWs) {
          try {
            uploadResult = await uploadWsTransport(
              server, headers, encryptedStream, encryptedSize,
              config.fileUploadSpeedLimit ?? 0, onProgress,
            );
          } catch {
            if (!options.json) writeLine("WebSocket failed, falling back to HTTP...");
            // Need fresh stream for retry - re-read file
            const retryStream = isMultiFile
              ? (await createZipStream(files)).stream
              : createFileStream(files[0]!);
            const retryEncStream = retryStream.pipeThrough(
              createEncryptStream(creds.keys.fileKey),
            );
            uploadResult = await uploadHttpTransport(
              server, headers, creds.ownerTokenB64, retryEncStream,
              encryptedSize, config.fileUploadConcurrentChunks, onProgress,
            );
          }
        } else {
          uploadResult = await uploadHttpTransport(
            server, headers, creds.ownerTokenB64, encryptedStream,
            encryptedSize, config.fileUploadConcurrentChunks, onProgress,
          );
        }

        if (!options.json) { clearLine(); writeLine("Upload complete."); }

        // Save metadata
        const metadata: FileMetadata = isMultiFile
          ? {
              type: "archive",
              files: files.map((f) => ({
                name: path.basename(f),
                size: fs.statSync(f).size,
              })),
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

        // Build share URL
        const shareUrl = buildShareUrl(server, "file", uploadResult.id, creds.effectiveSecretB64);

        // Save to history
        addUpload({
          id: uploadResult.id,
          server,
          url: shareUrl,
          ownerToken: creds.ownerTokenB64,
          fileNames: files.map((f) => path.basename(f)),
          totalSize: files.reduce((sum, f) => sum + fs.statSync(f).size, 0),
          hasPassword: creds.hasPassword,
          createdAt: new Date().toISOString(),
          expireSec,
        });

        if (options.json) {
          console.log(JSON.stringify({
            id: uploadResult.id,
            url: shareUrl,
            ownerToken: creds.ownerTokenB64,
            size: plaintextSize,
            encryptedSize,
            fileCount,
            expires: expireSec,
            maxDownloads,
            hasPassword: creds.hasPassword,
          }));
        } else {
          writeLine("");
          writeLine(`Share URL: ${shareUrl}`);
          writeLine(`Files: ${fileCount} | Size: ${formatBytes(plaintextSize)} | Expires: ${formatExpiry(expireSec)} | Downloads: ${maxDownloads}`);
          if (creds.hasPassword) writeLine("Password protected: yes");
        }
      } catch (err) {
        if (err instanceof ApiError) {
          if (options.json) {
            console.error(JSON.stringify({ error: err.message, status: err.status }));
          } else {
            console.error(`Error: ${err.message} (HTTP ${err.status})`);
          }
        } else {
          const message = err instanceof Error ? err.message : String(err);
          if (options.json) {
            console.error(JSON.stringify({ error: message }));
          } else {
            console.error(`Error: ${message}`);
          }
        }
        process.exit(1);
      }
    });
}
