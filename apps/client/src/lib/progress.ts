import * as readline from "node:readline";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${UNITS[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatExpiry(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${seconds / 60} minutes`;
  if (seconds < 86400) return `${seconds / 3600} hours`;
  return `${seconds / 86400} days`;
}

// ── Progress Bar ───────────────────────────────────────

export interface ProgressState {
  loaded: number;
  total: number;
  startTime: number;
}

export function renderProgress(state: ProgressState, label: string): string {
  const { loaded, total, startTime } = state;
  const elapsed = (Date.now() - startTime) / 1000;
  const speed = elapsed > 0 ? loaded / elapsed : 0;
  const remaining = speed > 0 ? (total - loaded) / speed : 0;
  const percent = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;

  const barWidth = 30;
  const filled = Math.round((percent / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  return `${label} ${bar} ${percent.toFixed(1)}% ${formatBytes(loaded)}/${formatBytes(total)} ${formatSpeed(speed)} ETA ${formatDuration(remaining)}`;
}

export function clearLine(): void {
  process.stderr.write("\r\x1b[K");
}

export function writeProgress(line: string): void {
  process.stderr.write(`\r\x1b[K${line}`);
}

export function writeLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

// ── Duration Parsing ───────────────────────────────────

const DURATION_MAP: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)\s*([smhdw])$/i);
  if (!match) {
    const num = parseInt(input, 10);
    if (isNaN(num)) throw new Error(`Invalid duration: ${input}`);
    return num;
  }
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const multiplier = DURATION_MAP[unit];
  if (!multiplier) throw new Error(`Invalid duration unit: ${unit}`);
  return value * multiplier;
}

// ── Interactive Password Prompt ────────────────────────

export function promptPassword(prompt: string = "Password: "): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });

    // Disable echo
    if (process.stdin.isTTY) {
      process.stderr.write(prompt);
      process.stdin.setRawMode(true);
      let password = "";
      const onData = (data: Buffer) => {
        const char = data.toString("utf-8");
        if (char === "\n" || char === "\r" || char === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          rl.close();
          resolve(password);
        } else if (char === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", onData);
          rl.close();
          reject(new Error("Aborted"));
        } else if (char === "\u007F" || char === "\b") {
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += char;
        }
      };
      process.stdin.on("data", onData);
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}
