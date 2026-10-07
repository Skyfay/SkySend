import {
  applyPasswordProtection,
  calculateEncryptedSize,
  createDecryptStream,
  createFileRequest,
  decodeInboxFragment,
  decryptRequestBrief,
  decryptRequestMetadata,
  deriveInboxKeys,
  deriveKeyFromPassword,
  deriveKeys,
  deriveLinkKeys,
  encodeInboxFragment,
  encodeUploadFragment,
  fromBase64url,
  openRequestKey,
  randomBytes,
  toBase64url,
  unwrapFileSecret,
  PASSWORD_SALT_LENGTH,
  REQUEST_BRIEF_MAX_BYTES,
  type Argon2idHashFn,
  type DerivedKeys,
  type InboxKeys,
  type RequestAsk,
  type RequestBrief,
  type RequestUploadMetadata,
} from "@skysend/crypto";
import {
  NOTE_PAD_BLOCK,
  cleanLabel,
  parseNote,
  serializeTemplate,
  type NoteBlock,
  type ReadBlock,
} from "@skysend/note-format";
import type { CreateRequestBody, Inbox, InboxUpload } from "@/lib/api";

/**
 * Whether the brief would fit: the title, what is asked for and the template, as the brief
 * carries them. A template the format refuses does not fit either.
 */
export function briefFits(
  title: string,
  asks: readonly RequestAsk[],
  template: readonly NoteBlock[],
): boolean {
  try {
    const blocks =
      asks.includes("note") && template.length > 0 ? serializeTemplate(template) : null;
    const json = JSON.stringify({ v: 1, title: title || null, asks, template: blocks });
    return new TextEncoder().encode(json).length <= REQUEST_BRIEF_MAX_BYTES;
  } catch {
    return false;
  }
}

/** What creating a request gives back: the body for the server and the fragments of both links. */
export interface PreparedRequest {
  body: Omit<CreateRequestBody, "expireSec" | "maxUploads" | "maxSize" | "downloads">;
  inboxFragment: string;
  uploadFragment: string;
}

/**
 * Builds a new request in this browser, with its brief: the title, what it asks for, and for
 * a note the template a sender fills in. With a password the inbox link carries the
 * protected secret and the password salt, the same scheme a password protected file uses.
 */
export async function prepareRequest(options: {
  title?: string;
  asks?: RequestAsk[];
  template?: NoteBlock[] | null;
  password?: string;
  argon2id?: Argon2idHashFn;
}): Promise<PreparedRequest> {
  const asks = options.asks ?? ["files"];
  const template =
    asks.includes("note") && options.template && options.template.length > 0
      ? serializeTemplate(options.template)
      : null;
  const { local, server } = await createFileRequest({
    title: options.title || null,
    asks,
    template,
  });

  let inboxFragment: string;
  if (options.password) {
    if (!options.argon2id) throw new Error("Argon2id is required for a password protected inbox");
    const passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
    const { key } = await deriveKeyFromPassword(options.password, passwordSalt, options.argon2id);
    inboxFragment = encodeInboxFragment(
      applyPasswordProtection(local.inboxSecret, key),
      passwordSalt,
    );
    key.fill(0);
  } else {
    inboxFragment = encodeInboxFragment(local.inboxSecret);
  }
  // The link holds the secret from here on. No copy stays in memory.
  local.inboxSecret.fill(0);

  return {
    body: {
      vault: toBase64url(server.vault),
      vaultNonce: toBase64url(server.vaultNonce),
      inboxAuthToken: toBase64url(server.inboxAuthToken),
      inboxOwnerToken: toBase64url(server.inboxOwnerToken),
      uploadToken: toBase64url(server.uploadToken),
      brief: {
        ciphertext: toBase64url(server.brief.ciphertext),
        nonce: toBase64url(server.brief.nonce),
      },
      hasPassword: Boolean(options.password),
    },
    inboxFragment,
    uploadFragment: encodeUploadFragment(local.publicKey, local.linkSecret),
  };
}

/** The two links of a request: one to hand out, one to keep. */
export interface RequestLinks {
  uploadLink: string;
  inboxLink: string;
}

/** The upload link and the inbox link of a request, from its ID and the two fragments. */
export function requestLinks(request: {
  id: string;
  uploadFragment: string;
  inboxFragment: string;
}): RequestLinks {
  const origin = window.location.origin;
  return {
    uploadLink: `${origin}/request/${request.id}#${request.uploadFragment}`,
    inboxLink: `${origin}/inbox/${request.id}#${request.inboxFragment}`,
  };
}

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
    const { key } = await deriveKeyFromPassword(password, passwordSalt, argon2id);
    inboxSecret = applyPasswordProtection(secret, key);
    key.fill(0);
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
  const plain = bounded.pipeThrough(createDecryptStream(file.keys.fileKey, metadata.size));
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

/** Characters that draw as blank space but are no whitespace: the Braille blank, Hangul fillers. */
const BLANK_FILLERS = /[\u2800\u3164\u115F\u1160\uFFA0]/g;
/** Combining marks stacked past what any script needs, which spill over the lines around them. */
const MARK_STACKS = /(\p{M}{3})\p{M}+/gu;

/**
 * A name from a sender, made safe to show and to save under: no control or format
 * characters (bidirectional overrides that make an "exe" read as "pdf", zero-width ones),
 * no lone surrogates, no path separators, no runs of spaces or blank fillers that push the
 * real extension out of sight, no towers of combining marks, at most 255 characters, and
 * never empty.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = Array.from(
    name
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
      .replace(BLANK_FILLERS, " ")
      .replace(MARK_STACKS, "$1")
      .replace(/[/\\]/g, "_")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 255)
    .join("");
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned;
}

/**
 * The title a requester wrote, made safe to show to a sender: no control or format
 * characters except line breaks, no blank fillers or towers of combining marks, and no run
 * of empty lines that could push the note "not checked" out of sight above a claim further
 * down.
 */
export function sanitizeTitle(title: string): string {
  return (
    title
      .replace(/\r\n?/g, "\n")
      .replace(/[\p{Zl}\p{Zp}]/gu, "\n")
      // Whitespace stays for now and becomes a single space below, so a tab still parts words.
      .replace(/(?!\s)[\p{Cc}\p{Cf}\p{Cs}]/gu, "")
      .replace(BLANK_FILLERS, " ")
      .replace(MARK_STACKS, "$1")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
