# Download Modes

SkySend uses a tiered download strategy to handle large encrypted files (multi-GB) without exhausting browser RAM. The frontend automatically selects the best available mode based on browser capabilities.

## Overview

| Tier | Name | Browsers | RAM Usage | Progress | Speed |
| --- | --- | --- | --- | --- | --- |
| 1 | SW Streaming Decrypt | All modern browsers except Safari | Low (buffers only) | Yes | Very fast (~270 MB/s) |
| 2 | File System Access | Chrome, Edge (fallback) | ~0 | Yes | Fast (~110 MB/s) |
| 3 | Blob Fallback | All (last resort) / Safari default | Full file size | Yes | Moderate |

Tier 1 (SW stream) is attempted first because it is the fastest method. It runs decryption in the Service Worker thread, keeping the main thread free and achieving higher throughput than main-thread decryption. Safari is excluded from Tier 1 because it terminates Service Workers aggressively and buffers `ReadableStream` responses in RAM instead of streaming to disk - making it no better than Tier 3. On Safari, the download falls through directly to Tier 3 (Blob). For files larger than 256 MB on Safari a warning is shown before starting the download. If the Service Worker is not available on other browsers, Tier 2 (`showSaveFilePicker`) is used as a fallback in Chrome/Edge. Tier 3 (Blob) is the last resort.

## Tier 1: Service Worker Streaming Decryption

**Browsers**: All modern browsers except Safari (Chrome, Edge, Firefox, Brave)

The primary download method. The Service Worker performs the entire pipeline: fetch, HKDF key derivation, ECE decryption, and streaming the plaintext as a `Response` to the browser's download manager. This is the fastest method because decryption runs on the SW thread (not the main thread).

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

## Tier 2: File System Access API (Fallback)

**Browsers**: Chrome 86+, Edge 86+ (only used if SW stream fails)

Uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (`showSaveFilePicker`) to stream decrypted data directly to a user-chosen file on disk. This was the original primary method but is now a fallback because SW stream is faster.

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

**Browsers**: All (last resort when neither File System Access nor Service Workers are available) / Safari default

This is the default download path for Safari. Safari terminates Service Workers aggressively and buffers `ReadableStream` responses in RAM instead of streaming to disk, so SW streaming (Tier 1) is skipped entirely. For files larger than 256 MB a warning is displayed before the download begins.

On non-Safari browsers this tier is only reached when both Tier 1 and Tier 2 are unavailable.

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
const safari = isSafari();

// Tier 1: SW stream (all browsers except Safari)
const sw = !safari ? await ensureSwController() : null;
if (sw) {
  // Send config to SW, navigate to intercepted URL, wait for completion
}

// Tier 2: showSaveFilePicker fallback (Chrome, Edge)
if (!downloaded && typeof window.showSaveFilePicker === "function") {
  // Open file picker, stream decrypt to file
}

// Tier 3: Blob fallback (last resort / Safari default)
if (!downloaded) {
  // Collect chunks, create Blob, trigger download
}
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
| Download tier used | 1 (SW) | 1 (SW) | 1 (SW) | 3 (Blob) | 1 (SW) |
