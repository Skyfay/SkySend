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

  // TransformStream acts as a pipe: Worker writes plaintext to the writable
  // side, browser download manager reads plaintext from the readable side.
  //
  // Readable side: highWaterMark 8 → up to 512 KB pre-decrypted records in
  // the queue, absorbing Worker scheduling jitter without stalling the
  // download manager on slow or jittery connections.
  //
  // Writable side: highWaterMark 1 → Worker's await writer.write() suspends
  // when the readable queue is full, preventing unbounded memory growth.
  const { readable, writable } = new TransformStream(
    undefined,
    new CountQueuingStrategy({ highWaterMark: 1 }),
    new CountQueuingStrategy({ highWaterMark: 8 }),
  );

  // Spawn Worker. If Worker-in-SW is not supported (Firefox < 128, very old
  // Chrome) the constructor throws and we surface a dl-error so the frontend
  // can fall back to the OPFS or Blob download tier.
  let worker;
  try {
    worker = new Worker("/decrypt-worker.js");
  } catch {
    bc.postMessage({ type: "dl-error", downloadId, error: "worker-unavailable" });
    streamDone();
    return new Response("Worker not available", { status: 500 });
  }

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
