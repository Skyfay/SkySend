/**
 * Download Service Worker - zero RAM streaming decryption.
 *
 * Architecture (Chrome 84+, Firefox 128+):
 *   SW intercepts /__skysend_download__/{id}
 *   → derives AES-256-GCM key
 *   → fetches encrypted file
 *   → creates TransformStream
 *   → spawns decrypt-worker.js and transfers encrypted ReadableStream + WritableStream
 *   → returns new Response(readable) to the browser's download manager
 *
 * The Worker runs in its own thread, completely isolated from the SW context.
 * The SW event loop stays lean: key derivation (2 awaits), initial fetch
 * (1 await), and Response construction (sync). All hot-path async work
 * (reader.read, crypto.subtle.decrypt, writer.write) executes in the Worker.
 *
 * Progress is delivered via BroadcastChannel("skysend-dl") - the Worker
 * broadcasts directly without routing through the SW event loop. This also
 * avoids the variable latency of clients.matchAll() when Firefox DevTools is
 * open (DevTools window gets included in results, adding ~2-5 ms per call).
 *
 * Browser support: Chrome 84+, Firefox 128+ (Worker-in-SW context)
 */

// ── ECE Constants (must match @skysend/crypto) ─────────

const RECORD_SIZE = 65536;
const TAG_LENGTH = 16;
const NONCE_LENGTH = 12;
const ENCRYPTED_RECORD_SIZE = RECORD_SIZE + TAG_LENGTH;

// ── Size Calculation ───────────────────────────────────

/**
 * Compute exact plaintext size from encrypted size.
 * Safari needs Content-Length to stream to disk instead of buffering.
 */
function computeDecryptedSize(encryptedSize) {
  if (!encryptedSize || encryptedSize <= NONCE_LENGTH) return 0;
  const payload = encryptedSize - NONCE_LENGTH;
  const fullRecords = Math.floor(payload / ENCRYPTED_RECORD_SIZE);
  const remainder = payload % ENCRYPTED_RECORD_SIZE;
  if (remainder === 0) return fullRecords * RECORD_SIZE;
  return fullRecords * RECORD_SIZE + (remainder - TAG_LENGTH);
}

// ── HKDF Key Derivation ────────────────────────────────

async function deriveFileKey(secret, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw", secret, "HKDF", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: new TextEncoder().encode("skysend-file-encryption"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

// ── Nonce Helper ───────────────────────────────────────

// Needed by the ReadableStream fallback path (see decryptWithReadableStream).
function nonceXorCounter(baseNonce, counter) {
  const nonce = new Uint8Array(baseNonce);
  nonce[8]  ^= (counter >>> 24) & 0xff;
  nonce[9]  ^= (counter >>> 16) & 0xff;
  nonce[10] ^= (counter >>> 8)  & 0xff;
  nonce[11] ^= counter & 0xff;
  return nonce;
}

// ── BroadcastChannel ───────────────────────────────────

// Shared channel for all download progress, completion and error events.
// The Worker posts directly to this channel, bypassing the SW event loop.
const bc = new BroadcastChannel("skysend-dl");

// ── Pending Downloads ──────────────────────────────────

/** @type {Map<string, {url:string, authToken:string, secret:ArrayBuffer, salt:ArrayBuffer, filename:string, mimeType:string, size:number}>} */
const pending = new Map();

// ── SW Lifecycle ───────────────────────────────────────

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "config" && msg.id) {
    pending.set(msg.id, {
      url: msg.url,
      authToken: msg.authToken,
      secret: msg.secret,
      salt: msg.salt,
      filename: msg.filename,
      mimeType: msg.mimeType,
      size: msg.size || 0,
    });
    event.source.postMessage({ type: "config-ok", id: msg.id });
  }
});

// ── Fetch Interception ─────────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const prefix = "/__skysend_download__/";
  if (!url.pathname.startsWith(prefix)) return;

  const id = decodeURIComponent(url.pathname.slice(prefix.length));
  const config = pending.get(id);
  if (!config) return;
  pending.delete(id);

  // Wrap handleDownload so we can track when the stream finishes.
  // respondWith() resolves once the Response object is returned (headers only),
  // but the body stream may still be consumed. waitUntil() keeps the SW alive
  // until the Worker signals completion - critical for Safari which terminates
  // SWs aggressively.
  let streamDone;
  const donePromise = new Promise((resolve) => { streamDone = resolve; });

  event.respondWith(handleDownload(config, id, streamDone));
  event.waitUntil(donePromise);
});

// ── Download Handler ───────────────────────────────────

/**
 * Fetch encrypted file, spawn decrypt-worker.js, return streaming Response.
 *
 * The SW itself only performs a handful of awaits (key derivation + one fetch),
 * then hands off all hot-path async work to the Worker. The Worker writes
 * decrypted plaintext to the writable side of a TransformStream and the SW
 * returns the readable side as the Response body.
 */
async function handleDownload(config, downloadId, streamDone) {
  const { url, authToken, secret, salt, filename, mimeType, size } = config;

  const fileKey = await deriveFileKey(secret, salt);

  // Step 1: Fetch from SkySend API (handles auth + download counting)
  const apiResponse = await fetch(url, {
    headers: { "X-Auth-Token": authToken },
  });

  if (!apiResponse.ok) {
    bc.postMessage({ type: "dl-error", downloadId, error: `HTTP ${apiResponse.status}` });
    streamDone();
    return new Response(`Download failed: ${apiResponse.status}`, { status: 502 });
  }

  // Step 2: Check if the response is a presigned URL (S3 backend) or a direct stream
  let response;
  let totalSize = size;
  const contentType = apiResponse.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    // S3 backend: parse presigned URL and fetch from S3 directly
    const data = await apiResponse.json();
    totalSize = data.size || size;
    response = await fetch(data.url);
    if (!response.ok) {
      bc.postMessage({ type: "dl-error", downloadId, error: `S3 HTTP ${response.status}` });
      streamDone();
      return new Response(`S3 download failed: ${response.status}`, { status: 502 });
    }
  } else {
    // Filesystem backend: use the stream directly
    response = apiResponse;
    totalSize = totalSize || parseInt(response.headers.get("Content-Length") || "0", 10);
  }

  if (!response.body) {
    bc.postMessage({ type: "dl-error", downloadId, error: "empty-response" });
    streamDone();
    return new Response("Empty response body", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": mimeType || "application/octet-stream",
  });

  // Content-Length of the DECRYPTED output. Critical for Safari:
  // without it Safari buffers the entire ReadableStream in RAM
  // instead of streaming to disk.
  //
  // BUT: Firefox hangs SW-streamed downloads when Content-Length >= 2 GiB
  // (internal signed 32-bit integer overflow in the download pipeline).
  // For files at or above that threshold we omit the header - Firefox then
  // falls back to chunked read-until-EOF. Safari is already handled by its
  // own warning + Tier-3 Blob fallback path so it does not hit this branch
  // for huge files anyway.
  const TWO_GIB = 2 * 1024 * 1024 * 1024;
  const decryptedSize = computeDecryptedSize(totalSize);
  if (decryptedSize > 0 && decryptedSize < TWO_GIB) {
    headers.set("Content-Length", String(decryptedSize));
  }

  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encoded);

  // Try Worker path first (Chrome 84+, Firefox once Worker-in-SW is supported).
  // If the constructor throws, the browser does not support Worker-in-SW -
  // fall back to the inline ReadableStream decrypt path which runs on the SW
  // event loop and works on all browsers.
  let worker;
  try {
    worker = new Worker("/decrypt-worker.js");
  } catch {
    return decryptWithReadableStream(
      response, fileKey, totalSize, headers, downloadId, streamDone,
    );
  }

  // TransformStream pipe: Worker writes plaintext → SW returns readable as Response body.
  // Readable: highWaterMark 8 → up to 512 KB pre-decrypted in queue.
  // Writable: highWaterMark 1 → Worker suspends on writer.write() when queue is full.
  const { readable, writable } = new TransformStream(
    undefined,
    new CountQueuingStrategy({ highWaterMark: 1 }),
    new CountQueuingStrategy({ highWaterMark: 8 }),
  );

  // Transfer response.body and writable to the Worker (zero-copy).
  // After postMessage both streams are detached in the SW context -
  // the Worker has exclusive ownership of both.
  worker.postMessage(
    { downloadId, fileKey, body: response.body, output: writable, totalSize },
    [response.body, writable],
  );

  // The Worker signals completion (type "done") or an unrecoverable error
  // (type "error") via self.postMessage(). Either way the SW can release
  // the waitUntil hold and let the Worker be GC-ed.
  worker.addEventListener("message", () => {
    worker.terminate();
    streamDone();
  });

  // onerror fires for uncaught exceptions inside the Worker (distinct from
  // the Worker explicitly sending type "error"). Broadcast an error so the
  // frontend does not wait forever for a dl-done that will never arrive.
  worker.addEventListener("error", () => {
    bc.postMessage({ type: "dl-error", downloadId, error: "worker-crashed" });
    worker.terminate();
    streamDone();
  });

  return new Response(readable, { headers });
}

// ── ReadableStream Fallback ────────────────────────────

/**
 * Fallback ECE decryption path for browsers that do not support Worker-in-SW.
 * Decrypts inline on the SW event loop using a ReadableStream with exactly
 * one record enqueued per pull() call (Firefox backpressure requirement).
 *
 * Uses BroadcastChannel for progress/completion just like the Worker path,
 * so the frontend needs no knowledge of which path was taken.
 */
function decryptWithReadableStream(response, fileKey, totalSize, headers, downloadId, streamDone) {
  const reader = response.body.getReader();

  let baseNonce = null;
  let counter = 0;
  let readerDone = false;
  let loaded = 0;
  let lastProgressTime = 0;
  let cancelled = false;

  let chunks = [];
  let chunkOffset = 0;
  let bufTotal = 0;
  const scratchRecord = new Uint8Array(ENCRYPTED_RECORD_SIZE);

  // Stall watchdog: if no plaintext record is produced for 30 s after the first
  // record, the SW event loop is too saturated to make progress. This happens
  // when Firefox DevTools async-task-tracking overhead is attached to the SW
  // context and persists even after DevTools is closed - the only recovery
  // without this watchdog is a full browser restart.
  //
  // The watchdog is armed only after the first successful enqueue so that
  // a slow network (no data for >30 s at the very start) does not trigger it.
  //
  // When the stall is detected:
  //   1. reader.cancel() releases the buffered encrypted data from memory.
  //   2. dl-error:"stalled" is broadcast so the frontend can show the user
  //      a clear error message with instructions to restart their browser.
  let lastEnqueueTime = 0;
  let watchdogArmed = false;
  let streamCtrl = null;
  let streamFinished = false;

  function finish() {
    if (streamFinished) return;
    streamFinished = true;
    clearInterval(stallTimer);
    streamDone();
  }

  const stallTimer = setInterval(() => {
    if (watchdogArmed && !streamFinished && Date.now() - lastEnqueueTime > 30_000) {
      cancelled = true;
      reader.cancel();
      bc.postMessage({ type: "dl-error", downloadId, error: "stalled" });
      if (streamCtrl) {
        try { streamCtrl.error(new Error("stalled")); } catch { /* already errored */ }
      }
      finish();
    }
  }, 5_000);

  function bufLen() { return bufTotal - chunkOffset; }

  function appendToBuf(data) {
    chunks.push(data);
    bufTotal += data.length;
  }

  function readFromBuf(len, dst) {
    const result = dst !== undefined ? dst : new Uint8Array(len);
    let pos = 0;
    while (pos < len && chunks.length > 0) {
      const chunk = chunks[0];
      const available = chunk.length - chunkOffset;
      const take = Math.min(len - pos, available);
      result.set(chunk.subarray(chunkOffset, chunkOffset + take), pos);
      pos += take;
      chunkOffset += take;
      if (chunkOffset >= chunk.length) {
        bufTotal -= chunk.length;
        chunks.shift();
        chunkOffset = 0;
      }
    }
    return dst !== undefined ? dst.subarray(0, len) : result;
  }

  async function readMore() {
    if (readerDone) return;
    const { done: rdDone, value } = await reader.read();
    if (rdDone) {
      readerDone = true;
    } else {
      loaded += value.byteLength;
      appendToBuf(value);
      const now = Date.now();
      if (now - lastProgressTime > 300 && totalSize > 0) {
        lastProgressTime = now;
        bc.postMessage({
          type: "dl-progress",
          downloadId,
          progress: Math.min(99, Math.round((loaded / totalSize) * 100)),
        });
      }
    }
  }

  const decryptStream = new ReadableStream({
    start(controller) {
      // Capture controller reference so the stall watchdog can error the stream
      // from outside pull() when a timeout fires.
      streamCtrl = controller;
    },

    async pull(controller) {
      if (cancelled) return;

      while (!readerDone && bufLen() <= ENCRYPTED_RECORD_SIZE) {
        await readMore();
        if (cancelled) return;
      }

      if (baseNonce === null) {
        if (bufLen() < NONCE_LENGTH) {
          bc.postMessage({ type: "dl-done", downloadId });
          controller.close();
          finish();
          return;
        }
        baseNonce = readFromBuf(NONCE_LENGTH);
        while (!readerDone && bufLen() <= ENCRYPTED_RECORD_SIZE) {
          await readMore();
          if (cancelled) return;
        }
      }

      if (bufLen() > ENCRYPTED_RECORD_SIZE) {
        const record = readFromBuf(ENCRYPTED_RECORD_SIZE, scratchRecord);
        const nonce = nonceXorCounter(baseNonce, counter++);
        let plain;
        try {
          plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
            fileKey,
            record,
          );
        } catch (e) {
          bc.postMessage({ type: "dl-error", downloadId, error: "decrypt-failed" });
          controller.error(e);
          finish();
          return;
        }
        lastEnqueueTime = Date.now(); // reset stall timer on each successful record
        watchdogArmed = true;
        controller.enqueue(new Uint8Array(plain));
        return;
      }

      if (readerDone && bufLen() > TAG_LENGTH) {
        const remaining = readFromBuf(bufLen(), scratchRecord);
        const nonce = nonceXorCounter(baseNonce, counter++);
        let plain;
        try {
          plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
            fileKey,
            remaining,
          );
        } catch (e) {
          bc.postMessage({ type: "dl-error", downloadId, error: "decrypt-failed" });
          controller.error(e);
          finish();
          return;
        }
        lastEnqueueTime = Date.now();
        watchdogArmed = true;
        controller.enqueue(new Uint8Array(plain));
        bc.postMessage({ type: "dl-progress", downloadId, progress: 100 });
        bc.postMessage({ type: "dl-done", downloadId });
        controller.close();
        finish();
        return;
      }

      if (readerDone) {
        bc.postMessage({ type: "dl-done", downloadId });
        controller.close();
        finish();
      }
    },

    cancel() {
      cancelled = true;
      reader.cancel();
      bc.postMessage({ type: "dl-error", downloadId, error: "cancelled" });
      finish();
    },
  }, { highWaterMark: 8 });

  return new Response(decryptStream, { headers });
}
