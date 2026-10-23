import {
  archiveMetadata as metadataOfEntries,
  archiveMetadataFits as entriesFit,
  type ZipEntryInfo,
} from "@skysend/transfer";
import type { ArchiveMetadata } from "@skysend/crypto";

/** A picked file as an entry of the zip. A file from a picked folder keeps its place in it. */
function entryOf(file: File): ZipEntryInfo {
  return { name: file.webkitRelativePath || file.name, size: file.size };
}

/** The metadata of an upload of these files, see `archiveMetadata` in `@skysend/transfer`. */
export function archiveMetadata(files: readonly File[]): ArchiveMetadata {
  return metadataOfEntries(files.map(entryOf));
}

/** Whether the server takes the metadata of these files, see `@skysend/transfer`. */
export function archiveMetadataFits(files: readonly File[], request = false): boolean {
  return entriesFit(files.map(entryOf), request);
}
