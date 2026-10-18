import * as fs from "node:fs";
import * as path from "node:path";
import { noteToText, type ReadBlock } from "@skysend/note-format";
import {
  ApiError,
  groupBySubmission,
  inboxNeedsPassword,
  openInbox,
  openInboxLink,
  parseShareLink,
  readInboxNote,
  type Inbox,
  type InboxAccess,
  type OpenedInbox,
  type OpenedUpload,
  type ServerConfig,
} from "@skysend/transfer";
import { apiFor } from "./api.js";
import { hashWasmArgon2 } from "./auth.js";
import { writeDecrypted } from "./download-job.js";
import { availablePath, sanitizeFilename } from "./filename.js";

/** The inbox of a file request, opened with its link: what arrived, and the keys to it. */
export interface OpenInbox {
  server: string;
  id: string;
  access: InboxAccess;
  inbox: Inbox;
  opened: OpenedInbox;
  config: ServerConfig;
  /** Whether the link needed a password, which turns a 404 into "wrong or gone". */
  hasPassword: boolean;
}

/** The link of an inbox, read, and whether it needs a password before anything is asked. */
export function readInboxLink(url: string): {
  server: string;
  id: string;
  fragment: string;
  needsPassword: boolean;
} {
  const link = parseShareLink(url, ["inbox", "request"]);
  if (link.type === "request") {
    throw new Error(
      "This is the upload link of a request, which is for sending into it. Use the inbox link its maker kept.",
    );
  }
  let needsPassword: boolean;
  try {
    needsPassword = inboxNeedsPassword(link.secret);
  } catch (err) {
    throw new Error("This inbox link is not complete. Copy it again from where you kept it.", {
      cause: err,
    });
  }
  return { server: link.server, id: link.id, fragment: link.secret, needsPassword };
}

/**
 * Opens an inbox: the keys from the link and the password, then the vault and every upload in
 * it, each on its own, so one that is damaged does not hide the others. Listing downloads
 * nothing. A wrong password and a deleted request look the same to the server.
 */
export async function openInboxFrom(url: string, password?: string): Promise<OpenInbox> {
  const { server, id, fragment, needsPassword } = readInboxLink(url);
  if (needsPassword && !password) throw new Error("This inbox has a password.");
  const access = await openInboxLink(fragment, password, hashWasmArgon2);
  const api = apiFor(server);
  const config = await api.fetchConfig();
  let inbox: Inbox;
  try {
    inbox = await api.fetchInbox(id, access.inboxToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(
        needsPassword
          ? "Wrong password, or the request no longer exists."
          : "This request no longer exists.",
        { cause: err },
      );
    }
    if (err instanceof ApiError && err.status === 429) {
      throw new Error("Too many tries. Wait a while before the next one.", { cause: err });
    }
    throw err;
  }
  const opened = await openInbox(id, inbox, access.keys);
  return { server, id, access, inbox, opened, config, hasPassword: needsPassword };
}

/** The uploads of an inbox in the order they arrived, those sent together side by side. */
export function inboxEntries(inbox: OpenInbox): OpenedUpload[][] {
  return groupBySubmission(inbox.opened.uploads);
}

/** What an upload is, for a line in a list: a file by its cleaned name, an archive, a note. */
export function describeEntry(entry: OpenedUpload): string {
  const metadata = entry.file?.metadata;
  if (!metadata) return "damaged, it cannot be opened";
  if (metadata.type === "single") return sanitizeFilename(metadata.name);
  if (metadata.type === "note") return "a note";
  return `${metadata.files.length} files in one zip`;
}

/** The name an upload is saved under in `dir`, never one that is already there. */
export function savePathFor(entry: OpenedUpload, dir: string): string {
  const metadata = entry.file?.metadata;
  const name =
    metadata?.type === "single"
      ? sanitizeFilename(metadata.name)
      : metadata?.type === "note"
        ? "note.txt"
        : "archive.zip";
  return availablePath(dir, name);
}

/** Reads a note of the inbox. It counts as a download, like in the web app. */
export async function readEntryNote(
  inbox: OpenInbox,
  entry: OpenedUpload,
): Promise<{ blocks: ReadBlock[]; unreadable: boolean }> {
  if (!entry.file || entry.file.metadata.type !== "note")
    throw new Error("This upload is not a note");
  const { stream } = await apiFor(inbox.server).downloadInboxFile(
    inbox.id,
    entry.upload.id,
    inbox.access.inboxToken,
  );
  return readInboxNote(entry.file, stream, inbox.config.noteMaxSize);
}

/**
 * Saves one upload into `outputPath`: a file or zip through a part file with its checks, a note
 * as text only its owner reads, since it can hold passwords.
 */
export async function saveEntry(
  inbox: OpenInbox,
  entry: OpenedUpload,
  outputPath: string,
  onProgress?: (written: number, total: number) => void,
): Promise<{ file: string; size: number }> {
  const file = entry.file;
  if (!file) throw new Error("This upload is damaged and cannot be opened");
  if (file.metadata.type === "note") {
    const { blocks } = await readEntryNote(inbox, entry);
    const text = noteToText(blocks);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    // Only the owner may read it. The folder stays as the user keeps it.
    fs.writeFileSync(outputPath, text, { encoding: "utf-8", mode: 0o600 });
    return { file: outputPath, size: Buffer.byteLength(text) };
  }
  const { stream } = await apiFor(inbox.server).downloadInboxFile(
    inbox.id,
    entry.upload.id,
    inbox.access.inboxToken,
  );
  return writeDecrypted(stream, file.metadata, file.keys.fileKey, outputPath, onProgress);
}

/** Deletes one upload from the inbox, with the owner token from the link. */
export async function deleteEntry(inbox: OpenInbox, entry: OpenedUpload): Promise<void> {
  await apiFor(inbox.server).deleteInboxFile(inbox.id, entry.upload.id, inbox.access.ownerToken);
}
