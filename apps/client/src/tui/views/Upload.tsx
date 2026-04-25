import React, { useState, useCallback } from "react";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Box, Text, useInput } from "ink";
import {
  createEncryptStream, calculateEncryptedSize, encryptMetadata,
  toBase64url, type FileMetadata, type SingleFileMetadata, type ArchiveMetadata,
} from "@skysend/crypto";
import { Zip, ZipDeflate } from "fflate";
import {
  uploadInit, uploadChunk, uploadFinalize, saveMeta,
} from "../../lib/api.js";
import { prepareUpload } from "../../lib/auth.js";
import { buildShareUrl } from "../../lib/url.js";
import { addUpload } from "../../lib/history.js";
import { formatBytes, formatExpiry, formatSpeed } from "../../lib/progress.js";
import { FileExplorer } from "../components/FileExplorer.js";
import { SelectList, type SelectItem } from "../components/SelectList.js";
import { TextPrompt } from "../components/TextPrompt.js";
import { ProgressBar } from "../components/ProgressBar.js";
import type { AppState } from "../types.js";
import { useAccent } from "../theme.js";
import { QRCodeDisplay } from "../components/QRCodeDisplay.js";
import { uploadWsTransport } from "../../lib/ws-upload.js";
import { getWebSocket } from "../../lib/config.js";

type Phase =
  | "file-select"
  | "expiry"
  | "downloads"
  | "password-ask"
  | "password-input"
  | "confirm"
  | "packing"
  | "uploading"
  | "done"
  | "error";

interface UploadViewProps {
  appState: AppState;
  onBack: () => void;
  onError: (msg: string) => void;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

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
  onProgress?: (packed: number, total: number) => void,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; cleanup: () => void }> {
  const totalBytes = filePaths.reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);
  let packedBytes = 0;

  // Stream ZIP output to a temp file instead of buffering in RAM
  const tmpPath = path.join(os.tmpdir(), `skysend-zip-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  const fd = fs.openSync(tmpPath, "w");

  const zipper = new Zip((_err, chunk) => {
    fs.writeSync(fd, chunk);
  });
  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    const entry = new ZipDeflate(name, { level: 6 });
    zipper.add(entry);
    const nodeStream = fs.createReadStream(filePath);
    for await (const chunk of nodeStream) {
      const data = new Uint8Array(chunk as Buffer);
      entry.push(data);
      packedBytes += data.byteLength;
      onProgress?.(packedBytes, totalBytes);
      // Yield to let React re-render
      await new Promise<void>((r) => setImmediate(r));
    }
    entry.push(new Uint8Array(0), true);
  }
  zipper.end();
  fs.closeSync(fd);

  const size = fs.statSync(tmpPath).size;
  const stream = createFileStream(tmpPath);
  const cleanup = () => { try { fs.unlinkSync(tmpPath); } catch { /* already gone */ } };
  return { stream, size, cleanup };
}

export function UploadView({ appState, onBack }: UploadViewProps): React.ReactElement {
  const accent = useAccent();
  const { server, config } = appState;
  const [phase, setPhase] = useState<Phase>("file-select");
  const [files, setFiles] = useState<string[]>([]);
  const [expireSec, setExpireSec] = useState(config.fileDefaultExpire);
  const [maxDownloads, setMaxDownloads] = useState(config.fileDefaultDownload);
  const [password, setPassword] = useState<string | undefined>();
  const [progress, setProgress] = useState({ percent: 0, speed: "", loaded: 0, total: 0 });
  const [packProgress, setPackProgress] = useState({ percent: 0, packed: 0, total: 0 });
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [transport, setTransport] = useState<"WebSocket" | "HTTP chunked">("HTTP chunked");

  const totalSize = files.reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);

  const doUpload = useCallback(async () => {
    let zipCleanup: (() => void) | undefined;
    try {
      setPhase("uploading");
      setIsFinalizing(false);
      const isMulti = files.length > 1;

      let plaintextStream: ReadableStream<Uint8Array>;
      let plaintextSize: number;
      if (isMulti) {
        setPhase("packing");
        setPackProgress({ percent: 0, packed: 0, total: totalSize });
        const zip = await createZipStream(files, (packed, total) => {
          setPackProgress({
            percent: total > 0 ? (packed / total) * 100 : 0,
            packed, total,
          });
        });
        plaintextStream = zip.stream;
        plaintextSize = zip.size;
        zipCleanup = zip.cleanup;
      } else {
        plaintextSize = fs.statSync(files[0]!).size;
        plaintextStream = createFileStream(files[0]!);
      }

      setPhase("uploading");

      const creds = await prepareUpload(password);
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

      // Upload with progress tracking
      const startTime = Date.now();
      const onProgress = (loaded: number) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? loaded / elapsed : 0;
        setProgress({
          percent: encryptedSize > 0 ? (loaded / encryptedSize) * 100 : 0,
          speed: formatSpeed(speed),
          loaded, total: encryptedSize,
        });
      };

      let uploadId: string;

      const useWs = config.fileUploadWs && getWebSocket(server);
      if (useWs) {
        try {
          setTransport("WebSocket");
          const result = await uploadWsTransport(
            server, headers, encryptedStream, encryptedSize,
            config.fileUploadSpeedLimit ?? 0, onProgress,
            () => setIsFinalizing(true),
          );
          uploadId = result.id;
        } catch {
          // WS failed - recreate stream for HTTP fallback
          setTransport("HTTP chunked");
          let retryCleanup: (() => void) | undefined;
          let retryStream: ReadableStream<Uint8Array>;
          if (isMulti) {
            const retryZip = await createZipStream(files);
            retryStream = retryZip.stream;
            retryCleanup = retryZip.cleanup;
            // Old zip already cleaned up in finally, track new one
            zipCleanup = retryCleanup;
          } else {
            retryStream = createFileStream(files[0]!);
          }
          const retryEncStream = retryStream.pipeThrough(createEncryptStream(creds.keys.fileKey));

          const CHUNK_SIZE = 10 * 1024 * 1024;
          const { id: httpId } = await uploadInit(server, headers);
          const reader = retryEncStream.getReader();
          let loaded = 0;
          let chunkParts: Uint8Array[] = [];
          let chunkSize = 0;
          let chunkIdx = 0;

          const sendChunk = async (data: Uint8Array, index: number) => {
            await uploadChunk(server, httpId, index, data);
            loaded += data.byteLength;
            onProgress(loaded);
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunkParts.push(value);
            chunkSize += value.byteLength;
            if (chunkSize >= CHUNK_SIZE) {
              await sendChunk(concatChunks(chunkParts), chunkIdx++);
              chunkParts = [];
              chunkSize = 0;
            }
          }
          if (chunkSize > 0) {
            await sendChunk(concatChunks(chunkParts), chunkIdx++);
          }

          await uploadFinalize(server, httpId, creds.ownerTokenB64);
          uploadId = httpId;
        }
      } else {
        setTransport("HTTP chunked");
        const CHUNK_SIZE = 10 * 1024 * 1024;
        const { id: httpId } = await uploadInit(server, headers);
        const reader = encryptedStream.getReader();
        let loaded = 0;
        let chunkParts: Uint8Array[] = [];
        let chunkSize = 0;
        let chunkIdx = 0;

        const sendChunk = async (data: Uint8Array, index: number) => {
          await uploadChunk(server, httpId, index, data);
          loaded += data.byteLength;
          onProgress(loaded);
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunkParts.push(value);
          chunkSize += value.byteLength;
          if (chunkSize >= CHUNK_SIZE) {
            await sendChunk(concatChunks(chunkParts), chunkIdx++);
            chunkParts = [];
            chunkSize = 0;
          }
        }
        if (chunkSize > 0) {
          await sendChunk(concatChunks(chunkParts), chunkIdx++);
        }

        await uploadFinalize(server, httpId, creds.ownerTokenB64);
        uploadId = httpId;
      }

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
      const encryptedMeta = toBase64url(encMeta.ciphertext);
      const nonce = toBase64url(encMeta.iv);
      await saveMeta(server, uploadId, creds.ownerTokenB64, encryptedMeta, nonce);

      const url = buildShareUrl(server, "file", uploadId, creds.effectiveSecretB64);
      setShareUrl(url);

      addUpload({
        id: uploadId, server, url,
        ownerToken: creds.ownerTokenB64,
        fileNames: files.map((f) => path.basename(f)),
        totalSize, hasPassword: creds.hasPassword,
        createdAt: new Date().toISOString(), expireSec,
      });

      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      zipCleanup?.();
    }
  }, [files, password, maxDownloads, expireSec, server, totalSize, config.fileUploadSpeedLimit, config.fileUploadWs]);

  // Done / Error view - press any key to go back
  useInput((input, key) => {
    if (phase === "done" && input === "q") {
      setShowQR((v) => !v);
      return;
    }
    if ((phase === "done" || phase === "error") && (key.return || key.escape)) {
      onBack();
    }
  }, { isActive: phase === "done" || phase === "error" });

  // File select
  if (phase === "file-select") {
    return (
      <FileExplorer
        onConfirm={(selected) => {
          setFiles(selected);
          setPhase("expiry");
        }}
        onCancel={onBack}
        maxFiles={config.fileMaxFilesPerUpload}
        maxSize={config.fileMaxSize}
      />
    );
  }

  // Expiry selection
  if (phase === "expiry") {
    const items: Array<SelectItem<number>> = config.fileExpireOptions.map((s) => ({
      label: formatExpiry(s),
      value: s,
    }));
    return (
      <SelectList
        items={items}
        title={`Expiry time (${files.length} file${files.length !== 1 ? "s" : ""}, ${formatBytes(totalSize)})`}
        onSelect={(val) => { setExpireSec(val); setPhase("downloads"); }}
        onCancel={onBack}
      />
    );
  }

  // Download count
  if (phase === "downloads") {
    const items: Array<SelectItem<number>> = config.fileDownloadOptions.map((d) => ({
      label: String(d),
      value: d,
    }));
    return (
      <SelectList
        items={items}
        title="Max downloads"
        onSelect={(val) => { setMaxDownloads(val); setPhase("password-ask"); }}
        onCancel={() => setPhase("expiry")}
      />
    );
  }

  // Password ask
  if (phase === "password-ask") {
    return (
      <SelectList
        items={[
          { label: "No", value: "no" },
          { label: "Yes", value: "yes" },
        ]}
        title="Password protect?"
        onSelect={(val) => {
          if (val === "yes") setPhase("password-input");
          else { setPassword(undefined); setPhase("confirm"); }
        }}
        onCancel={() => setPhase("downloads")}
      />
    );
  }

  // Password input
  if (phase === "password-input") {
    return (
      <TextPrompt
        label="Password"
        mask="*"
        onSubmit={(val) => { setPassword(val); setPhase("confirm"); }}
        onCancel={() => setPhase("password-ask")}
        validate={(val) => val.length > 0 ? true : "Password cannot be empty"}
      />
    );
  }

  // Confirm
  if (phase === "confirm") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Upload summary</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text dimColor>Files:     </Text>{files.length} ({formatBytes(totalSize)})</Text>
          <Text><Text dimColor>Names:     </Text>{files.map((f) => path.basename(f)).join(", ")}</Text>
          <Text><Text dimColor>Expires:   </Text>{formatExpiry(expireSec)}</Text>
          <Text><Text dimColor>Downloads: </Text>{maxDownloads}</Text>
          <Text><Text dimColor>Password:  </Text>{password ? "yes" : "no"}</Text>
        </Box>
        <Box marginTop={1}>
          <SelectList
            items={[
              { label: "Start upload", value: "go" },
              { label: "Cancel", value: "cancel" },
            ]}
            onSelect={(val) => {
              if (val === "go") void doUpload();
              else onBack();
            }}
          />
        </Box>
      </Box>
    );
  }

  // Packing (multi-file ZIP)
  if (phase === "packing") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Packing {files.length} files into archive...</Text>
        </Box>
        <ProgressBar
          percent={packProgress.percent}
          detail={`${formatBytes(packProgress.packed)} / ${formatBytes(packProgress.total)}`}
        />
      </Box>
    );
  }

  // Uploading
  if (phase === "uploading") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>{isFinalizing ? "Finalizing..." : "Uploading..."}</Text>
        </Box>
        <ProgressBar
          percent={progress.percent}
          detail={isFinalizing
            ? "Waiting for server confirmation..."
            : `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}  ${progress.speed}`}
        />
      </Box>
    );
  }

  // Done
  if (phase === "done") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="green">Upload complete!</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text dimColor>Share URL: </Text><Text color={accent}>{shareUrl}</Text></Text>
          <Text><Text dimColor>Files:     </Text>{files.length} ({formatBytes(totalSize)})</Text>
          <Text><Text dimColor>Expires:   </Text>{formatExpiry(expireSec)}</Text>
          <Text><Text dimColor>Downloads: </Text>{maxDownloads}</Text>
          <Text><Text dimColor>Transport: </Text>{transport}</Text>
          {password && <Text><Text dimColor>Password:  </Text>yes</Text>}
        </Box>
        {showQR && (
          <Box marginTop={1}>
            <QRCodeDisplay url={shareUrl} />
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>q QR code  Enter/Esc back</Text>
        </Box>
      </Box>
    );
  }

  // Error
  if (phase === "error") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>Upload failed</Text>
        <Text color="red">{errorMsg}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return <Box />;
}
