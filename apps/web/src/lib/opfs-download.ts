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

// Lightweight inline JS for probing OPFS support.
// Does NOT import any modules - avoids Vite/module-loading issues in Firefox/Safari Workers.
const PROBE_JS = [
  "(async()=>{try{",
  "const r=await navigator.storage.getDirectory();",
  "const n='.skysend-probe-'+Date.now();",
  "const h=await r.getFileHandle(n,{create:true});",
  "const s=await h.createSyncAccessHandle();",
  "s.write(new Uint8Array([1,2,3]));",
  "s.flush();s.close();",
  "await r.removeEntry(n);",
  "self.postMessage('ok')",
  "}catch(e){self.postMessage('fail:'+e.message)}})();",
].join("");

let _opfsSupported: boolean | null = null;

/**
 * Pre-flight: tests OPFS + createSyncAccessHandle in a lightweight
 * inline Worker (blob URL). No module imports - works reliably everywhere.
 */
export async function checkOpfsSupport(): Promise<boolean> {
  if (_opfsSupported !== null) return _opfsSupported;

  try {
    _opfsSupported = await new Promise<boolean>((resolve) => {
      const blob = new Blob([PROBE_JS], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);

      const timeout = setTimeout(() => {
        w.terminate();
        URL.revokeObjectURL(url);
        resolve(false);
      }, 5000);

      w.onmessage = (event) => {
        clearTimeout(timeout);
        w.terminate();
        URL.revokeObjectURL(url);
        const ok = event.data === "ok";
        if (!ok) console.warn("[SkySend] OPFS probe failed:", event.data);
        resolve(ok);
      };

      w.onerror = (err) => {
        clearTimeout(timeout);
        w.terminate();
        URL.revokeObjectURL(url);
        console.warn("[SkySend] OPFS probe Worker error:", err);
        resolve(false);
      };
    });
  } catch {
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
