import { zip, zipSync, unzipSync, type Zippable } from "fflate";

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

export function unzipFiles(
  data: Uint8Array,
): { name: string; data: Uint8Array }[] {
  const unzipped = unzipSync(data);
  return Object.entries(unzipped).map(([name, fileData]) => ({
    name,
    data: fileData,
  }));
}
