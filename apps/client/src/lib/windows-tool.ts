import { win32 } from "node:path";

/**
 * The full path of a program in the System32 folder of Windows.
 *
 * Windows looks for a program named without a path in the current folder first, and so does the
 * spawn of Node and Bun. The CLI saves a download into the current folder by default, under the name
 * the sender chose, so a received `clip.exe` ran instead of the real one on the next copy. Every
 * program the CLI starts on Windows therefore goes by its full path.
 */
export function systemTool(name: string): string {
  return win32.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", name);
}
