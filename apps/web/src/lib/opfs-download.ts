/**
 * Manages the OPFS download Worker that handles the COMPLETE pipeline:
 *   fetch() → decrypt → OPFS write
 * All inside a Web Worker - zero bytes touch the main thread.
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
 * Pre-flight: tests OPFS + createSyncAccessHandle inside a lightweight
 * inline Worker (blob URL). No module imports needed - works reliably
 * in Firefox, Safari, and Chromium.
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
  file: File;
  cleanup: () => void;
}

/**
 * Starts a complete download+decrypt+write pipeline in a Worker.
 * Returns a disk-backed File when done. Call cleanup() after use.
 *
 * The File is opened on the MAIN THREAD from OPFS - NOT transferred
 * via postMessage. This avoids Safari/Firefox copying the file into RAM
 * during structured cloning.
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
      worker.postMessage({ type: "cleanup", tempName });
      setTimeout(() => worker.terminate(), 2000);
    };

    worker.onmessage = async (event) => {
      const msg = event.data;
      if (msg.type === "progress") {
        onProgress(msg.progress);
      } else if (msg.type === "done") {
        try {
          // Open OPFS on the main thread - avoids Worker→Main File transfer
          // which can cause Safari/Firefox to copy the entire file into RAM
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle(tempName);
          const file = await handle.getFile();
          resolve({ file, cleanup });
        } catch {
          // Fallback: use the file sent by the Worker (if available)
          if (msg.file) {
            resolve({ file: msg.file, cleanup });
          } else {
            cleanup();
            reject(new Error("Failed to open OPFS file on main thread"));
          }
        }
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
