import { spawnSync } from "node:child_process";

/** The clipboard tools to try per platform, each reading the text from stdin. */
export function clipboardTools(platform: NodeJS.Platform = process.platform): Array<[string, string[]]> {
  if (platform === "darwin") return [["pbcopy", []]];
  if (platform === "win32") return [["clip", []]];
  return [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ];
}

/**
 * Puts `text` on the clipboard: through a tool of the system, and always also to the terminal as
 * OSC 52, which most terminals put on the clipboard of the machine in front of the user and the
 * rest ignore. Both, because a tool can succeed on the wrong machine: over SSH with a DISPLAY, or
 * in a remote editor whose terminals point at a virtual display. The text is never passed as an
 * argument, where other users of the machine could read it from the process list.
 */
export function copyToClipboard(
  text: string,
  write: (data: string) => void = (data) => process.stdout.write(data),
  tools: Array<[string, string[]]> = clipboardTools(),
): "system" | "terminal" {
  write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
  for (const [command, args] of tools) {
    const result = spawnSync(command, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 2000 });
    if (!result.error && result.status === 0) return "system";
  }
  return "terminal";
}
