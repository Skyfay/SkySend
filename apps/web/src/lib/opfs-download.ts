/**
 * OPFS download pipeline with Service Worker streaming.
 *
 * Architecture (zero RAM in ALL browsers):
 *   1. OPFS Worker: fetch → decrypt → write to OPFS (no data on main thread)
 *   2. Service Worker: streams from OPFS to browser download manager
 *   3. Browser saves to Downloads folder natively
 *
 * The key insight: createObjectURL(file) copies to RAM in Firefox/Safari.
 * A Service Worker returning file.stream() as a Response does NOT - the
 * browser's download manager reads chunks on demand and writes to disk.
 */

let _opfsSupported: boolean | null = null;

/**
 * Pre-flight: tests OPFS support on the MAIN THREAD.
 *
 * We test getDirectory() + getFileHandle() here. The actual
 * createSyncAccessHandle() is Worker-only but is supported in all
 * browsers that support OPFS (Firefox 111+, Safari 15.2+, Chrome 102+).
 *
 * We CANNOT use a Blob-URL Worker for the probe because Firefox/Safari
 * block navigator.storage.getDirectory() from opaque (blob:) origins.
 */
export async function checkOpfsSupport(): Promise<boolean> {
  if (_opfsSupported !== null) return _opfsSupported;

  try {
    const root = await navigator.storage.getDirectory();
    const probeName = ".skysend-probe-" + Date.now();
    await root.getFileHandle(probeName, { create: true });
    // Clean up probe file
    await root.removeEntry(probeName).catch(() => {});
    // If we got here, OPFS works
    _opfsSupported = true;
  } catch (err) {
    console.warn("[SkySend] OPFS probe failed:", err);
    _opfsSupported = false;
  }

  console.info("[SkySend] OPFS support:", _opfsSupported);
  return _opfsSupported;
}

export interface OpfsDownloadResult {
  tempName: string;
  cleanup: () => void;
}

/**
 * Runs the OPFS Worker pipeline: fetch → decrypt → OPFS write.
 * Returns the tempName of the written file. Call cleanup() when done.
 */
export function startOpfsDownload(
  url: string,
  authToken: string,
  secret: ArrayBuffer,
  salt: ArrayBuffer,
  tempName: string,
  encryptedSize: number,
  onProgress: (progress: number) => void,
): Promise<OpfsDownloadResult> {
  const worker = new Worker(
    new URL("./opfs-worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise<OpfsDownloadResult>((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      // Delete OPFS temp file on main thread (Worker may already be dead)
      navigator.storage.getDirectory()
        .then((root) => root.removeEntry(tempName))
        .catch(() => {});
    };

    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "progress") {
        onProgress(msg.progress);
      } else if (msg.type === "done") {
        resolve({ tempName, cleanup });
      } else if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(new Error(err.message || "OPFS worker error"));
    };

    worker.postMessage({
      type: "download",
      url,
      authToken,
      secret,
      salt,
      tempName,
      encryptedSize,
    }, [secret, salt]);
  });
}

/**
 * Triggers the actual browser download via Service Worker.
 * The SW reads from OPFS using file.stream() and returns a streaming
 * Response - the browser download manager writes to disk with zero RAM.
 */
export async function triggerSwDownload(
  tempName: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  // Ensure SW is active and controlling this page
  await navigator.serviceWorker.ready;
  let sw = navigator.serviceWorker.controller;

  if (!sw) {
    // First registration - wait for claim()
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => resolve(),
        { once: true },
      );
    });
    sw = navigator.serviceWorker.controller;
  }

  if (!sw) {
    throw new Error("Service Worker not available");
  }

  const downloadId = crypto.randomUUID();

  // Send config to SW and wait for ACK
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", handler);
      reject(new Error("SW config timeout"));
    }, 5000);

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "config-ok" && e.data?.id === downloadId) {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", handler);
        resolve();
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    sw!.postMessage({ type: "config", id: downloadId, tempName, filename, mimeType });
  });

  // Navigate to SW-intercepted URL - browser downloads natively
  const a = document.createElement("a");
  a.href = `/__skysend_download__/${downloadId}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Fallback: trigger download via Blob URL from OPFS.
 * Uses RAM (Firefox/Safari getFile() may snapshot) but works without SW.
 */
export async function triggerBlobDownload(
  tempName: string,
  filename: string,
  _mimeType: string,
): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(tempName);
  const file = await handle.getFile();
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Waits for a Service Worker to be controlling this page.
 * Has a hard timeout - navigator.serviceWorker.ready never resolves
 * if no SW was registered (e.g. file not found at origin).
 */
export async function ensureSwController(): Promise<ServiceWorker | null> {
  if (!("serviceWorker" in navigator)) return null;

  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }

  // Hard timeout: .ready never resolves if SW registration failed
  const result = await Promise.race([
    (async () => {
      try {
        // Try to register (might already be registered from main.tsx)
        await navigator.serviceWorker.register("/download-sw.js");
        await navigator.serviceWorker.ready;

        if (navigator.serviceWorker.controller) {
          return navigator.serviceWorker.controller;
        }

        // Wait for clients.claim() from the SW
        return new Promise<ServiceWorker | null>((resolve) => {
          const t = setTimeout(() => resolve(null), 2000);
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
              clearTimeout(t);
              resolve(navigator.serviceWorker.controller);
            },
            { once: true },
          );
        });
      } catch (err) {
        console.warn("[SkySend] SW registration failed:", err);
        return null;
      }
    })(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);

  if (result) {
    console.info("[SkySend] Service Worker ready");
  } else {
    console.warn("[SkySend] Service Worker not available (timeout or failed)");
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
): Promise<void> {
  const sw = await ensureSwController();
  if (!sw) throw new Error("Service Worker not available");

  const downloadId = crypto.randomUUID();

  // Send config to SW and wait for ACK
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", handler);
      reject(new Error("SW config timeout"));
    }, 5000);

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "config-ok" && e.data?.id === downloadId) {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", handler);
        resolve();
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    sw.postMessage({
      type: "config",
      id: downloadId,
      url,
      authToken,
      secret,
      salt,
      filename,
      mimeType,
      size: encryptedSize,
    });
  });

  // Trigger download via hidden iframe instead of <a download>.
  // Chrome/Edge/Safari/Brave do NOT fire the SW fetch event for <a download> clicks.
  // An iframe navigation IS always intercepted by the SW in all browsers.
  // The SW responds with Content-Disposition: attachment, so the browser
  // starts a download without affecting the parent page.
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.style.display = "none";
  iframe.src = `/__skysend_download__/${downloadId}`;
  document.body.appendChild(iframe);

  // Wait for SW to signal completion (dl-done or dl-error).
  // Messages are filtered by downloadId (not clientId, which is empty for navigations).
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", handler);
      iframe.remove();
      resolve(); // Don't error on timeout - download may have completed
    }, 86_400_000);

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.downloadId !== downloadId) return;

      if (msg.type === "dl-progress") {
        onProgress(msg.progress);
      } else if (msg.type === "dl-done") {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", handler);
        iframe.remove();
        resolve();
      } else if (msg.type === "dl-error") {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", handler);
        iframe.remove();
        reject(new Error(msg.error || "Download failed in SW"));
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
  });
}
