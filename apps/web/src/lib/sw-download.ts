/**
 * Tier 1 of the download: the Service Worker in public/download-sw.js fetches the ciphertext,
 * decrypts it inside respondWith() and streams it to the browser's download manager, so the
 * file never sits in memory. This module registers that worker and drives one download.
 */

const downloadBc = new BroadcastChannel("skysend-download");

/**
 * Where the download Service Worker works: the URLs tier 1 navigates to, and nothing else.
 * Registered for the whole origin, it saw every request of every page, uploads among them,
 * and Chromium keeps the body of each such request alive in blob memory, which ran a chunked
 * upload of 2 GiB out of it in an incognito window. A navigation to a URL in its scope still
 * reaches it, so tier 1 needs no page it controls.
 */
export const DOWNLOAD_SW_SCOPE = "/__skysend_download__/";

/**
 * The script of the download Service Worker, under the version of this release. A browser looks
 * for a new worker on its own only when it navigates into the scope of the worker, which here is
 * the download itself, and that never happens when an old worker fails tier 1 first. A new
 * release has a new URL, and `register()` with a URL other than the registered one fetches the
 * script again, so every release brings its worker along. Between releases nothing is fetched. A
 * build between two releases keeps the URL, so whoever tests one removes the old worker by hand.
 */
export const DOWNLOAD_SW_URL = `/download-sw.js?v=${encodeURIComponent(__APP_VERSION__)}`;

/**
 * Registers the download Service Worker. Releases before 2026-10 registered it for the whole
 * origin, so such a registration is removed. The page it controls right now stays controlled
 * until it navigates.
 */
export async function registerDownloadSw(): Promise<ServiceWorkerRegistration> {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const registration of registrations) {
        const worker = registration.active ?? registration.waiting ?? registration.installing;
        const script = worker ? new URL(worker.scriptURL).pathname : "";
        if (script === "/download-sw.js" && new URL(registration.scope).pathname === "/") {
          void registration.unregister();
        }
      }
    })
    .catch(() => {});
  return navigator.serviceWorker.register(DOWNLOAD_SW_URL, { scope: DOWNLOAD_SW_SCOPE });
}

/**
 * The worker that will handle the download. A newer one that is still installing, like the worker
 * of a release a browser sees for the first time, replaces the active one as soon as it activates,
 * and the configs the old one holds go with it, so that one is waited for. If it fails, the
 * active one stays.
 */
export function activeWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker | null> {
  const next = registration.installing ?? registration.waiting;
  if (!next) return Promise.resolve(registration.active);
  return new Promise((resolve) => {
    const settle = () => {
      if (next.state === "activated") resolve(next);
      if (next.state === "redundant") resolve(registration.active);
    };
    next.addEventListener("statechange", settle);
    settle();
  });
}

/**
 * Waits until the download Service Worker is active. It controls no page, see
 * DOWNLOAD_SW_SCOPE, so this waits for the worker itself, not for a controller.
 * Has a hard timeout, since a registration that fails to install never activates.
 */
export async function ensureSwController(
  onUnavailable?: (reason: string) => void,
): Promise<ServiceWorker | null> {
  if (!("serviceWorker" in navigator)) {
    onUnavailable?.("This browser offers no Service Workers here");
    return null;
  }

  let reason = "It did not start within 5 s";
  const result = await Promise.race([
    (async () => {
      try {
        // Registered from main.tsx already, which this finds again.
        return await activeWorker(await registerDownloadSw());
      } catch (err) {
        console.warn("[SkySend] SW registration failed:", err);
        // Chromium puts the scope and the script URL in front of the reason, like "An SSL
        // certificate error occurred when fetching the script." for an untrusted certificate.
        const text = err instanceof Error ? err.message : String(err);
        reason = text.split("): ").pop()!.slice(0, 200);
        return null;
      }
    })(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);

  if (result) {
    console.info("[SkySend] Service Worker ready");
  } else {
    console.warn("[SkySend] Service Worker not available (timeout or failed)");
    onUnavailable?.(reason);
  }
  return result;
}

/**
 * Stream download via Service Worker (no Worker, no OPFS needed).
 *
 * Flow: SW fetches encrypted file, decrypts with ECE, streams to download manager.
 * All inside respondWith() - Firefox propagates backpressure correctly there.
 *
 * The SW reports progress and completion back via postMessage (dl-progress, dl-done).
 * `plaintextSize` is the size from the authenticated metadata. The SW fails the
 * download when the decrypted stream ends up any other size. `tokenHeader` names the
 * header the SW sends the token in: X-Auth-Token for a download, X-Inbox-Token for a
 * file in the inbox of a file request. `baseNonce`, from the authenticated metadata too, is
 * what the SW checks the header of the stream against.
 */
export async function streamDownloadViaSw(
  url: string,
  authToken: string,
  secret: ArrayBuffer,
  salt: ArrayBuffer,
  filename: string,
  mimeType: string,
  encryptedSize: number,
  onProgress: (progress: number) => void,
  onDebugInfo?: (swPath: string) => void,
  signal?: AbortSignal,
  onS3Info?: () => void,
  plaintextSize?: number,
  tokenHeader: "X-Auth-Token" | "X-Inbox-Token" = "X-Auth-Token",
  baseNonce?: ArrayBuffer,
): Promise<void> {
  const sw = await ensureSwController();
  if (!sw) throw new Error("Service Worker not available");

  // If already aborted before we even start, bail out immediately.
  if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");

  const downloadId = crypto.randomUUID();

  // Send config to SW and wait for ACK
  let resend: ReturnType<typeof setInterval> | undefined;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(resend);
      downloadBc.removeEventListener("message", handler);
      reject(new Error("SW config timeout"));
    }, 5000);

    const abortHandler = () => {
      clearTimeout(timeout);
      clearInterval(resend);
      downloadBc.removeEventListener("message", handler);
      reject(new DOMException("Download cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "config-ok" && e.data?.id === downloadId) {
        clearTimeout(timeout);
        clearInterval(resend);
        signal?.removeEventListener("abort", abortHandler);
        downloadBc.removeEventListener("message", handler);
        resolve();
      }
    };

    downloadBc.addEventListener("message", handler);
    const config = {
      type: "config",
      id: downloadId,
      url,
      authToken,
      tokenHeader,
      secret,
      salt,
      filename,
      mimeType,
      size: encryptedSize,
      plaintextSize,
      baseNonce,
    };
    // A message to the worker starts it if the browser stopped it while the page sat open,
    // a BroadcastChannel message does not. The copies over the BroadcastChannel reach a worker
    // of an older release, which only listens there: the first message only woke it, and a
    // copy that arrives before its channel exists is lost, so they go out until one answers.
    // The worker keeps whichever comes first.
    sw.postMessage(config);
    downloadBc.postMessage(config);
    resend = setInterval(() => downloadBc.postMessage(config), 250);
  });

  // When the caller aborts, tell the SW to cancel the in-progress download.
  // The SW will set cancelled=true, cancel the reader, error the stream, and
  // send back a "dl-cancelled" message so we can clean up the promise below.
  signal?.addEventListener("abort", () => {
    downloadBc.postMessage({ type: "cancel", id: downloadId });
  }, { once: true });

  // Trigger download via <a> navigation (no download attribute).
  // Without the download attribute the browser treats this as a regular navigation,
  // which the SW intercepts and answers with Content-Disposition: attachment -
  // so the browser hands it to the download manager natively.
  //
  // We do NOT use <a download> because Chrome/Edge/Brave do not fire the SW
  // fetch event for <a download> clicks.
  //
  // We do NOT use an iframe because Firefox truncates SW streams during the
  // iframe -> download manager handoff, cutting large files at ~40-50%.
  // (Mozilla Send uses this same <a> approach for the same reason.)
  const a = document.createElement("a");
  a.href = `/__skysend_download__/${downloadId}`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Wait for SW to signal completion (dl-done, dl-error, or dl-cancelled).
  // Messages are filtered by downloadId (not clientId, which is empty for navigations).
  await new Promise<void>((resolve, reject) => {
    let gotFirstMessage = false;

    // If the SW never responds (e.g. SW not active),
    // reject quickly so fallback tiers can take over.
    const initialTimeout = setTimeout(() => {
      if (!gotFirstMessage) {
        downloadBc.removeEventListener("message", handler);
        reject(new Error("Service Worker did not respond"));
      }
    }, 10_000);

    const completionTimeout = setTimeout(() => {
      downloadBc.removeEventListener("message", handler);
      resolve(); // Don't error on timeout - download may have completed
    }, 86_400_000);

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.downloadId !== downloadId) return;

      if (!gotFirstMessage) {
        gotFirstMessage = true;
        clearTimeout(initialTimeout);
      }

      if (msg.type === "dl-progress") {
        onProgress(msg.progress);
      } else if (msg.type === "dl-tier") {
        onDebugInfo?.(msg.swPath);
      } else if (msg.type === "dl-s3") {
        onS3Info?.();
      } else if (msg.type === "dl-done") {
        clearTimeout(completionTimeout);
        downloadBc.removeEventListener("message", handler);
        resolve();
      } else if (msg.type === "dl-cancelled") {
        // User-initiated cancel via the cancel button - throw AbortError so the
        // caller can distinguish a clean cancel from a real download error and
        // skip fallback tiers.
        clearTimeout(completionTimeout);
        downloadBc.removeEventListener("message", handler);
        reject(new DOMException("Download cancelled by user", "AbortError"));
      } else if (msg.type === "dl-error") {
        clearTimeout(completionTimeout);
        downloadBc.removeEventListener("message", handler);
        reject(new Error(msg.error || "Download failed in SW"));
      }
    };

    downloadBc.addEventListener("message", handler);
  });
}
