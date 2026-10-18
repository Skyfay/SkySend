import * as fs from "node:fs";
import * as path from "node:path";
import { once } from "node:events";
import type { FileMetadata } from "@skysend/crypto";
import {
  decryptedStream,
  decryptUploadMetadata,
  keysFromLink,
  parseShareLink,
  withUnlockedMeta,
  type LinkKeys,
  type ShareLink,
  type UploadInfo,
} from "@skysend/transfer";
import { apiFor } from "./api.js";
import { hashWasmArgon2 } from "./auth.js";
import { availablePath, sanitizeFilename } from "./filename.js";

/** A share opened with its link and, when it has one, its password. */
export interface OpenedShare {
  link: ShareLink;
  info: UploadInfo;
  keys: LinkKeys;
  metadata: FileMetadata;
}

/** The link and info of a share, before its password. */
export async function lookUpShare(url: string): Promise<{ link: ShareLink; info: UploadInfo }> {
  const link = parseShareLink(url, ["file", "note"]);
  if (link.type !== "file") {
    throw new Error("This URL is a note, not a file. Use 'skysend note-view' instead.");
  }
  return { link, info: await apiFor(link.server).fetchInfo(link.id) };
}

/**
 * Derives the keys, checks the password with the server when the share has one, and decrypts
 * the metadata. A wrong password throws "Invalid password", the server counts it.
 */
export async function openShare(
  link: ShareLink,
  info: UploadInfo,
  password?: string,
): Promise<OpenedShare> {
  if (info.hasPassword && !password) throw new Error("Password is required for this file");
  const keys = await keysFromLink(
    link.secret,
    info.salt,
    info.hasPassword
      ? { password: password!, saltB64: info.passwordSalt ?? "", argon2id: hashWasmArgon2 }
      : undefined,
  );
  if (info.hasPassword) {
    const unlocked = await apiFor(link.server).verifyPassword(link.id, keys.authToken);
    if (!unlocked) throw new Error("Invalid password");
    info = withUnlockedMeta(info, unlocked);
  }
  const metadata = await decryptUploadMetadata(info, keys.keys.metaKey);
  // The metadata carries the authenticated size and base nonce the download is checked against.
  if (!metadata) throw new Error("The upload has no metadata, so the download cannot be verified");
  return { link, info, keys, metadata };
}

/**
 * Where a download goes. The sender picks the name, so it may neither leave the chosen
 * directory nor replace a file there. Only a file path the user typed overwrites.
 */
export function outputPathFor(metadata: FileMetadata, output?: string): string {
  const name = metadata.type === "single" ? sanitizeFilename(metadata.name) : "archive.zip";
  if (!output) return availablePath(process.cwd(), name);
  const stat = fs.existsSync(output) ? fs.statSync(output) : null;
  return stat?.isDirectory() ? availablePath(output, name) : output;
}

/**
 * Downloads and decrypts a share into `outputPath`. It writes into a hidden part file first and
 * renames it at the end, so a download the server cut short never stays behind looking
 * complete. Writing waits for the disk, so a slow disk does not fill the memory.
 */
export async function saveShare(
  share: OpenedShare,
  outputPath: string,
  onProgress?: (written: number, total: number) => void,
): Promise<{ file: string; size: number }> {
  const { stream } = await apiFor(share.link.server).downloadFile(share.link.id, share.keys.authToken);
  return writeDecrypted(stream, share.metadata, share.keys.keys.fileKey, outputPath, onProgress);
}

/**
 * Decrypts a ciphertext into `outputPath`, checked against the metadata, through a hidden part
 * file that is renamed once everything arrived. A share and a file in an inbox alike.
 */
export async function writeDecrypted(
  ciphertext: ReadableStream<Uint8Array>,
  metadata: FileMetadata,
  fileKey: CryptoKey,
  outputPath: string,
  onProgress?: (written: number, total: number) => void,
): Promise<{ file: string; size: number }> {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const plain = decryptedStream(ciphertext, metadata, fileKey);
  const total = metadata.type === "single" ? metadata.size : (metadata.archiveSize ?? 0);

  const partPath = path.join(dir, `.skysend-${crypto.randomUUID()}.part`);
  const writer = fs.createWriteStream(partPath, { flags: "wx" });
  let written = 0;
  try {
    const reader = plain.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!writer.write(value)) await once(writer, "drain");
      written += value.byteLength;
      onProgress?.(written, total);
    }
    await new Promise<void>((resolve, reject) => {
      writer.once("error", reject);
      writer.end(() => resolve());
    });
    fs.renameSync(partPath, outputPath);
    return { file: outputPath, size: written };
  } catch (err) {
    writer.destroy();
    fs.rmSync(partPath, { force: true });
    throw err;
  }
}
