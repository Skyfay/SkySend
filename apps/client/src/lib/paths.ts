import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** `~` and `~/…` as the home folder, the rest resolved against the working folder. */
export function expandPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

/**
 * The paths in text a terminal pasted, as it does when files are dropped on it: one per line or
 * several on a line, quoted ('/a b' or "/a b"), with escaped spaces (/a\ b) or as file:// URLs.
 */
export function pastedPaths(text: string): string[] {
  const words: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let word = "";
    let quote: string | null = null;
    let started = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quote) {
        if (ch === quote) quote = null;
        else word += ch;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
        started = true;
      } else if (ch === "\\" && i + 1 < line.length && process.platform !== "win32") {
        word += line[++i];
        started = true;
      } else if (/\s/.test(ch)) {
        if (started) words.push(word);
        word = "";
        started = false;
      } else {
        word += ch;
        started = true;
      }
    }
    if (started) words.push(word);
  }
  return words.map((word) => {
    if (word.startsWith("file://")) {
      try {
        return fileURLToPath(word);
      } catch {
        return word;
      }
    }
    return expandPath(word);
  });
}
