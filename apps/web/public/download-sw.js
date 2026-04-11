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
 * - Process ALL complete records per pull() call (don't leave data in buffer)
 * - Use offset-based buffer reads instead of slice+copy
 * - highWaterMark: 0 prevents ReadableStream from buffering ahead
 * - Report progress and completion back to main thread
 */
async function handleDownload(config, downloadId, streamDone) {
  const { url, authToken, secret, salt, filename, mimeType, size } = config;

  const fileKey = await deriveFileKey(secret, salt);

  const response = await fetch(url, {
    headers: { "X-Auth-Token": authToken },
  });

  if (!response.ok) {
    broadcast({ type: "dl-error", downloadId, error: `HTTP ${response.status}` });
    streamDone();
    return new Response(`Download failed: ${response.status}`, { status: 502 });
  }

  const totalSize = size || parseInt(response.headers.get("Content-Length") || "0", 10);

  const headers = new Headers({
    "Content-Type": mimeType || "application/octet-stream",
  });

  // Content-Length of the DECRYPTED output. Critical for Safari:
  // without it Safari buffers the entire ReadableStream in RAM
  // instead of streaming to disk.
  const decryptedSize = computeDecryptedSize(totalSize);
  if (decryptedSize > 0) {
    headers.set("Content-Length", String(decryptedSize));
  }

  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encoded);

  const reader = response.body.getReader();

  let baseNonce = null;
  let buffer = new Uint8Array(0);
  let bufOffset = 0; // read position in buffer (avoid copying on slice)
  let counter = 0;
  let readerDone = false;
  let loaded = 0;
  let lastProgressTime = 0;

  // Compact buffer: shift unread data to front when waste exceeds 512KB
  function compactBuffer() {
    if (bufOffset > 524288) {
      buffer = buffer.slice(bufOffset);
      bufOffset = 0;
    }
  }

  function bufLen() {
    return buffer.length - bufOffset;
  }

  function readFromBuf(len) {
    const result = buffer.slice(bufOffset, bufOffset + len);
    bufOffset += len;
    compactBuffer();
    return result;
  }

  function appendToBuf(data) {
    if (bufLen() === 0) {
      buffer = data;
      bufOffset = 0;
    } else {
      const remaining = buffer.slice(bufOffset);
      const combined = new Uint8Array(remaining.length + data.length);
      combined.set(remaining, 0);
      combined.set(data, remaining.length);
      buffer = combined;
      bufOffset = 0;
    }
  }

  async function readMore() {
    if (readerDone) return;
    const { done, value } = await reader.read();
    if (done) {
      readerDone = true;
    } else {
      loaded += value.byteLength;
      appendToBuf(value);

      // Report progress (throttled)
      const now = Date.now();
      if (now - lastProgressTime > 300 && totalSize > 0) {
        lastProgressTime = now;
        const pct = Math.min(99, Math.round((loaded / totalSize) * 100));
        broadcast({ type: "dl-progress", downloadId, progress: pct });
      }
    }
  }

  const decryptStream = new ReadableStream({
    async pull(controller) {
      // Ensure buffer has enough data
      while (!readerDone && bufLen() <= ENCRYPTED_RECORD_SIZE) {
        await readMore();
      }

      // Extract nonce header on first call
      if (baseNonce === null) {
        if (bufLen() < NONCE_LENGTH) {
          broadcast({ type: "dl-done", downloadId });
          controller.close();
          streamDone();
          return;
        }
        baseNonce = readFromBuf(NONCE_LENGTH);

        // Read more if needed for first record
        while (!readerDone && bufLen() <= ENCRYPTED_RECORD_SIZE) {
          await readMore();
        }
      }

      // Process ALL complete records in buffer (not just one)
      // This keeps the buffer small instead of accumulating data
      while (bufLen() > ENCRYPTED_RECORD_SIZE) {
        const record = readFromBuf(ENCRYPTED_RECORD_SIZE);
        const nonce = nonceXorCounter(baseNonce, counter++);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
          fileKey,
          record,
        );
        controller.enqueue(new Uint8Array(plain));
      }

      // Final record: stream ended, process remaining data
      if (readerDone && bufLen() > TAG_LENGTH) {
        const remaining = readFromBuf(bufLen());
        const nonce = nonceXorCounter(baseNonce, counter++);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
          fileKey,
          remaining,
        );
        controller.enqueue(new Uint8Array(plain));
        broadcast({ type: "dl-progress", downloadId, progress: 100 });
        broadcast({ type: "dl-done", downloadId });
        controller.close();
        streamDone();
        return;
      }

      if (readerDone && bufLen() <= TAG_LENGTH) {
        broadcast({ type: "dl-done", downloadId });
        controller.close();
        streamDone();
      }
    },

    cancel() {
      reader.cancel();
      broadcast({ type: "dl-error", downloadId, error: "cancelled" });
      streamDone();
    },
  }, { highWaterMark: 0 }); // No internal buffering - pure pull

  return new Response(decryptStream, { headers });
}

/** Broadcast message to ALL window clients (not filtered by clientId).
 *  Navigation requests (iframe, location.href) have empty clientId in most browsers,
 *  so we use downloadId-based filtering on the receiver side instead. */
async function broadcast(msg) {
  try {
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage(msg);
    }
  } catch { /* ignore */ }
}

function appendBuf(a, b) {
  if (a.length === 0) return b;
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}
