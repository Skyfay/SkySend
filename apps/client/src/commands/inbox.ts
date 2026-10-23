import * as fs from "node:fs";
import type { Command } from "commander";
import type { OpenedUpload } from "@skysend/transfer";
import {
  describeEntry,
  inboxEntries,
  openInboxFrom,
  readInboxLink,
  saveEntry,
  savePathFor,
} from "../lib/inbox-job.js";
import {
  clearLine,
  formatBytes,
  promptPassword,
  renderProgress,
  writeLine,
  writeProgress,
  type ProgressState,
  writeJsonError,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";
import { sanitizeFilename } from "../lib/filename.js";
import { forTerminal } from "../lib/terminal.js";

interface InboxOptions {
  save?: string;
  password?: boolean | string;
  json?: boolean;
}

/** The plaintext size of an upload where its metadata names one, else what the server stores. */
function sizeOf(entry: OpenedUpload): number {
  const metadata = entry.file?.metadata;
  if (metadata?.type === "archive") return metadata.archiveSize ?? entry.upload.size;
  return metadata?.size ?? entry.upload.size;
}

/** An upload as one object of `--json`. Names come from a sender and are cleaned. */
function entryJson(entry: OpenedUpload, submission: number) {
  const metadata = entry.file?.metadata;
  return {
    id: entry.upload.id,
    submission,
    type: metadata ? metadata.type : "damaged",
    ...(metadata?.type === "single" ? { name: describeEntry(entry) } : {}),
    // JSON escapes ESC but not the C1 controls or the reordering marks a sender can put in.
    ...(metadata?.type === "archive"
      ? { files: metadata.files.map((f) => sanitizeFilename(f.name)) }
      : {}),
    size: sizeOf(entry),
    downloads: entry.upload.downloadCount,
    maxDownloads: entry.upload.maxDownloads,
    createdAt: entry.upload.createdAt,
  };
}

export function registerInboxCommand(program: Command): void {
  program
    .command("inbox")
    .description("List what arrived in a file request, and save it with --save")
    .argument("<link>", "The inbox link of the file request")
    .option("--save <dir>", "Save every upload into this folder")
    .option("-p, --password [password]", "Password of the inbox (prompts if no value given)")
    .option("--json", "Output as JSON")
    .action(async (link: string, options: InboxOptions) => {
      try {
        let password: string | undefined;
        if (readInboxLink(link).needsPassword) {
          password =
            typeof options.password === "string"
              ? options.password
              : await promptPassword(
                  options.password === true
                    ? "Password: "
                    : "This inbox has a password. Password: ",
                );
        }
        const inbox = await openInboxFrom(link, password);
        const groups = inboxEntries(inbox);
        const title = inbox.opened.title ? forTerminal(inbox.opened.title) : null;

        // Listing downloads nothing, so it never uses up a download of the request.
        if (!options.save) {
          if (options.json) {
            console.log(
              JSON.stringify({
                title: inbox.opened.title,
                asks: inbox.opened.asks,
                uploads: groups.flatMap((group, i) =>
                  group.map((entry) => entryJson(entry, i + 1)),
                ),
              }),
            );
            return;
          }
          writeLine(title ? `Request: ${title}` : "The inbox of a file request");
          if (groups.length === 0) {
            writeLine("Nothing arrived yet.");
            return;
          }
          groups.forEach((group, i) => {
            group.forEach((entry, j) => {
              const number = j === 0 ? String(i + 1).padStart(3) : "   ";
              const downloads = `downloaded ${entry.upload.downloadCount} of ${entry.upload.maxDownloads}`;
              writeLine(
                `${number}  ${forTerminal(describeEntry(entry))}  ${formatBytes(sizeOf(entry))}  ${downloads}`,
              );
            });
          });
          writeLine("");
          writeLine("Save everything with --save <folder>. Each save counts as a download.");
          return;
        }

        const dir = options.save;
        fs.mkdirSync(dir, { recursive: true });
        const saved: Array<{ id: string; file: string; size: number }> = [];
        const failed: Array<{ id: string; error: string }> = [];
        for (const entry of groups.flat()) {
          if (!entry.file) {
            failed.push({ id: entry.upload.id, error: "damaged, it cannot be opened" });
            continue;
          }
          const progress: ProgressState = { loaded: 0, total: 0, startTime: Date.now() };
          try {
            const result = await saveEntry(
              inbox,
              entry,
              savePathFor(entry, dir),
              (written, total) => {
                progress.loaded = written;
                progress.total = total;
                if (!options.json) writeProgress(renderProgress(progress, "Saving"));
              },
            );
            saved.push({ id: entry.upload.id, ...result });
            if (!options.json) {
              clearLine();
              writeLine(`Saved ${forTerminal(result.file)} (${formatBytes(result.size)})`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            failed.push({ id: entry.upload.id, error: message });
            if (!options.json) {
              clearLine();
              writeLine(`Not saved: ${forTerminal(describeEntry(entry))}, ${forTerminal(message)}`);
            }
          }
        }
        if (options.json) {
          console.log(
            JSON.stringify({
              saved,
              failed: failed.map((f) => ({ ...f, error: forTerminal(f.error) })),
            }),
          );
        } else if (saved.length === 0 && failed.length === 0) {
          writeLine("Nothing arrived yet.");
        }
        if (failed.length > 0) process.exit(1);
      } catch (err) {
        if (!options.json) clearLine();
        if (err instanceof ApiError) {
          if (options.json) writeJsonError({ error: err.message, status: err.status });
          else console.error(`Error: ${err.message} (HTTP ${err.status})`);
        } else {
          const message = forTerminal(err instanceof Error ? err.message : String(err));
          if (options.json) writeJsonError({ error: message });
          else console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
    });
}
