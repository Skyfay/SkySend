/**
 * A note from its plaintext to the link, and from the link back to its blocks. What a note holds,
 * its blocks and their padding, is `@skysend/note-format`. The caller hands in the plaintext,
 * since a client that talks to a server from before v3 sends a legacy note instead.
 */
import {
  computeAuthToken,
  computeOwnerToken,
  decryptNoteContent,
  deriveKeys,
  encryptNoteContent,
  generateSalt,
  generateSecret,
  toBase64url,
  type Argon2idHashFn,
} from "@skysend/crypto";
import { readNote, type ReadBlock } from "@skysend/note-format";
import type { ApiClient, CreateNoteRequest, NoteInfo } from "./api.js";
import { fromBase64, keysFromLink } from "./download.js";
import { protectSecret, toBase64 } from "./upload.js";

export interface NoteOptions {
  api: Pick<ApiClient, "createNote">;
  /** `padNote(serializeNote(blocks))`, or a legacy note for a server from before v3. */
  plaintext: string;
  contentType: CreateNoteRequest["contentType"];
  maxViews: number;
  expireSec: number;
  /** The password of the note, "" for none. */
  password: string;
  argon2id: Argon2idHashFn;
}

/** A note on the server: the link is `/note/<id>#<effectiveSecret>`, the owner token deletes it. */
export interface SharedNote {
  id: string;
  ownerToken: string;
  effectiveSecret: string;
  hasPassword: boolean;
}

/**
 * Encrypts a note and creates it on the server. The server gets the ciphertext, the salt, the
 * two tokens and the content type, which for a note of blocks says only that it is made of blocks.
 */
export async function createEncryptedNote(options: NoteOptions): Promise<SharedNote> {
  const secret = generateSecret();
  const salt = generateSalt();
  const keys = await deriveKeys(secret, salt);
  const encrypted = await encryptNoteContent(options.plaintext, keys.metaKey);
  const { effectiveSecret, passwordSalt, passwordAlgo } = await protectSecret(
    secret,
    options.password,
    options.argon2id,
  );
  const ownerToken = toBase64url(await computeOwnerToken(effectiveSecret, salt));
  const hasPassword = passwordSalt !== undefined;

  const { id } = await options.api.createNote({
    encryptedContent: toBase64(encrypted.ciphertext),
    nonce: toBase64(encrypted.nonce),
    salt: toBase64url(salt),
    ownerToken,
    authToken: toBase64url(await computeAuthToken(keys.authKey)),
    contentType: options.contentType,
    maxViews: options.maxViews,
    expireSec: options.expireSec,
    hasPassword,
    ...(passwordSalt ? { passwordSalt: toBase64url(passwordSalt), passwordAlgo } : {}),
  });
  return { id, ownerToken, effectiveSecret: toBase64url(effectiveSecret), hasPassword };
}

export interface OpenNoteOptions {
  api: Pick<ApiClient, "verifyNotePassword" | "viewNote">;
  id: string;
  /** What `fetchNoteInfo` said about the note. */
  info: NoteInfo;
  /** The fragment of the link. */
  secret: string;
  /** The password, for a note that has one. */
  password?: string;
  argon2id: Argon2idHashFn;
}

/** A note after its view: its blocks and how many of its views are used up. */
export interface OpenedNote {
  blocks: ReadBlock[];
  /** True when the note did not read in its format and its one block is the text as it came. */
  unreadable: boolean;
  viewCount: number;
  maxViews: number;
}

/**
 * Opens a note from its link. The password of a protected note is checked first, so a wrong one
 * uses up no view, and the answer is then null. Otherwise one view is used up, and with a limit
 * of one the note is gone, so a note that does not parse comes back as plain text instead of
 * being lost. Notes from before v3 read through the legacy readers of `readNote`.
 */
export async function openNote(options: OpenNoteOptions): Promise<OpenedNote | null> {
  const { api, id, info } = options;
  const { keys, authToken } = await keysFromLink(
    options.secret,
    info.salt,
    info.hasPassword && options.password
      ? { password: options.password, saltB64: info.passwordSalt ?? "", argon2id: options.argon2id }
      : undefined,
  );
  if (info.hasPassword && !(await api.verifyNotePassword(id, authToken))) return null;

  const view = await api.viewNote(id, authToken);
  const plaintext = await decryptNoteContent(
    fromBase64(view.encryptedContent),
    fromBase64(view.nonce),
    keys.metaKey,
  );
  let blocks: ReadBlock[];
  let unreadable = false;
  try {
    blocks = readNote(info.contentType, plaintext);
  } catch {
    blocks = [{ type: "text", format: "plain", text: plaintext }];
    unreadable = true;
  }
  return { blocks, unreadable, viewCount: view.viewCount, maxViews: view.maxViews };
}
