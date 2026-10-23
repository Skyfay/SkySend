import {
  encryptedMetadataLength,
  MAX_ENCRYPTED_METADATA_BYTES,
  type ArchiveMetadata,
} from "@skysend/crypto";
import { zipSize, type ZipEntryInfo } from "./zip.js";

/**
 * The names in order, a name already taken getting " (2)", " (3)" and so on before its
 * extension, the way a browser saves a second download of the same name. Case does not count,
 * since Windows and macOS extract "Report.pdf" and "report.pdf" onto one file.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const slash = name.lastIndexOf("/");
    const split = dot > slash + 1 ? dot : name.length;
    const stem = name.slice(0, split);
    const extension = name.slice(split);
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      candidate = `${stem} (${n})${extension}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * The metadata of an upload of several files: their paths and sizes, and the size of the zip
 * the upload streams from them. Each name is the path the file gets in the zip.
 */
export function archiveMetadata(files: readonly ZipEntryInfo[]): ArchiveMetadata {
  const entries = files.map(({ name, size }) => ({ name, size }));
  return {
    type: "archive",
    files: entries,
    totalSize: entries.reduce((sum, file) => sum + file.size, 0),
    archiveSize: zipSize(entries),
  };
}

/**
 * Whether the server takes the metadata of these files. Their names travel in it, and the
 * metadata only goes out once the whole upload is up, so a list too long for the server has to
 * be caught before. An upload into a file request adds a submission ID, and every upload the
 * base nonce of its stream, both counted with a stand-in.
 */
export function archiveMetadataFits(files: readonly ZipEntryInfo[], request = false): boolean {
  if (files.length < 2) return true;
  const metadata = { ...archiveMetadata(files), streamNonce: "A".repeat(16) };
  const sent = request ? { ...metadata, submission: "0".repeat(32) } : metadata;
  return encryptedMetadataLength(sent) <= MAX_ENCRYPTED_METADATA_BYTES;
}
