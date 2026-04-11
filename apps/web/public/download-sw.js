/**
 * Service Worker for streaming downloads - zero RAM in ALL browsers.
 *
 * Two modes:
 *   1. OPFS mode (config has tempName): reads completed file from OPFS via file.stream()
 *   2. Stream mode (config has port): pulls decrypted chunks from Worker via MessagePort
 *
 * Stream mode is the key for Firefox/Safari where OPFS may be blocked.
 * Like Mozilla Send: Worker decrypts -> MessagePort -> SW ReadableStream -> download manager -> disk.
 * Backpressure: pull() only requests next chunk when browser is ready for more.
 */

/** @type {Map<string, {filename:string, mimeType:string, tempName?:string|null, port?:MessagePort|null}>} */
const pending = new Map();

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
      filename: msg.filename,
      mimeType: msg.mimeType,
      tempName: msg.tempName || null,
      port: msg.port || null,
    });
    // ACK so main thread knows config is stored
    event.source.postMessage({ type: "config-ok", id: msg.id });
  }
});

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
 * @param {{filename:string, mimeType:string, tempName?:string|null, port?:MessagePort|null}} config
 */
async function handleDownload(config) {
  const { filename, mimeType, tempName, port } = config;

  const headers = new Headers({
    "Content-Type": mimeType || "application/octet-stream",
  });

  // RFC 6266 Content-Disposition with UTF-8 filename
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  headers.set(
    "Content-Disposition",
    "attachment; filename*=UTF-8''" + encoded,
  );

  try {
    if (port) {
      // Stream mode: pull decrypted chunks from Worker via MessagePort.
      // Each pull() sends a "pull" request and waits for the chunk.
      // This gives natural backpressure - the browser download manager
      // controls the read speed, and we only ask for more when ready.
      const stream = new ReadableStream({
        pull(controller) {
          return new Promise((resolve, reject) => {
            port.onmessage = (e) => {
              const data = e.data;
              if (data && data.done) {
                controller.close();
                port.close();
                resolve();
              } else if (data && data.error) {
                const err = new Error(data.error);
                controller.error(err);
                port.close();
                reject(err);
              } else {
                // data is a transferred ArrayBuffer from the Worker
                controller.enqueue(new Uint8Array(data));
                resolve();
              }
            };
            port.postMessage({ type: "pull" });
          });
        },
        cancel() {
          port.postMessage({ type: "cancel" });
          port.close();
        },
      });

      return new Response(stream, { headers });
    }

    // OPFS mode: stream completed file from disk
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(tempName);
    const file = await handle.getFile();
    headers.set("Content-Length", String(file.size));
    return new Response(file.stream(), { headers });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
