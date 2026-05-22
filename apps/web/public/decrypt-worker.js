/**
 * Decrypt Worker - ECE (AES-256-GCM) decryption off the SW event loop.
 *
 * Spawned by download-sw.js for each file download. Runs in a dedicated
 * Worker thread, completely isolated from the SW context.
 *
 * This removes a Firefox DevTools overhead: when DevTools is open, the
 * browser attaches async-task-tracking to the SW context and generates a
 * DevTools IPC roundtrip for every await. The hot path (reader.read +
 * crypto.subtle.decrypt + writer.write per record) previously ran in the
 * SW context, causing ~3 000 DevTools roundtrips per second at full speed.
 * Moving the entire decrypt loop here eliminates that overhead entirely.
 *
 * Receives via postMessage (streams transferred, key structured-cloned):
 *   downloadId  {string}         - unique download ID
 *   fileKey     {CryptoKey}      - AES-256-GCM key (structured-cloned)
 *   body        {ReadableStream} - encrypted data (transferred from SW)
 *   output      {WritableStream} - plaintext sink (transferred from SW)
 *   totalSize   {number}         - encrypted byte count (for progress %)
 *
 * Progress reported via BroadcastChannel("skysend-dl").
 * Completion signalled to SW via self.postMessage({ type: "done" | "error" }).
 *
 * Browser support: Chrome 84+, Firefox 128+
 */

// ── ECE Constants (must match @skysend/crypto) ─────────

const RECORD_SIZE = 65536;
const TAG_LENGTH = 16;
const NONCE_LENGTH = 12;
const ENCRYPTED_RECORD_SIZE = RECORD_SIZE + TAG_LENGTH;

// ── Nonce Helper ───────────────────────────────────────

function nonceXorCounter(baseNonce, counter) {
  const nonce = new Uint8Array(baseNonce);
  nonce[8]  ^= (counter >>> 24) & 0xff;
  nonce[9]  ^= (counter >>> 16) & 0xff;
  nonce[10] ^= (counter >>> 8)  & 0xff;
  nonce[11] ^= counter & 0xff;
  return nonce;
}

// ── Progress Channel ───────────────────────────────────

const bc = new BroadcastChannel("skysend-dl");

// ── Main ───────────────────────────────────────────────

self.onmessage = async ({ data: { downloadId, fileKey, body, output, totalSize } }) => {
  const reader = body.getReader();
  const writer = output.getWriter();

  // Zero-copy chunk queue (same pattern as the original download-sw.js).
  // Incoming network chunks are referenced by the queue, not copied.
  // readFromBuf copies only the bytes needed for the current operation.
  let chunks = [];
  let chunkOffset = 0;
  let bufTotal = 0;

  let readerDone = false;
  let loaded = 0;
  let lastProgressTime = 0;

  // Pre-allocated scratch buffer for ECE record decryption.
  // crypto.subtle.decrypt copies its input synchronously on dispatch, making
  // this buffer safe to reuse immediately after each await.
  const scratchRecord = new Uint8Array(ENCRYPTED_RECORD_SIZE);

  function bufLen() {
    return bufTotal - chunkOffset;
  }

  function appendToBuf(data) {
    chunks.push(data);
    bufTotal += data.length;
  }

  // When dst is provided the bytes are written into dst and a correctly-sized
  // subarray view is returned (no allocation). Used for record decryption to
  // avoid allocating a fresh 65 KB buffer on every decrypt call.
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
    const { done, value } = await reader.read();
    if (done) {
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

  try {
    // Read the ECE nonce (first 12 bytes of the stream)
    while (!readerDone && bufLen() < NONCE_LENGTH) {
      await readMore();
    }

    if (bufLen() < NONCE_LENGTH) {
      // Empty or truncated stream - nothing to decrypt
      bc.postMessage({ type: "dl-done", downloadId });
      await writer.close();
      self.postMessage({ type: "done" });
      self.close();
      return;
    }

    const baseNonce = readFromBuf(NONCE_LENGTH);
    let counter = 0;

    // Main decrypt loop
    while (true) {
      // Fill the buffer to at least one full encrypted record.
      // This loop is required: without it the outer loop would spin
      // on an empty buffer until network data arrives.
      while (!readerDone && bufLen() <= ENCRYPTED_RECORD_SIZE) {
        await readMore();
      }

      if (bufLen() > ENCRYPTED_RECORD_SIZE) {
        // Full ECE record available
        const record = readFromBuf(ENCRYPTED_RECORD_SIZE, scratchRecord);
        const nonce = nonceXorCounter(baseNonce, counter++);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
          fileKey,
          record,
        );
        // writer.write() provides backpressure: suspends here when the
        // readable side's queue (highWaterMark: 8) is full, preventing
        // unbounded memory growth on fast networks.
        await writer.write(new Uint8Array(plain));
      } else if (readerDone && bufLen() > TAG_LENGTH) {
        // Final (partial) ECE record
        const remaining = readFromBuf(bufLen(), scratchRecord);
        const nonce = nonceXorCounter(baseNonce, counter++);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
          fileKey,
          remaining,
        );
        await writer.write(new Uint8Array(plain));
        break;
      } else {
        // Stream ended with no decodable data remaining
        break;
      }
    }

    bc.postMessage({ type: "dl-progress", downloadId, progress: 100 });
    bc.postMessage({ type: "dl-done", downloadId });
    await writer.close();
    self.postMessage({ type: "done" });
  } catch (e) {
    console.error("[decrypt-worker] Error:", e);
    bc.postMessage({ type: "dl-error", downloadId, error: "decrypt-failed" });
    try { await writer.abort(e); } catch { /* ignore */ }
    self.postMessage({ type: "error", error: String(e) });
  }

  self.close();
};
