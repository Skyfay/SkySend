import { createApiClient, type ApiClient } from "@skysend/transfer";
import { forTerminal } from "./terminal.js";

export { withUnlockedMeta } from "@skysend/transfer";
export type {
  CreateNoteRequest,
  NoteInfo,
  NoteViewResponse,
  QuotaStatus,
  ServerConfig,
  UnlockedMeta,
  UploadInfo,
} from "@skysend/transfer";

/**
 * The API of one server, from `@skysend/transfer` like the web app's. The message of every
 * ApiError is the server's word and gets printed, so it is disarmed for the terminal before it is
 * thrown. `oidcToken` goes only to the routes that create something.
 */
export function apiFor(server: string, oidcToken?: string): ApiClient {
  return createApiClient({
    baseUrl: server,
    cleanMessage: forTerminal,
    ...(oidcToken ? { bearer: oidcToken } : {}),
  });
}
