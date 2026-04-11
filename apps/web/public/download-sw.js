/**
 * Lightweight Service Worker that streams files from OPFS to the browser's
 * native download manager. No module imports - works in all browsers.
 *
 * Flow:
 *   1. Main thread sends { type: "config", id, tempName, filename, mimeType }
 *   2. Main thread navigates to /__skysend_download__/{id}
 *   3. SW intercepts, reads from OPFS via file.stream(), browser saves to disk
 *   4. Zero RAM - data flows in chunks from OPFS to download manager
 */

/** @type {Map<string, { tempName: string, filename: string, mimeType: string }>} */
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
      tempName: msg.tempName,
      filename: msg.filename,
      mimeType: msg.mimeType,
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

  event.respondWith(
    (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(config.tempName);
        const file = await handle.getFile();

        const headers = new Headers({
          "Content-Type": config.mimeType || "application/octet-stream",
          "Content-Length": String(file.size),
        });

        // RFC 6266 Content-Disposition with UTF-8 filename
        const encoded = encodeURIComponent(config.filename).replace(
          /[!'()*]/g,
          (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
        );
        headers.set(
          "Content-Disposition",
          "attachment; filename*=UTF-8''" + encoded,
        );

        // Stream from OPFS - browser download manager writes to disk
        return new Response(file.stream(), { headers });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    })(),
  );
});
