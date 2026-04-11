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

  event.respondWith(handleDownload(config));
});

/**
 * Fetch encrypted file, decrypt with ECE, return streaming Response.
 * Everything inside respondWith() - Firefox propagates backpressure here.
 */
async function handleDownload(config) {
  const { url, authToken, secret, salt, filename, mimeType } = config;

  // Derive file key (HKDF)
  const fileKey = await deriveFileKey(secret, salt);

  // Fetch encrypted data from server
  const response = await fetch(url, {
    headers: { "X-Auth-Token": authToken },
  });

  if (!response.ok) {
    return new Response(`Download failed: ${response.status}`, { status: 502 });
  }

  // Build response headers
  const headers = new Headers({
    "Content-Type": mimeType || "application/octet-stream",
  });
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encoded);

  // Create a streaming decrypt pipeline via ReadableStream.
  // This is pull-based: the browser download manager controls the pace.
  const reader = response.body.getReader();

  let baseNonce = null;
  let buffer = new Uint8Array(0);
  let counter = 0;
  let readerDone = false;

  const decryptStream = new ReadableStream({
    async pull(controller) {
      // Fill buffer until we have a complete record or stream ends
      while (!readerDone && (baseNonce === null ? buffer.length < NONCE_LENGTH : buffer.length <= ENCRYPTED_RECORD_SIZE)) {
        const { done, value } = await reader.read();
        if (done) {
          readerDone = true;
          break;
        }
        buffer = appendBuf(buffer, value);
      }

      // Phase 1: Extract nonce header
      if (baseNonce === null) {
        if (buffer.length < NONCE_LENGTH) {
          controller.close();
          return;
        }
        baseNonce = buffer.slice(0, NONCE_LENGTH);
        buffer = buffer.slice(NONCE_LENGTH);

        // May need more data for first record
        if (!readerDone && buffer.length <= ENCRYPTED_RECORD_SIZE) {
          const { done, value } = await reader.read();
          if (done) {
            readerDone = true;
          } else {
            buffer = appendBuf(buffer, value);
          }
        }
      }

      // Phase 2: Process complete records
      // Keep processing while we have more than one full record in buffer
      // (we only process when we know more data follows, to handle final record correctly)
      while (buffer.length > ENCRYPTED_RECORD_SIZE) {
        const record = buffer.slice(0, ENCRYPTED_RECORD_SIZE);
        buffer = buffer.slice(ENCRYPTED_RECORD_SIZE);

        const nonce = nonceXorCounter(baseNonce, counter++);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
          fileKey,
          record,
        );
        controller.enqueue(new Uint8Array(plain));
        return; // Let pull() be called again - gives backpressure
      }

      // Final record: stream is done and buffer has remaining data
      if (readerDone && buffer.length > TAG_LENGTH) {
        const nonce = nonceXorCounter(baseNonce, counter++);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
          fileKey,
          buffer,
        );
        buffer = new Uint8Array(0);
        controller.enqueue(new Uint8Array(plain));
        controller.close();
        return;
      }

      // Stream ended with no remaining data
      if (readerDone) {
        controller.close();
      }
    },

    cancel() {
      reader.cancel();
    },
  });

  return new Response(decryptStream, { headers });
}

function appendBuf(a, b) {
  if (a.length === 0) return b;
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}
