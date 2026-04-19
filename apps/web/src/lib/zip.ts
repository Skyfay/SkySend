import { zip, zipSync, unzipSync, Zip, ZipDeflate, type Zippable } from "fflate";

export function zipFiles(
  files: { name: string; data: Uint8Array }[],
): Uint8Array {
  const zippable: Zippable = {};
  for (const file of files) {
    zippable[file.name] = file.data;
  }
  return zipSync(zippable, { level: 6 });
}

/**
 * Async version of zipFiles that uses Web Workers for compression.
 * Prevents blocking the main thread for large files.
 */
export function zipFilesAsync(
  files: { name: string; data: Uint8Array }[],
): Promise<Uint8Array> {
  const zippable: Zippable = {};
  for (const file of files) {
    zippable[file.name] = file.data;
  }
  return new Promise((resolve, reject) => {
    zip(zippable, { level: 6 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export interface StreamingZipResult {
  chunks: Uint8Array[];
  totalSize: number;
}

/**
 * Streaming ZIP creation that reads files one at a time via File.stream().
 * Reports byte-accurate progress as files are read and compressed.
 * Designed to run in a Web Worker to keep the main thread responsive.
 *
 * Returns an array of compressed chunks instead of a single buffer to avoid
 * exceeding the browser's contiguous ArrayBuffer allocation limit (~2 GB).
 */
export async function streamingZip(
  files: File[],
  onProgress: (bytesRead: number, totalBytes: number) => void,
): Promise<StreamingZipResult> {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let bytesRead = 0;

  // Collect compressed output chunks
  const outputChunks: Uint8Array[] = [];
  let outputSize = 0;

  const zipper = new Zip((err, chunk, _final) => {
    if (err) throw err;
    outputChunks.push(chunk);
    outputSize += chunk.length;
  });

  // Process files sequentially to minimize peak memory
  for (const file of files) {
    const name = file.webkitRelativePath || file.name;
    const entry = new ZipDeflate(name, { level: 6 });
    zipper.add(entry);

    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        entry.push(new Uint8Array(0), true);
        break;
      }
      entry.push(value);
      bytesRead += value.byteLength;
      onProgress(bytesRead, totalBytes);
    }
  }

  zipper.end();

  return { chunks: outputChunks, totalSize: outputSize };
}

export function unzipFiles(
  data: Uint8Array,
): { name: string; data: Uint8Array }[] {
  const unzipped = unzipSync(data);
  return Object.entries(unzipped).map(([name, fileData]) => ({
    name,
    data: fileData,
  }));
}
