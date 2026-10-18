/**
 * @skysend/transfer - Public API
 *
 * What an upload, a download, a note and a file request need besides the cryptography, for the
 * web app, the CLI and later the mobile app. Only standard APIs (Web Crypto, Web Streams, fetch, WebSocket), so it
 * runs in a browser, a worker, Node and a Bun-compiled binary. Nothing outside this package
 * imports a submodule.
 */

// Several files as one zip, written while the upload reads it
export { crc32, zipSize, zipStream } from "./zip.js";
export type { ZipEntry, ZipEntryInfo } from "./zip.js";

// The metadata of an upload of several files
export { archiveMetadata, archiveMetadataFits, uniqueNames } from "./archive.js";

// An upload from plaintext to link, over WebSocket or HTTP chunks
export {
  CHUNK_UPLOAD_SIZE,
  CHUNK_WINDOW,
  plaintextOf,
  requestHttpError,
  toBase64,
  uploadEncrypted,
} from "./upload.js";
export type {
  DeliveredUpload,
  OpenWebSocket,
  RequestTarget,
  SharedUpload,
  SourceFile,
  UploadEvents,
  UploadOptions,
} from "./upload.js";

// The keys and metadata of a download, and its checked decryption
export {
  decryptedStream,
  decryptUploadMetadata,
  fromBase64,
  keysFromLink,
  keysFromSecret,
} from "./download.js";
export type { LinkKeys, LinkPassword } from "./download.js";

// A note from its plaintext to the link and back to its blocks
export { createEncryptedNote, openNote } from "./note.js";
export type { NoteOptions, OpenedNote, OpenNoteOptions, SharedNote } from "./note.js";

// A file request: creating one, and reading its upload link as a sender
export { briefFits, newSubmission, openRequestLink, prepareRequest } from "./request.js";
export type { OpenedRequestLink, PreparedRequest, RequestAccess, SenderBrief } from "./request.js";

// The inbox of a file request, opened with the key in its link
export {
  groupBySubmission,
  inboxNeedsPassword,
  noteTooLarge,
  NoteTooLargeError,
  openInbox,
  openInboxLink,
  readInboxNote,
} from "./inbox.js";
export type { InboxAccess, OpenedInbox, OpenedUpload } from "./inbox.js";

// Names and titles from someone else, made safe to show
export { sanitizeFilename, sanitizeTitle } from "./names.js";

// The links of an instance, with the key in the fragment
export { buildShareLink, parseShareLink } from "./links.js";
export type { LinkType, ShareLink } from "./links.js";

// The HTTP API of a server, with every response checked
export { ApiError, createApiClient, holdOf, isUploadId, withUnlockedMeta } from "./api.js";
export type {
  ApiClient,
  ApiClientOptions,
  Ciphertext,
  CreateNoteRequest,
  CreateNoteResponse,
  CreateRequestBody,
  Inbox,
  InboxUpload,
  NoteInfo,
  NoteViewResponse,
  OidcUser,
  QuotaStatus,
  RequestLimit,
  SenderRequest,
  ServerConfig,
  UnlockedMeta,
  UploadInfo,
  UploadTarget,
} from "./api.js";
