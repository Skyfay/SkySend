/**
 * Download Service Worker - zero RAM streaming decryption.
 *
 * Like Mozilla Send: ALL work happens inside respondWith().
 * The SW fetches the encrypted file, decrypts it with ECE (AES-256-GCM),
 * and returns a streaming Response to the browser's download manager.
 *
 * This is the ONLY approach that gives true backpressure in Firefox:
 * fetch() inside respondWith() is part of the browser's download pipeline,
 * so Firefox naturally controls the read rate and doesn't buffer everything.
 *
 * crypto.subtle is fully available in Service Workers.
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

// ── Crypto Helpers ─────────────────────────────────────

function nonceXorCounter(baseNonce, counter) {
  const nonce = new Uint8Array(baseNonce);
  nonce[8] ^= (counter >>> 24) & 0xff;
  nonce[9] ^= (counter >>> 16) & 0xff;
  nonce[10] ^= (counter >>> 8) & 0xff;
  nonce[11] ^= counter & 0xff;
  return nonce;
}

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

// ── Pending Downloads ──────────────────────────────────

/** @type {Map<string, {url:string, authToken:string, secret:ArrayBuffer, salt:ArrayBuffer, filename:string, mimeType:string, size:number}>} */
const pending = new Map();
/** @type {Map<string, () => void>} Maps downloadId to a cancel function that aborts the in-progress download. */
const pendingCancels = new Map();
const bc = new BroadcastChannel("skysend-download");

// ── SW Lifecycle ───────────────────────────────────────

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

bc.onmessage = (event) => {
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
    bc.postMessage({ type: "config-ok", id: msg.id });
  }
  if (msg.type === "cancel" && msg.id) {
    pendingCancels.get(msg.id)?.();
  }
};

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
  // until the stream is fully read - critical for Safari which terminates SWs aggressively.
  let streamDone;
  const donePromise = new Promise((resolve) => { streamDone = resolve; });

  event.respondWith(handleDownload(config, id, streamDone));
  event.waitUntil(donePromise);
});

/**
 * Fetch encrypted file, decrypt with ECE, return streaming Response.
 * Everything inside respondWith() - Firefox propagates backpressure here.
 *
 * Optimizations for low RAM:
 * - Process exactly ONE record per pull() call (highWaterMark: 2 manages pipelining)
 * - Zero-copy chunk queue: incoming network chunks are referenced, not copied
 * - Pre-allocated scratchRecord reused for all decrypt input copies
 * - Report progress and completion back to main thread
 */
async function handleDownload(config, downloadId, streamDone) {
  const { url, authToken, secret, salt, filename, mimeType, size } = config;
  const cleanup = () => {
    pendingCancels.delete(downloadId);
    streamDone();
  };

  const fileKey = await deriveFileKey(secret, salt);

  // Step 1: Fetch from SkySend API (handles auth + download counting)
  const apiResponse = await fetch(url, {
    headers: { "X-Auth-Token": authToken },
  });

  if (!apiResponse.ok) {
    bc.postMessage({ type: "dl-error", downloadId, error: `HTTP ${apiResponse.status}` });
    cleanup();
    // Use Content-Disposition: attachment so the browser treats this as a failed download
    // rather than navigating the main page away (critical for the <a>-navigation SW approach).
    return new Response(null, { status: 200, headers: { "Content-Disposition": "attachment", "Content-Length": "0" } });
  }

  // Step 2: Check if the response is a presigned URL (S3 backend) or a direct stream
  let response;
  let totalSize = size;
  const contentType = apiResponse.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    // S3 backend: parse presigned URL and fetch from S3 directly
    const data = await apiResponse.json();
    totalSize = data.size || size;
    // Notify main thread that the S3 backend is active
    bc.postMessage({ type: "dl-s3", downloadId });
    try {
      response = await fetch(data.url);
    } catch (fetchErr) {
      // CORS or network error reaching the S3/R2 bucket.
      // This typically means CORS is not configured on the bucket - the bucket must allow
      // GET requests from the SkySend origin.
      console.warn(`[SW-dl:${downloadId}] S3 fetch failed (CORS or network):`, fetchErr.message);
      bc.postMessage({ type: "dl-error", downloadId, error: "S3 unreachable - make sure CORS is configured on your S3/R2 bucket" });
      cleanup();
      return new Response(null, { status: 200, headers: { "Content-Disposition": "attachment", "Content-Length": "0" } });
    }
    if (!response.ok) {
      bc.postMessage({ type: "dl-error", downloadId, error: `S3 HTTP ${response.status}` });
      cleanup();
      return new Response(null, { status: 200, headers: { "Content-Disposition": "attachment", "Content-Length": "0" } });
    }
  } else {
    // Filesystem backend: use the stream directly
    response = apiResponse;
    totalSize = totalSize || parseInt(response.headers.get("Content-Length") || "0", 10);
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

  // Inform main thread which decryption path was chosen.
  // Currently always "stream" (ReadableStream inside respondWith).
  bc.postMessage({ type: "dl-tier", downloadId, swPath: "stream" });

  const reader = response.body.getReader();
  console.debug(`[SW-dl:${downloadId}] stream start: totalSize=${totalSize}B decryptedSize=${decryptedSize}B`);

  let baseNonce = null;
  let counter = 0;
  let readerDone = false;
  let loaded = 0;
  let lastProgressTime = 0;
  let lastCheckpointTime = Date.now();
  let cancelled = false;
  // Guard so cancelStream() / controller.error() is only called once.
  let streamErrored = false;

  // Called from both the user-cancel path (via pendingCancels) and from pull()
  // when it detects cancelled=true. The guard prevents double controller.error().
  function cancelStream(controller) {
    if (streamErrored) return;
    streamErrored = true;
    reader.cancel().catch(() => {});
    console.warn(`[SW-dl:${downloadId}] stream cancelled by user`);
    controller.error(new DOMException("user-cancelled", "AbortError"));
    bc.postMessage({ type: "dl-cancelled", downloadId });
    cleanup();
  }

  // Register an external cancel function so bc.onmessage can abort this download.
  // Sets cancelled=true and cancels the reader so the pending reader.read() inside
  // readMore() resolves immediately with {done:true}, allowing pull() to detect
  // cancelled and call cancelStream(controller) with the controller reference.
  pendingCancels.set(downloadId, () => {
    cancelled = true;
    reader.cancel().catch(() => {});
  });

  // Chunk queue: incoming network chunks are held by reference with zero copy.
  // readFromBuf allocates only the bytes needed for the current operation
  // (one record at a time), cutting GC pressure to roughly the plaintext size.
  let chunks = [];    // queue of Uint8Array chunks from reader.read()
  let chunkOffset = 0; // read position within chunks[0]
  let bufTotal = 0;    // sum of all chunk lengths (O(1) bufLen)

  function bufLen() {
    return bufTotal - chunkOffset;
  }

  // Pre-allocated scratch buffer for ECE record decryption.
  // crypto.subtle.decrypt copies its input synchronously on dispatch, so this
  // buffer is safe to reuse: pull() awaits decrypt before returning, and pull()
  // is only called again after the previous call returns.
  const scratchRecord = new Uint8Array(ENCRYPTED_RECORD_SIZE);

  // When dst is provided the bytes are written into dst and a correctly-sized
  // subarray view is returned (no allocation). Used for record decryption to
  // avoid allocating a fresh 65 KB buffer on every pull() call.
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

  function appendToBuf(data) {
    chunks.push(data);
    bufTotal += data.length;
  }

  async function readMore() {
    if (readerDone) return;
    const readStart = Date.now();
    const { done, value } = await reader.read();
    const readMs = Date.now() - readStart;
    if (done) {
      readerDone = true;
    } else {
      loaded += value.byteLength;
      appendToBuf(value);
      // Log reads that take unusually long - indicates network jitter or
      // connection stalls independent of the double-readMore drift pattern.
      if (readMs > 1000) {
        console.debug(`[SW-dl:${downloadId}] slow-read +${value.byteLength}B readMs=${readMs} loaded=${loaded}B`);
      }

      // Report progress (throttled)
      const now = Date.now();
      if (now - lastProgressTime > 300 && totalSize > 0) {
        lastProgressTime = now;
        const pct = Math.min(99, Math.round((loaded / totalSize) * 100));
        bc.postMessage({ type: "dl-progress", downloadId, progress: pct });
      }
    }
  }

  const decryptStream = new ReadableStream({
    async pull(controller) {
      if (cancelled) { cancelStream(controller); return; }
      // Ensure the buffer has enough data for one full encrypted record before
      // attempting to decrypt. The while-loop is required: without it pull()
      // would return without enqueuing, causing the stream to call pull() again
      // immediately in a tight CPU-spinning loop until network data arrives.
      // The loop must run until bufLen > ENCRYPTED_RECORD_SIZE so that the
      // record-processing branch below can always enqueue without returning empty.
      let readMoreCalls = 0;
      while (!readerDone && bufLen() <= ENCRYPTED_RECORD_SIZE) {
        await readMore();
        readMoreCalls++;
        if (cancelled) { cancelStream(controller); return; }
      }
      // Double-readMore: ECE records (65552 B) and network chunks (65536 B) differ
      // by 16 B, so the ciphertext buffer drifts down by 16 B per record. Every
      // ~4096 records the buffer falls below ENCRYPTED_RECORD_SIZE after one read,
      // requiring a second sequential read before decryption can proceed.
      if (readMoreCalls > 1) {
        console.debug(`[SW-dl:${downloadId}] double-readMore: record=${counter} calls=${readMoreCalls} bufLen=${bufLen()}B loaded=${loaded}B`);
      }

      // Extract nonce header on first call
      if (baseNonce === null) {
        if (bufLen() < NONCE_LENGTH) {
          bc.postMessage({ type: "dl-done", downloadId });
          controller.close();
          cleanup();
          return;
        }
        baseNonce = readFromBuf(NONCE_LENGTH);

        // Read more if needed for first record
        while (!readerDone && bufLen() <= ENCRYPTED_RECORD_SIZE) {
          await readMore();
          if (cancelled) { cancelStream(controller); return; }
        }
      }

      // Process exactly ONE complete record per pull() call, then return.
      //
      // Previously this was a while-loop that processed ALL buffered records in
      // a single pull() call. That violated the pull-based contract of
      // highWaterMark: 0 (= one chunk per pull). Firefox v128+ enforces this
      // more strictly: if pull() enqueues multiple chunks at once, the
      // ReadableStream controller loses its backpressure state and stops
      // calling pull() mid-download, stalling the transfer at a random
      // percentage. The stall point varies with network chunk size (larger
      // chunks = more records buffered = higher chance of triggering the bug),
      // which is why it only manifests on native hardware with fast connections
      // and not in VMs or on older Firefox ESR.
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
          console.error(`[SW-dl:${downloadId}] decrypt error on record #${counter - 1}:`, e);
          bc.postMessage({ type: "dl-error", downloadId, error: "decrypt-failed" });
          controller.error(e);
          cleanup();
          return;
        }
        controller.enqueue(new Uint8Array(plain));
        // Periodic checkpoint: ~40 logs per 2.5 GiB download instead of ~150 K.
        // Shows elapsed time since last checkpoint so a freeze shows as an
        // abnormally large gap (e.g. 120 000 ms instead of the usual ~500 ms).
        if (counter % 1000 === 0) {
          const now = Date.now();
          const elapsed = now - lastCheckpointTime;
          lastCheckpointTime = now;
          console.debug(`[SW-dl:${downloadId}] checkpoint record=${counter} loaded=${loaded}B elapsed=${elapsed}ms`);
        }
        return; // Firefox calls pull() again for the next record
      }

      // Final record: stream ended, process remaining data
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
          console.error(`[SW-dl:${downloadId}] decrypt error on final record:`, e);
          bc.postMessage({ type: "dl-error", downloadId, error: "decrypt-failed" });
          controller.error(e);
          cleanup();
          return;
        }
        controller.enqueue(new Uint8Array(plain));
        console.debug(`[SW-dl:${downloadId}] stream complete: ${counter} records total`);
        bc.postMessage({ type: "dl-progress", downloadId, progress: 100 });
        bc.postMessage({ type: "dl-done", downloadId });
        controller.close();
        cleanup();
        return;
      }

      if (readerDone && bufLen() <= TAG_LENGTH) {
        bc.postMessage({ type: "dl-done", downloadId });
        controller.close();
        cleanup();
      }
    },

    cancel() {
      cancelled = true;
      console.warn(`[SW-dl:${downloadId}] stream cancelled by consumer`);
      reader.cancel();
      bc.postMessage({ type: "dl-error", downloadId, error: "cancelled" });
      cleanup();
    },
  // highWaterMark: 8 keeps up to 8 pre-decrypted records (~512 KB plaintext)
  // in the stream's internal queue. Firefox's download manager reads from this
  // queue instantly without waiting for pull() to complete. The larger queue
  // (vs the previous value of 2) absorbs occasional double-readMore() stalls:
  // because ECE records are 65552 B but network chunks are 65536 B, the
  // ciphertext buffer drifts down by 16 B per record and roughly every
  // 4096 records one pull() call must perform two sequential reader.read()s
  // before it can enqueue. On slow or jittery connections that ~2x-chunk-time
  // stall could exhaust a 2-record queue and freeze Firefox's UI for several
  // seconds. 8 records provides enough slack down to ~5 Mbps connections.
  // pull() still enqueues exactly ONE record per call, so Firefox's backpressure
  // tracking remains correct and the stall-at-random-percentage bug from v2.9.2
  // (caused by multiple enqueues per pull()) cannot recur.
  }, { highWaterMark: 8 });

  return new Response(decryptStream, { headers });
}


