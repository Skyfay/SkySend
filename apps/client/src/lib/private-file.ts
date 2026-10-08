import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Writes a file only the current user may read, in a folder only they may enter. History,
 * config and session tokens hold share links with their keys, owner tokens and the OIDC session,
 * so another account on the machine must not read them (GHSA-5vjq-2637-p33f). A mode only
 * applies to what this call creates, so a file or folder an older version left behind with the
 * umask is narrowed as well.
 */
export function writePrivateFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}
