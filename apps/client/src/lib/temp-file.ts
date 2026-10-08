import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface PrivateTempFile {
  path: string;
  fd: number;
  /** Closes the file descriptor. Safe to call more than once. */
  close: () => void;
  /** Closes the file and removes it with its directory. Safe to call more than once. */
  cleanup: () => void;
}

/**
 * A temporary file only the current user can read, for plaintext that has to touch the
 * disk before it is encrypted. It sits in a fresh directory with mode 0700 and is created
 * with mode 0600, so a shared /tmp exposes nothing to other local users. It is also removed
 * when the process exits, which covers Ctrl+C in the TUI: Ink ends the process through
 * process.exit() before any finally block of a running upload gets to run.
 */
export function createPrivateTempFile(name: string): PrivateTempFile {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skysend-"));
  const filePath = path.join(dir, name);
  let fd: number;
  try {
    // mkdtemp creates the directory with 0700 already. Set it again so no runtime differs.
    fs.chmodSync(dir, 0o700);
    fd = fs.openSync(filePath, "wx", 0o600);
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    fs.closeSync(fd);
  };
  const cleanup = () => {
    process.removeListener("exit", cleanup);
    try {
      close();
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort. Windows refuses to remove a file another handle still reads.
    }
  };
  process.on("exit", cleanup);
  return { path: filePath, fd, close, cleanup };
}
