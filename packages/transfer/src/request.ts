/**
 * A file request from both sides: creating one with its brief, which the web app does, and
 * reading an upload link, which every client that sends into a request does. The upload itself
 * is `uploadEncrypted` with a `request` target.
 */
import {
  applyInboxPassword,
  createFileRequest,
  decodeUploadFragment,
  decryptRequestBrief,
  deriveLinkKeys,
  encodeInboxFragment,
  encodeUploadFragment,
  fromBase64url,
  randomBytes,
  toBase64url,
  PASSWORD_SALT_LENGTH,
  REQUEST_BRIEF_MAX_BYTES,
  type Argon2idHashFn,
  type RequestAsk,
} from "@skysend/crypto";
import { parseTemplate, serializeTemplate, type NoteBlock } from "@skysend/note-format";
import { ApiError, type ApiClient, type CreateRequestBody, type SenderRequest } from "./api.js";
import { sanitizeTitle } from "./names.js";

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
    const protectedSecret = await applyInboxPassword(
      local.inboxSecret,
      options.password,
      passwordSalt,
      options.argon2id,
    );
    inboxFragment = encodeInboxFragment(protectedSecret, passwordSalt);
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

/** What the requester asked for, read from the brief. */
export interface SenderBrief {
  /** Cleaned for showing, or null when there is none. */
  title: string | null;
  asks: RequestAsk[];
  /** The blocks to fill in, or null for a note written freely. */
  template: NoteBlock[] | null;
}

/** The keys behind an upload link. The public key comes only from the link, never from the server. */
export interface RequestAccess {
  publicKey: Uint8Array;
  uploadToken: string;
}

/**
 * An upload link, opened: the link does not decode (`invalid`), the server has no such request
 * or offers none (`gone`), its brief is missing or does not open (`broken`), or the request with
 * what it asks for and how much it still takes.
 */
export type OpenedRequestLink =
  | { state: "invalid" | "gone" | "broken" }
  | { state: "ready"; access: RequestAccess; status: SenderRequest; brief: SenderBrief };

/**
 * Reads an upload link: the keys from its fragment, then from the server how much the request
 * still takes and the brief, which only the key from the link opens. Every request has a brief.
 * One that is missing or does not open was dropped or swapped, and guessing what the requester
 * wanted would only help whoever did that. Throws what else the server answers.
 */
export async function openRequestLink(
  api: Pick<ApiClient, "fetchRequestForSender">,
  id: string,
  fragment: string,
): Promise<OpenedRequestLink> {
  let access: RequestAccess;
  let briefKey: CryptoKey;
  try {
    const { publicKey, linkSecret } = await decodeUploadFragment(fragment);
    const keys = await deriveLinkKeys(linkSecret, publicKey);
    access = { publicKey, uploadToken: toBase64url(keys.uploadToken) };
    briefKey = keys.briefKey;
  } catch {
    return { state: "invalid" };
  }

  let status: SenderRequest;
  try {
    status = await api.fetchRequestForSender(id, access.uploadToken);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return { state: "gone" };
    }
    throw err;
  }

  const stored = status.brief;
  const opened = stored
    ? await decryptRequestBrief(
        { ciphertext: fromBase64url(stored.ciphertext), nonce: fromBase64url(stored.nonce) },
        briefKey,
      ).catch(() => null)
    : null;
  if (!opened) return { state: "broken" };

  let template: NoteBlock[] | null = null;
  if (opened.asks.includes("note") && opened.template) {
    try {
      template = parseTemplate(opened.template);
    } catch {
      // A template nothing in can be filled in leaves a note written freely.
      template = null;
    }
  }
  const title = opened.title === null ? "" : sanitizeTitle(opened.title);
  return {
    state: "ready",
    access,
    status,
    brief: { title: title || null, asks: opened.asks, template },
  };
}

/**
 * A new mark for the uploads a sender sends together, 16 random bytes as hex. Every send gets
 * one, also of one part, so the metadata of a lone upload looks like that of a pair.
 */
export function newSubmission(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}
