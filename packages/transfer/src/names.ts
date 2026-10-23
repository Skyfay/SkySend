/**
 * Names and titles from someone else, made safe to show: the file names of a sender, the title
 * of a requester. The web app shows them as they come out of here, the CLI adds the rules of a
 * local disk on top.
 */

/** Characters that draw as blank space but are no whitespace: the Braille blank, Hangul fillers. */
const BLANK_FILLERS = /[\u2800\u3164\u115F\u1160\uFFA0]/g;
/** Combining marks stacked past what any script needs, which spill over the lines around them. */
const MARK_STACKS = /(\p{M}{3})\p{M}+/gu;

/** The most characters a name from a sender keeps. */
const MAX_NAME_LENGTH = 255;
/** An extension longer than this is not worth keeping when a name has to be shortened. */
const MAX_KEPT_EXTENSION_LENGTH = 32;

/**
 * A name from a sender, made safe to show and to save under: no control or format
 * characters (bidirectional overrides that make an "exe" read as "pdf", zero-width ones),
 * no lone surrogates, no path separators, no runs of spaces or blank fillers that push the
 * real extension out of sight, no towers of combining marks, no dots or spaces at either end,
 * at most 255 characters with the extension kept, and never empty. Windows drops trailing
 * dots on save, so "invoice.pdf.exe." would show as one thing and land as an exe. The CLI
 * adds what a local disk needs (apps/client/src/lib/filename.ts).
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
    .replace(BLANK_FILLERS, " ")
    .replace(MARK_STACKS, "$1")
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, " ");
  const trimmed = trimDotsAndSpaces(cleaned);
  return trimmed === "" ? "file" : shortenName(trimmed);
}

/**
 * Drops dots and whitespace at both ends, in time linear in the length. The regex
 * `[\s.]+$` this replaces tried every position of a long run of dots and failed at the end of
 * each, quadratic in the run: a name of 73,000 dots between two letters, which the metadata
 * limit allows, held the main thread for over a second on every render of the inbox.
 */
function trimDotsAndSpaces(name: string): string {
  const trimmable = (i: number) => name[i] === "." || /\s/.test(name[i]!);
  let start = 0;
  let end = name.length;
  while (start < end && trimmable(start)) start++;
  while (end > start && trimmable(end - 1)) end--;
  return name.slice(start, end);
}

/** A name cut to MAX_NAME_LENGTH characters with its extension kept, never inside a character. */
function shortenName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= MAX_NAME_LENGTH) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? Array.from(name.slice(dot)) : [];
  const kept = extension.length <= MAX_KEPT_EXTENSION_LENGTH ? extension : [];
  const stem = trimDotsAndSpaces(chars.slice(0, MAX_NAME_LENGTH - kept.length).join(""));
  return `${stem || "file"}${kept.join("")}`;
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
