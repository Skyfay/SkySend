import type { Readable } from "node:stream";

/** Note types whose content spans lines, which a prompt that ends at the first line cannot take. */
const MULTILINE_TYPES = new Set(["code", "markdown", "sshkey"]);

/**
 * Where the content of a note comes from when it is not an argument. An argument lands in the
 * shell history and, while the command runs, in the process list other local users can read.
 * Piped or redirected input and a prompt that does not echo avoid both.
 */
export type NoteSource = "pipe" | "prompt";

/** A pipe or a redirected file when stdin is no terminal, else a prompt for one line. */
export function noteSource(type: string, stdinIsTTY: boolean): NoteSource {
  if (!stdinIsTTY) return "pipe";
  if (MULTILINE_TYPES.has(type)) {
    throw new Error(
      `A ${type} note spans lines, so pipe it in or redirect a file: skysend note --type ${type} < file`,
    );
  }
  return "prompt";
}

/**
 * Whether the command will ask for a password at a prompt: `-p` without a value, or a server
 * that requires a password when none was given. A prompt needs the terminal, so it cannot follow
 * a note that came through a pipe.
 */
export function asksForPassword(
  password: boolean | string | undefined,
  required: boolean,
): boolean {
  return password === true || (required && typeof password !== "string");
}

/** Everything a stream holds until it ends, as UTF-8. */
export async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Drops the one line break that `echo`, a shell or an editor adds at the end. */
export function withoutFinalNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}
