import { logger } from "hono/logger";

/**
 * A share link carries its key in the URL fragment, which browsers never send.
 * Mail security gateways break that: Microsoft Defender Safe Links and similar
 * products rewrite "/file/<id>#<key>" into "/file/<id>%23<key>", turning the key
 * into part of the request path. The request then arrives with the key in its
 * request line, before any application code can intervene.
 *
 * Nothing can stop that request. What we can stop is writing the key to disk.
 * Hono's logger derives its path from the raw, still percent-encoded URL, so the
 * key would otherwise appear in every log line for such a request.
 *
 * Everything after a file, note, or legacy download ID is therefore dropped. The
 * pattern is deliberately wider than "%23" so any other appended value is cut too.
 * `\S*` stops at whitespace, which keeps the status code and the elapsed time on
 * the outgoing line intact.
 */
const SENSITIVE_PATH = /(\/(?:file|note|d)\/[0-9a-fA-F-]{36})\S*/g;

/**
 * Remove anything a share-link path carries beyond its resource ID.
 */
export function redactSensitivePath(line: string): string {
  return line.replace(SENSITIVE_PATH, "$1");
}

/**
 * Request logger that records method, path, status, and duration, with share-link
 * paths truncated at the resource ID. No IP addresses, no keys, no tokens.
 */
export function createRequestLogger() {
  return logger((message, ...rest) => {
    console.log(redactSensitivePath(message), ...rest);
  });
}
