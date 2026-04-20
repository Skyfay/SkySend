import type { Command } from "commander";
import { getUploads, getNotes, cleanupExpired } from "../lib/history.js";
import { resolveServer } from "../lib/config.js";
import { formatBytes, writeLine } from "../lib/progress.js";

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimeRemaining(isoDate: string, expireSec: number): string {
  const expiresAt = new Date(isoDate).getTime() + expireSec * 1000;
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface LsOptions {
  server?: string;
  all?: boolean;
  json?: boolean;
}

export function registerLsCommand(program: Command): void {
  program
    .command("ls")
    .description("List upload and note history")
    .option("-s, --server <url>", "Filter by server URL")
    .option("-a, --all", "Show entries for all servers")
    .option("--json", "Output as JSON")
    .action((options: LsOptions) => {
      const cleaned = cleanupExpired();

      let serverFilter: string | undefined;
      if (!options.all) {
        try {
          serverFilter = options.server ?? resolveServer();
        } catch {
          // No server configured - show all
        }
      }

      const uploads = getUploads().filter((u) => !serverFilter || u.server === serverFilter);
      const notes = getNotes().filter((n) => !serverFilter || n.server === serverFilter);

      if (options.json) {
        process.stdout.write(JSON.stringify({ uploads, notes }, null, 2) + "\n");
        return;
      }

      if (cleaned.removedUploads > 0 || cleaned.removedNotes > 0) {
        const parts: string[] = [];
        if (cleaned.removedUploads > 0) parts.push(`${cleaned.removedUploads} upload(s)`);
        if (cleaned.removedNotes > 0) parts.push(`${cleaned.removedNotes} note(s)`);
        writeLine(`Cleaned ${parts.join(" and ")} (expired)\n`);
      }

      if (uploads.length === 0 && notes.length === 0) {
        writeLine("No uploads or notes in history.");
        if (serverFilter) writeLine(`  Server: ${serverFilter}`);
        writeLine("  Use --all to show entries for all servers.");
        return;
      }

      // Combine and sort by date
      const entries: Array<{ type: "file" | "note"; date: string; line: string }> = [];

      for (const u of uploads) {
        const names = u.fileNames.join(", ");
        const ttl = formatTimeRemaining(u.createdAt, u.expireSec);
        const pw = u.hasPassword ? " [pw]" : "";
        entries.push({
          type: "file",
          date: u.createdAt,
          line: `[File]  ${names}  ${formatBytes(u.totalSize)}${pw}  ${formatAge(u.createdAt)}  expires: ${ttl}`,
        });
      }

      for (const n of notes) {
        const ttl = formatTimeRemaining(n.createdAt, n.expireSec);
        const pw = n.hasPassword ? " [pw]" : "";
        entries.push({
          type: "note",
          date: n.createdAt,
          line: `[Note]  ${n.contentType}${pw}  ${formatAge(n.createdAt)}  expires: ${ttl}`,
        });
      }

      entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      if (serverFilter) {
        writeLine(`Server: ${serverFilter}\n`);
      }

      writeLine(`${uploads.length} file(s), ${notes.length} note(s)\n`);

      for (const entry of entries) {
        writeLine(entry.line);
      }
    });
}
