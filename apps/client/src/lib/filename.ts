import * as fs from "node:fs";
import * as path from "node:path";

/** Blank-looking characters that pad a name until its real extension is out of sight. */
const BLANK_FILLERS = /[\u2800\u3164\u115F\u1160\uFFA0]/g;
/** Combining marks stacked past what any script needs. */
const MARK_STACKS = /(\p{M}{3})\p{M}+/gu;
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
 * A file name from a sender, made safe to save under and to print. The same rules as the
 * web inbox (sanitizeFilename in apps/web/src/lib/file-request.ts), plus what a local disk
 * needs: no path separators and no characters Windows forbids, so the file lands where the
 * user chose, no leading dots, so a sender cannot plant a hidden file such as ".zshenv" in
 * the home directory, no reserved Windows device names, at most 255 bytes with the
 * extension kept, and never empty.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
    .replace(BLANK_FILLERS, " ")
    .replace(MARK_STACKS, "$1")
    .replace(/[/\\<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (cleaned === "") return "download";
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
  return shortened === "" ? `download${kept}` : `${shortened}${kept}`;
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
