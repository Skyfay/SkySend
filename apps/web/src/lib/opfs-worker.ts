/**
 * Web Worker that handles the COMPLETE download pipeline:
 *   fetch() → progress → decrypt → OPFS write
 *
 * NO data ever touches the main thread renderer process.
 * Uses createSyncAccessHandle() for true synchronous disk writes.
 *
 * Protocol:
 *   Main → Worker: { type: "probe" }               → tests OPFS support
 *   Worker → Main: { type: "probe-ok" | "probe-fail" }
 *
 *   Main → Worker: { type: "download", url, authToken, rawKey, tempName }
 *   Worker → Main: { type: "progress", progress: number }
 *   Worker → Main: { type: "done", file: File }
 *   Worker → Main: { type: "error", message: string }
 *
 *   Main → Worker: { type: "cleanup", tempName }
 *   Worker → Main: { type: "cleaned" }
 */

import {
  createDecryptStream,
  deriveKeys,
} from "@skysend/crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let opfsRoot: any = null;

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  try {
    if (msg.type === "probe") {
      // Test the full OPFS + createSyncAccessHandle pipeline
      const root = await navigator.storage.getDirectory();
      const probeName = ".skysend-probe";
      const handle = await root.getFileHandle(probeName, { create: true });
      const syncHandle = await (handle as any).createSyncAccessHandle();
      syncHandle.close();
      await root.removeEntry(probeName).catch(() => {});
      opfsRoot = root;
      self.postMessage({ type: "probe-ok" });
    } else if (msg.type === "download") {
      const { url, authToken, secret, salt, tempName, encryptedSize } = msg;

      // Derive the file key inside the Worker
      const keys = await deriveKeys(
        new Uint8Array(secret),
        new Uint8Array(salt),
      );
      const fileKey = keys.fileKey;

      // Open OPFS for writing
      if (!opfsRoot) {
        opfsRoot = await navigator.storage.getDirectory();
      }
      const fileHandle = await opfsRoot.getFileHandle(tempName, { create: true });
      const syncHandle = await (fileHandle as any).createSyncAccessHandle();

      // Download the encrypted file
      const response = await fetch(url, {
        headers: { "X-Auth-Token": authToken },
      });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      if (!response.body) {
        throw new Error("No response body");
      }

      const totalSize = encryptedSize || parseInt(response.headers.get("Content-Length") || "0", 10);

      // Pipeline: network → progress → decrypt → OPFS write
      let loaded = 0;
      let lastProgressUpdate = 0;

      const progressStream = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            loaded += chunk.byteLength;
            // Throttle progress updates to every 200ms
            const now = Date.now();
            if (now - lastProgressUpdate > 200) {
              lastProgressUpdate = now;
              const progress = totalSize > 0 ? Math.round((loaded / totalSize) * 100) : 0;
              self.postMessage({ type: "progress", progress });
            }
            controller.enqueue(chunk);
          },
        }),
      );

      const decryptedStream = progressStream.pipeThrough(
        createDecryptStream(fileKey),
      );

      // Read decrypted chunks and write directly to disk
      const reader = decryptedStream.getReader();
      let offset = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        syncHandle.write(new Uint8Array(value.buffer as ArrayBuffer), { at: offset });
        offset += value.byteLength;
      }

      syncHandle.flush();
      syncHandle.close();

      // Send final progress
      self.postMessage({ type: "progress", progress: 100 });

      // Get a disk-backed File reference (no RAM copy)
      const file = await fileHandle.getFile();
      self.postMessage({ type: "done", file });
    } else if (msg.type === "cleanup") {
      if (!opfsRoot) {
        opfsRoot = await navigator.storage.getDirectory();
      }
      await opfsRoot.removeEntry(msg.tempName).catch(() => {});
      self.postMessage({ type: "cleaned" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker error";
    self.postMessage({ type: "error", message });
  }
};
