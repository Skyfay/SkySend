import {
  encryptedMetadataLength,
  MAX_ENCRYPTED_METADATA_BYTES,
  type ArchiveMetadata,
} from "@skysend/crypto";
import { zipSize } from "@/lib/zip";

/**
 * The metadata of an upload of several files: their paths and sizes, and the size of the zip
 * the upload worker streams from them. A file from a picked folder keeps its place in it.
 */
export function archiveMetadata(files: readonly File[]): ArchiveMetadata {
  const entries = files.map((file) => ({
    name: file.webkitRelativePath || file.name,
    size: file.size,
  }));
  return {
    type: "archive",
    files: entries,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    archiveSize: zipSize(entries),
  };
}

/**
 * Whether the server takes the metadata of these files. Their names travel in it, and the
 * metadata only goes out once the whole upload is up, so a list too long for the server has to
 * be caught before. An upload into a file request adds a submission ID, and every upload the
 * base nonce of its stream, both counted with a stand-in.
 */
export function archiveMetadataFits(files: readonly File[], request = false): boolean {
  if (files.length < 2) return true;
  const metadata = { ...archiveMetadata(files), streamNonce: "A".repeat(16) };
  const sent = request ? { ...metadata, submission: "0".repeat(32) } : metadata;
  return encryptedMetadataLength(sent) <= MAX_ENCRYPTED_METADATA_BYTES;
}
