import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeFilename as cleanName } from "@skysend/transfer";

/**
 * Device names Windows reserves in every directory, with or without an extension. Windows
 * also counts the superscript digits one to three as port numbers.
 */
const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[1-9\u00B9\u00B2\u00B3])(\..*)?$/i;
/** Most file systems cap a single name at 255 bytes. */
const MAX_NAME_BYTES = 255;
/** An extension longer than this is not worth keeping when a name has to be shortened. */
const MAX_KEPT_EXTENSION_BYTES = 32;

/**
 * A file name from a sender, made safe to save under and to print. First the rules the web
 * inbox shows names by (`sanitizeFilename` of @skysend/transfer: no control or format
 * characters, no path separators, no padding that hides the extension, no dots or spaces at
 * either end, never empty), then what a local disk needs: no characters Windows forbids, so
 * the file lands where the user chose, no reserved Windows device names, and at most 255
 * bytes with the extension kept. No dot at the start either, so a sender cannot plant a
 * hidden file such as ".zshenv" in the home directory.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = cleanName(name).replace(/[<>:"|?*]/g, "_");
  return limitBytes(WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned);
}

function limitBytes(name: string): string {
  if (Buffer.byteLength(name) <= MAX_NAME_BYTES) return name;
  const extension = path.extname(name);
  const kept = Buffer.byteLength(extension) <= MAX_KEPT_EXTENSION_BYTES ? extension : "";
  // Every code point takes at least one byte, so no more than the limit can survive.
  const stem = Array.from(name.slice(0, name.length - kept.length)).slice(0, MAX_NAME_BYTES);
  while (stem.length > 0 && Buffer.byteLength(stem.join("") + kept) > MAX_NAME_BYTES) stem.pop();
  const shortened = stem.join("").replace(/[\s.]+$/, "");
  return shortened === "" ? `file${kept}` : `${shortened}${kept}`;
}

/** Whether anything sits at the path, a dangling symbolic link included. */
function occupied(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * A path in dir under the given name that nothing occupies yet, with " (1)", " (2)" and so
 * on before the extension when it is taken, the way a browser saves a download. The sender
 * picks the name, so a download never replaces a file the user already has.
 */
export function availablePath(dir: string, name: string): string {
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = path.join(dir, name);
  for (let i = 1; occupied(candidate); i++) {
    candidate = path.join(dir, `${stem} (${i})${extension}`);
  }
  return candidate;
}
