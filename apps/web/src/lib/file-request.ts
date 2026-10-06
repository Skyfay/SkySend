import {
  applyPasswordProtection,
  createFileRequest,
  decodeInboxFragment,
  decryptMetadata,
  decryptRequestTitle,
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
  type Argon2idHashFn,
  type DerivedKeys,
  type FileMetadata,
  type InboxKeys,
} from "@skysend/crypto";
import type { CreateRequestBody, Inbox, InboxUpload } from "@/lib/api";

/** What creating a request gives back: the body for the server and the fragments of both links. */
export interface PreparedRequest {
  body: Omit<CreateRequestBody, "expireSec" | "maxUploads" | "maxSize">;
  inboxFragment: string;
  uploadFragment: string;
}

/**
 * Builds a new request in this browser. With a password the inbox link carries the
 * protected secret and the password salt, the same scheme a password protected file uses.
 */
export async function prepareRequest(options: {
  title?: string;
  password?: string;
  argon2id?: Argon2idHashFn;
}): Promise<PreparedRequest> {
  const { local, server } = await createFileRequest({ title: options.title || undefined });

  let inboxFragment: string;
  if (options.password) {
    if (!options.argon2id) throw new Error("Argon2id is required for a password protected inbox");
    const passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
    const { key } = await deriveKeyFromPassword(options.password, passwordSalt, options.argon2id);
    inboxFragment = encodeInboxFragment(
      applyPasswordProtection(local.inboxSecret, key),
      passwordSalt,
    );
  } else {
    inboxFragment = encodeInboxFragment(local.inboxSecret);
  }

  return {
    body: {
      vault: toBase64url(server.vault),
      vaultNonce: toBase64url(server.vaultNonce),
      inboxAuthToken: toBase64url(server.inboxAuthToken),
      inboxOwnerToken: toBase64url(server.inboxOwnerToken),
      uploadToken: toBase64url(server.uploadToken),
      title: server.title
        ? {
            ciphertext: toBase64url(server.title.ciphertext),
            nonce: toBase64url(server.title.nonce),
          }
        : null,
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
  /** The file keys and the secret the download needs, or null when the entry is damaged. */
  file: { secret: Uint8Array; salt: Uint8Array; keys: DerivedKeys; metadata: FileMetadata } | null;
}

export interface OpenedInbox {
  /** The title the requester wrote, or null when there is none or it does not decrypt. */
  title: string | null;
  /** The upload link, rebuilt from the vault so it can be copied again. */
  uploadFragment: string;
  uploads: OpenedUpload[];
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
  const requestKey = await openRequestKey(
    fromBase64url(inbox.vault),
    fromBase64url(inbox.vaultNonce),
    keys.inboxKey,
  );
  const { titleKey } = await deriveLinkKeys(requestKey.linkSecret, requestKey.publicKey);

  let title: string | null = null;
  if (inbox.title) {
    try {
      title = await decryptRequestTitle(
        {
          ciphertext: fromBase64url(inbox.title.ciphertext),
          nonce: fromBase64url(inbox.title.nonce),
        },
        titleKey,
      );
    } catch {
      title = null;
    }
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
        const metadata = await decryptMetadata(
          fromBase64url(upload.encryptedMeta),
          fromBase64url(upload.metaNonce),
          fileKeys.metaKey,
        );
        // Every sender uses a client that records the archive size, and without it the
        // download could not be checked for completeness.
        if (metadata.type === "archive" && metadata.archiveSize === undefined) {
          return { upload, file: null };
        }
        return { upload, file: { secret, salt, keys: fileKeys, metadata } };
      } catch {
        return { upload, file: null };
      }
    }),
  );

  return {
    title,
    uploadFragment: encodeUploadFragment(requestKey.publicKey, requestKey.linkSecret),
    uploads,
  };
}

/**
 * A name from a sender, made safe to show and to save under: no control or format
 * characters (bidirectional overrides that make an "exe" read as "pdf", zero-width ones),
 * no lone surrogates, no path separators, no runs of spaces that push the real extension
 * out of sight, at most 255 characters, and never empty.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = Array.from(
    name
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
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
 * characters except line breaks, and no run of empty lines that could push the note
 * "not checked" out of sight above a claim further down.
 */
export function sanitizeTitle(title: string): string {
  return title
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/(?![\n])[\p{Cc}\p{Cf}\p{Cs}]/gu, "")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A MIME type from a sender, if it is a plain type/subtype. Anything else saves as bytes. */
export function sanitizeMimeType(type: string): string {
  return /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : "application/octet-stream";
}
