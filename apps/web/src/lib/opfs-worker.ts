/**
 * Web Worker that handles the COMPLETE download pipeline:
 *   fetch() → decrypt → OPFS write
 *
 * NO data ever touches the main thread renderer process.
 * Uses manual read loops (NOT pipeThrough) for explicit backpressure
 * that works in Firefox/Safari (where pipeThrough doesn't propagate
 * backpressure to the fetch response body's network layer).
 *
 * Protocol:
 *   Main → Worker: { type: "download", url, authToken, secret, salt, tempName, encryptedSize }
 *   Worker → Main: { type: "progress", progress: number }
 *   Worker → Main: { type: "done" }
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
    if (msg.type === "download") {
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
        syncHandle.close();
        throw new Error(`Download failed: ${response.status}`);
      }
      if (!response.body) {
        syncHandle.close();
        throw new Error("No response body");
      }

      const totalSize = encryptedSize || parseInt(response.headers.get("Content-Length") || "0", 10);

      // Manual backpressure pipeline:
      // - We read ONE chunk from fetch body
      // - Feed it to the decryptor (await = backpressure)
      // - Read decrypted output and write to OPFS
      // - Only then read the next network chunk
      //
      // This prevents Firefox/Safari from buffering the entire
      // fetch response body in RAM (their pipeThrough doesn't
      // propagate backpressure back to the HTTP layer).

      const decryptTransform = createDecryptStream(fileKey);
      const encWriter = decryptTransform.writable.getWriter();
      const decReader = decryptTransform.readable.getReader();

      let loaded = 0;
      let lastProgressUpdate = 0;
      let offset = 0;

      await Promise.all([
        // Producer: network → decrypt input (explicit backpressure via await)
        (async () => {
          const netReader = response.body!.getReader();
          try {
            for (;;) {
              const { done, value } = await netReader.read();
              if (done) {
                await encWriter.close();
                break;
              }
              loaded += value.byteLength;
              const now = Date.now();
              if (now - lastProgressUpdate > 200) {
                lastProgressUpdate = now;
                const progress = totalSize > 0 ? Math.round((loaded / totalSize) * 100) : 0;
                self.postMessage({ type: "progress", progress });
              }
              // This await is CRITICAL: it waits until the decrypt
              // TransformStream has consumed the chunk, which only
              // happens when the consumer (OPFS writer) has read
              // the decrypted output. This is true backpressure.
              await encWriter.write(value);
            }
          } catch (err) {
            encWriter.abort(err instanceof Error ? err : new Error(String(err))).catch(() => {});
            throw err;
          }
        })(),

        // Consumer: decrypt output → OPFS (drives the pipeline)
        (async () => {
          for (;;) {
            const { done, value } = await decReader.read();
            if (done) break;
            syncHandle.write(new Uint8Array(value.buffer as ArrayBuffer), { at: offset });
            offset += value.byteLength;
          }
        })(),
      ]);

      syncHandle.flush();
      syncHandle.close();

      // Send final progress + done (no File transfer - SW will read from OPFS)
      self.postMessage({ type: "progress", progress: 100 });
      self.postMessage({ type: "done" });
    } else if (msg.type === "cleanup") {
      try {
        if (!opfsRoot) {
          opfsRoot = await navigator.storage.getDirectory();
        }
        await opfsRoot.removeEntry(msg.tempName).catch(() => {});
      } catch { /* ignore */ }
      self.postMessage({ type: "cleaned" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker error";
    self.postMessage({ type: "error", message });
  }
};
