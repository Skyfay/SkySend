# Download Modes

SkySend uses a tiered download strategy to handle large encrypted files (multi-GB) without exhausting browser RAM. The frontend automatically selects the best available mode based on browser capabilities.

## Overview

| Tier | Name | Browsers | RAM Usage | Progress | Speed |
| --- | --- | --- | --- | --- | --- |
| 1 | File System Access | Chrome, Edge | ~0 | Yes | Fast |
| 2a | OPFS Worker + SW | Brave, OPFS-capable | ~0 | Yes | Fast |
| 2b | SW Streaming Decrypt | Firefox, Safari | Low (buffers only) | Yes | Very fast |
| 3 | Blob Fallback | All (last resort) | Full file size | Yes | Moderate |

## Tier 1: File System Access API

**Browsers**: Chrome 86+, Edge 86+

Uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (`showSaveFilePicker`) to stream decrypted data directly to a user-chosen file on disk.

```
Main Thread: fetch() --> decrypt (TransformStream) --> pipeTo(FileSystemWritableFileStream)
```

### How it works

1. Call `showSaveFilePicker()` - user selects save location
2. Open a `FileSystemWritableFileStream` on the selected file
3. Fetch encrypted data from the server
4. Pipe through a progress `TransformStream`
5. Pipe through `createDecryptStream(fileKey)` (ECE AES-256-GCM)
6. Pipe directly to the writable file stream

### Why it works

The entire pipeline is a chain of `TransformStream` stages connected via `pipeThrough()` and `pipeTo()`. Backpressure propagates naturally - the file system write speed controls how fast data is read from the network.

### RAM impact

Near zero. Only the current record (64 KB plaintext + 16 bytes GCM tag) is in memory at any time.

### Key files

- [useDownload.ts](https://github.com/nicokempe/SkySend/blob/main/apps/web/src/hooks/useDownload.ts) - Tier selection logic

---

## Tier 2a: OPFS Worker + Service Worker

**Browsers**: Brave, and any browser where both OPFS (`navigator.storage.getDirectory()`) and Service Workers are available.

Uses a Web Worker to fetch and decrypt into the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (OPFS), then a Service Worker streams the completed file to the browser's native download manager.

```
Web Worker: fetch() --> decrypt --> OPFS (createSyncAccessHandle)
Service Worker: OPFS file.stream() --> Response --> Download Manager
```

### How it works

1. Probe OPFS support on the main thread (`getDirectory()` + `getFileHandle()`)
2. Start a module Web Worker (`opfs-worker.ts`)
3. Worker derives keys via HKDF, fetches encrypted data, decrypts with manual backpressure, writes to OPFS via `createSyncAccessHandle()`
4. Worker signals completion to main thread
5. Main thread sends config to Service Worker (filename, MIME type, OPFS temp name)
6. Main thread navigates to `/__skysend_download__/{id}` - SW intercepts
7. SW opens the OPFS file via `getFile().stream()` and returns it as a streaming `Response`
8. Browser download manager saves to disk

### Manual backpressure in the Worker

Standard `pipeThrough()` does not propagate backpressure to the HTTP network layer in all browsers. The Worker uses a `Promise.all` producer/consumer pattern instead:

```typescript
await Promise.all([
  // Producer: network --> decrypt input
  (async () => {
    for (;;) {
      const { done, value } = await netReader.read();
      if (done) { await encWriter.close(); break; }
      await encWriter.write(value); // BLOCKS until consumer reads
    }
  })(),
  // Consumer: decrypt output --> OPFS
  (async () => {
    for (;;) {
      const { done, value } = await decReader.read();
      if (done) break;
      syncHandle.write(new Uint8Array(value.buffer), { at: offset });
      offset += value.byteLength;
    }
  })(),
]);
```

The `await encWriter.write(value)` is the key - it only resolves once the decrypt `TransformStream` has consumed the chunk, which only happens when the OPFS consumer has read the output. This is true end-to-end backpressure.

### Why not use OPFS directly in Firefox/Safari?

Firefox blocks `navigator.storage.getDirectory()` due to Enhanced Tracking Protection / privacy restrictions. Safari may also block it in certain contexts. The OPFS probe detects this and falls through to Tier 2b.

### RAM impact

Near zero. Data flows: network buffer (browser-managed) -> decrypt buffer (64 KB) -> OPFS disk write. The OPFS file is streamed to the download manager without loading into RAM.

### Key files

- [opfs-worker.ts](https://github.com/nicokempe/SkySend/blob/main/apps/web/src/lib/opfs-worker.ts) - Worker: fetch + decrypt + OPFS write
- [opfs-download.ts](https://github.com/nicokempe/SkySend/blob/main/apps/web/src/lib/opfs-download.ts) - Orchestration: probe, worker lifecycle, SW trigger
- [download-sw.js](https://github.com/nicokempe/SkySend/blob/main/apps/web/public/download-sw.js) - Service Worker

---

## Tier 2b: Service Worker Streaming Decryption

**Browsers**: Firefox, Safari (and any browser where OPFS is unavailable but Service Workers work)

The Service Worker itself performs the entire pipeline: fetch, key derivation, ECE decryption, and streaming the plaintext as a `Response` to the browser's download manager. No Web Workers or OPFS involved.

```
Service Worker (inside respondWith):
  fetch(encrypted) --> HKDF deriveKey --> ECE decrypt --> ReadableStream --> Download Manager
```

### How it works

1. Main thread checks that a Service Worker is controlling the page (`ensureSwController()`)
2. Main thread sends download config to SW via `postMessage`: URL, auth token, raw secret, salt, filename, MIME type, encrypted size
3. Main thread navigates to `/__skysend_download__/{id}`
4. SW intercepts the fetch event, calls `handleDownload()` inside `respondWith()`
5. SW derives the AES-256-GCM file key via HKDF (using `crypto.subtle`)
6. SW fetches the encrypted file from the server
7. SW creates a `ReadableStream` with a `pull()` function that:
   - Reads encrypted data from the fetch response
   - Buffers until a complete ECE record (65,552 bytes) is available
   - Decrypts the record with `crypto.subtle.decrypt()`
   - Enqueues the plaintext chunk
8. SW returns `new Response(decryptStream, { headers })` with `Content-Disposition: attachment`
9. Browser download manager writes to disk natively
10. SW reports progress and completion back to main thread via `clients.matchAll()` + `postMessage()`

### Why this is necessary for Firefox

Firefox does not propagate backpressure from a `ReadableStream` consumer back through `fetch()` when the fetch happens in a Web Worker or on the main thread. The entire HTTP response body gets buffered in RAM regardless of how fast the consumer reads.

However, when `fetch()` happens **inside a Service Worker's `respondWith()`**, it becomes part of the browser's native download pipeline. Firefox manages the network read speed based on how fast the download manager writes to disk. This is the same technique [Mozilla Send](https://github.com/nicokempe/SkySend) used.

### Key design decisions

- **`highWaterMark: 0`** on the `ReadableStream` prevents the stream from buffering ahead. The download manager's `pull()` calls control the pace.
- **All records processed per `pull()`**: When the internal buffer contains multiple complete records, they are all decrypted and enqueued in one `pull()` call. This keeps the buffer small.
- **Offset-based buffer reads**: Instead of `slice()` creating copies on every record, a read offset is tracked and the buffer is compacted only when waste exceeds 512 KB.
- **Inline crypto**: The SW is plain JavaScript (no module imports). ECE constants, `nonceXorCounter()`, and HKDF key derivation are inlined directly because Service Workers cannot import from bundled modules.

### RAM impact

Low but not zero. Firefox uses internal buffers for the HTTP response and the download manager's write pipeline. For a 5.7 GB file, expect approximately 1-3 GB of transient RAM usage that gets reclaimed by GC as the download progresses. With less available RAM, Firefox will slow down the fetch (backpressure kicks in at a lower watermark) - the download simply takes longer but still completes.

### Progress reporting

The SW reports progress to the main thread via `client.postMessage({ type: "dl-progress", progress })` (throttled to every 300ms) and signals completion with `{ type: "dl-done" }`. The main thread listens for these messages and updates the UI.

### Key files

- [download-sw.js](https://github.com/nicokempe/SkySend/blob/main/apps/web/public/download-sw.js) - Service Worker with inline ECE decryption
- [opfs-download.ts](https://github.com/nicokempe/SkySend/blob/main/apps/web/src/lib/opfs-download.ts) - `streamDownloadViaSw()` + `ensureSwController()`

---

## Tier 3: Blob Fallback

**Browsers**: All (last resort when neither File System Access, OPFS, nor Service Workers are available)

Collects all decrypted chunks into a `Blob`, creates an object URL, and triggers a download via an anchor element.

```
Main Thread: fetch() --> decrypt --> collect chunks[] --> new Blob() --> createObjectURL --> <a download>
```

### RAM impact

The entire decrypted file is held in RAM. For large files this will cause the browser to slow down or crash. This tier exists only as a fallback for ancient browsers or restricted environments.

### Key files

- [useDownload.ts](https://github.com/nicokempe/SkySend/blob/main/apps/web/src/hooks/useDownload.ts) - Blob fallback at the bottom of the download function

---

## Tier Selection Logic

The selection happens in `useDownload.ts`:

```typescript
// Tier 1: showSaveFilePicker (Chrome, Edge)
if (typeof window.showSaveFilePicker === "function") {
  // Open file picker, get writable stream
}

// Tier 2a: OPFS probe (Brave, etc.)
const useOpfs = await checkOpfsSupport();
if (useOpfs) {
  // Start OPFS Worker pipeline + SW trigger
}

// Tier 2b: Service Worker stream (Firefox, Safari)
const sw = await ensureSwController();
if (sw) {
  // Send config to SW, navigate to intercepted URL
}

// Tier 3: Blob fallback
// Collect chunks, create Blob, trigger download
```

## Service Worker Registration

The Service Worker (`download-sw.js`) is registered in `main.tsx`:

```typescript
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/download-sw.js").catch(() => {});
}
```

The SW uses `skipWaiting()` and `clients.claim()` to activate immediately. The server must serve `/download-sw.js` with the correct MIME type (`application/javascript`) - a dedicated route exists in the Hono server to prevent the SPA catch-all from serving it as `index.html`.

## Browser Compatibility Matrix

| Feature | Chrome | Edge | Firefox | Safari | Brave |
| --- | --- | --- | --- | --- | --- |
| `showSaveFilePicker` | 86+ | 86+ | No | No | No |
| OPFS (`getDirectory`) | 102+ | 102+ | Blocked (ETP) | Varies | 102+ |
| Service Worker | Yes | Yes | Yes | Yes | Yes |
| `crypto.subtle` in SW | Yes | Yes | Yes | Yes | Yes |
| `ReadableStream` in SW | Yes | Yes | Yes | Yes | Yes |
| Download tier used | 1 | 1 | 2b | 2b | 2a |
