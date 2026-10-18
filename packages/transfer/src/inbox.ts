/**
 * The inbox of a file request, opened with the key in its link: the uploads of every sender,
 * each opened on its own, and the notes in them. Nothing here reaches the server but the two
 * inbox tokens.
 */
import {
  applyInboxPassword,
  calculateEncryptedSize,
  createDecryptStream,
  decodeInboxFragment,
  decryptRequestBrief,
  decryptRequestMetadata,
  deriveInboxKeys,
  deriveKeys,
  deriveLinkKeys,
  encodeUploadFragment,
  expectedBaseNonce,
  fromBase64url,
  openRequestKey,
  toBase64url,
  unwrapFileSecret,
  type Argon2idHashFn,
  type DerivedKeys,
  type InboxKeys,
  type RequestAsk,
  type RequestBrief,
  type RequestUploadMetadata,
} from "@skysend/crypto";
import { NOTE_PAD_BLOCK, cleanLabel, parseNote, type ReadBlock } from "@skysend/note-format";
import type { Inbox, InboxUpload } from "./api.js";
import { sanitizeTitle } from "./names.js";

/** Whether an inbox link needs a password. Throws for a link that is not one. */
export function inboxNeedsPassword(fragment: string): boolean {
  return decodeInboxFragment(fragment).passwordSalt !== null;
}

/** The keys behind an inbox link, with its tokens ready for the request headers. */
export interface InboxAccess {
  keys: InboxKeys;
  inboxToken: string;
  ownerToken: string;
}

/** Recovers the inbox secret from the link, with the password when it has one. */
export async function openInboxLink(
  fragment: string,
  password?: string,
  argon2id?: Argon2idHashFn,
): Promise<InboxAccess> {
  const { secret, passwordSalt } = decodeInboxFragment(fragment);
  let inboxSecret = secret;
  if (passwordSalt) {
    if (!password || !argon2id) throw new Error("This inbox needs its password");
    inboxSecret = await applyInboxPassword(secret, password, passwordSalt, argon2id);
  }
  const keys = await deriveInboxKeys(inboxSecret);
  inboxSecret.fill(0);
  return {
    keys,
    inboxToken: toBase64url(keys.inboxAuthToken),
    ownerToken: toBase64url(keys.inboxOwnerToken),
  };
}

/** One upload in the inbox, opened. A broken entry carries no keys and shows as damaged. */
export interface OpenedUpload {
  upload: InboxUpload;
  /**
   * The keys and the secret the download needs, or null when the entry is damaged. The
   * metadata names a file, an archive, or a note.
   */
  file: {
    secret: Uint8Array;
    salt: Uint8Array;
    keys: DerivedKeys;
    metadata: RequestUploadMetadata;
  } | null;
}

export interface OpenedInbox {
  /** The title the requester wrote, or null when there is none. */
  title: string | null;
  /** What the request asks for. Anything else that arrived was not asked for. */
  asks: RequestAsk[];
  /** The upload link, rebuilt from the vault so it can be copied again. */
  uploadFragment: string;
  uploads: OpenedUpload[];
}

/**
 * The uploads of an inbox, those a sender sent together in one group, in the order the first
 * of each group arrived. The mark comes from the sender's encrypted metadata, so a sender can
 * only group uploads of their own. A damaged upload stands alone.
 */
export function groupBySubmission(uploads: readonly OpenedUpload[]): OpenedUpload[][] {
  const groups: OpenedUpload[][] = [];
  const bySubmission = new Map<string, OpenedUpload[]>();
  for (const entry of uploads) {
    const submission = entry.file?.metadata.submission;
    const group = submission ? bySubmission.get(submission) : undefined;
    if (group) {
      group.push(entry);
      continue;
    }
    const fresh = [entry];
    if (submission) bySubmission.set(submission, fresh);
    groups.push(fresh);
  }
  return groups;
}

/**
 * Opens the vault and every upload in it. Each upload is opened on its own, so one that
 * was damaged or crafted by a sender does not hide the others.
 */
export async function openInbox(
  requestId: string,
  inbox: Inbox,
  keys: InboxKeys,
): Promise<OpenedInbox> {
  // The vault binds the brief as stored, so a brief the server swapped opens nothing.
  if (!inbox.brief) throw new Error("The request has no brief");
  const storedBrief = {
    ciphertext: fromBase64url(inbox.brief.ciphertext),
    nonce: fromBase64url(inbox.brief.nonce),
  };
  const requestKey = await openRequestKey(
    fromBase64url(inbox.vault),
    fromBase64url(inbox.vaultNonce),
    keys.inboxKey,
    storedBrief,
  );
  const { briefKey } = await deriveLinkKeys(requestKey.linkSecret, requestKey.publicKey);
  // The vault opened, so the brief is the one this request was made with.
  let brief: RequestBrief = { title: null, asks: ["files"], template: null };
  try {
    brief = await decryptRequestBrief(storedBrief, briefKey);
  } catch {
    // Only a client that wrote a broken brief gets here. The uploads still open.
  }

  const uploads = await Promise.all(
    inbox.uploads.map(async (upload): Promise<OpenedUpload> => {
      try {
        const secret = await unwrapFileSecret(requestKey, requestId, upload.id, {
          enc: fromBase64url(upload.wrapEnc),
          ciphertext: fromBase64url(upload.wrapCiphertext),
        });
        const salt = fromBase64url(upload.salt);
        const fileKeys = await deriveKeys(secret, salt);
        const metadata = await decryptRequestMetadata(
          fromBase64url(upload.encryptedMeta),
          fromBase64url(upload.metaNonce),
          fileKeys.metaKey,
        );
        // Every sender uses a client that records the archive size, and without it the
        // download could not be checked for completeness.
        if (metadata.type === "archive" && metadata.archiveSize === undefined) {
          return { upload, file: null };
        }
        // A note is read into memory, so its size has to be what the stored bytes hold, and
        // every client pads it to whole blocks.
        if (
          metadata.type === "note" &&
          (metadata.size % NOTE_PAD_BLOCK !== 0 ||
            upload.size !== calculateEncryptedSize(metadata.size))
        ) {
          return { upload, file: null };
        }
        return { upload, file: { secret, salt, keys: fileKeys, metadata } };
      } catch {
        return { upload, file: null };
      }
    }),
  );

  return {
    title: brief.title === null ? null : sanitizeTitle(brief.title) || null,
    asks: brief.asks,
    uploadFragment: encodeUploadFragment(requestKey.publicKey, requestKey.linkSecret),
    uploads,
  };
}

/** Why a note in an inbox cannot be shown. */
export class NoteTooLargeError extends Error {
  override name = "NoteTooLargeError";
}

/**
 * Whether a note is larger than any note this instance takes, padding included. Checked
 * before it is fetched, so a crafted one never costs a download or fills the memory.
 */
export function noteTooLarge(file: NonNullable<OpenedUpload["file"]>, maxSize: number): boolean {
  return file.metadata.type === "note" && file.metadata.size > maxSize + NOTE_PAD_BLOCK;
}

/**
 * Decrypts a note a sender put into the inbox, from the stream of its upload, and reads its
 * blocks. A sender wrote every label in it, so each one is cleaned before it is shown. A note
 * that does not parse comes back as one block of plain text, so nothing in it is lost.
 * `maxSize` is the largest note the instance takes, checked before anything is read.
 */
export async function readInboxNote(
  file: NonNullable<OpenedUpload["file"]>,
  stream: ReadableStream<Uint8Array>,
  maxSize: number,
): Promise<{ blocks: ReadBlock[]; unreadable: boolean }> {
  const { metadata } = file;
  if (metadata.type !== "note") throw new Error("Not a note");
  if (noteTooLarge(file, maxSize)) {
    await stream.cancel().catch(() => {});
    throw new NoteTooLargeError("The note is larger than this instance takes");
  }
  // The size is checked only once the stream ends, so the bytes are counted as they come.
  const limit = calculateEncryptedSize(metadata.size);
  let received = 0;
  const bounded = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) controller.error(new Error("The note is longer than its size"));
        else controller.enqueue(chunk);
      },
    }),
  );
  const plain = bounded.pipeThrough(
    createDecryptStream(file.keys.fileKey, metadata.size, expectedBaseNonce(metadata)),
  );
  const text = new TextDecoder().decode(await new Response(plain).arrayBuffer());
  try {
    return { blocks: parseNote(text).map(cleanBlockLabels), unreadable: false };
  } catch {
    return { blocks: [{ type: "text", format: "plain", text: text.trimEnd() }], unreadable: true };
  }
}

/** The block with every label a sender wrote cleaned, the values left as they are. */
function cleanBlockLabels(block: ReadBlock): ReadBlock {
  switch (block.type) {
    case "text":
      return block.label === undefined ? block : { ...block, label: cleanLabel(block.label) };
    case "password":
      return {
        ...block,
        entries: block.entries.map((entry) => ({ ...entry, label: cleanLabel(entry.label) })),
      };
    case "code":
      return { ...block, title: cleanLabel(block.title) };
    default:
      return block;
  }
}
