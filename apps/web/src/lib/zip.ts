import { zipSync, unzipSync, type Zippable } from "fflate";

export function zipFiles(
  files: { name: string; data: Uint8Array }[],
): Uint8Array {
  const zippable: Zippable = {};
  for (const file of files) {
    zippable[file.name] = file.data;
  }
  return zipSync(zippable, { level: 6 });
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
