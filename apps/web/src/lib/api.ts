/**
 * The page's link to the server it came from. Every other module of the page talks to the server
 * through these functions. The requests, their Zod schemas and ApiError live in
 * `@skysend/transfer`, shared with the CLI. The upload worker and the download tiers make a client
 * of their own, since they reach the server directly in development.
 */
import { createApiClient } from "@skysend/transfer";

export { ApiError } from "@skysend/transfer";
export type {
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
} from "@skysend/transfer";

// Same origin, so the OIDC session travels as the cookie.
const api = createApiClient({ baseUrl: "" });

export const {
  fetchConfig,
  fetchQuota,
  fetchRequestLimit,
  fetchInfo,
  verifyPassword,
  downloadFile,
  deleteUpload,
  createNote,
  fetchNoteInfo,
  viewNote,
  verifyNotePassword,
  deleteNote,
  createRequest,
  fetchRequestForSender,
  fetchInbox,
  inboxFilePath,
  downloadInboxFile,
  deleteInboxFile,
  closeRequest,
  deleteRequest,
  fetchAuthSession,
} = api;
