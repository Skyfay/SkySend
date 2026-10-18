import type { Command } from "commander";
import { lookUpShare, openShare, outputPathFor, saveShare } from "../lib/download-job.js";
import {
  formatBytes,
  formatSpeed,
  renderProgress,
  clearLine,
  writeProgress,
  writeLine,
  promptPassword,
  type ProgressState,
  writeJsonError,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";
import { sanitizeFilename } from "../lib/filename.js";
import { forTerminal } from "../lib/terminal.js";

interface DownloadOptions {
  output?: string;
  password?: boolean | string;
  json?: boolean;
  server?: string;
}

export function registerDownloadCommand(program: Command): void {
  program
    .command("download")
    .description("Download and decrypt a file")
    .argument("<url>", "SkySend share URL")
    .option("-o, --output <path>", "Output path (file or directory)")
    .option("-p, --password [password]", "Password (prompts if no value given)")
    .option("--json", "Output as JSON")
    .action(async (url: string, options: DownloadOptions) => {
      try {
        if (!options.json) writeLine("Fetching file info...");
        const { link, info } = await lookUpShare(url);

        let password: string | undefined;
        if (info.hasPassword) {
          if (options.password === true) {
            password = await promptPassword("Password: ");
          } else if (typeof options.password === "string") {
            password = options.password;
          } else {
            password = await promptPassword("This file is password protected. Password: ");
          }
        }

        if (!options.json) writeLine("Deriving keys...");
        const share = await openShare(link, info, password);
        const outputPath = outputPathFor(share.metadata, options.output);
        if (!options.json) writeLine(`Downloading to: ${forTerminal(outputPath)}`);

        const progress: ProgressState = { loaded: 0, total: 0, startTime: Date.now() };
        const saved = await saveShare(share, outputPath, (written, total) => {
          progress.loaded = written;
          progress.total = total;
          if (!options.json) writeProgress(renderProgress(progress, "Downloading"));
        });
        if (!options.json) {
          clearLine();
          writeLine("Download complete.");
        }

        const name =
          share.metadata.type === "single" ? sanitizeFilename(share.metadata.name) : "archive.zip";
        const elapsedSec = (Date.now() - progress.startTime) / 1000;
        if (options.json) {
          console.log(
            JSON.stringify({
              id: link.id,
              file: saved.file,
              size: saved.size,
              name,
              fileCount: info.fileCount,
            }),
          );
        } else {
          const avgSpeed =
            elapsedSec > 0 && saved.size > 0
              ? ` | Avg speed: ${formatSpeed(saved.size / elapsedSec)}`
              : "";
          writeLine(`Saved: ${forTerminal(saved.file)} (${formatBytes(saved.size)})${avgSpeed}`);
          if (share.metadata.type === "archive") {
            writeLine(`Archive contains ${share.metadata.files.length} files`);
          }
        }
      } catch (err) {
        if (!options.json) clearLine();
        if (err instanceof ApiError) {
          if (options.json) {
            writeJsonError({ error: err.message, status: err.status });
          } else {
            console.error(`Error: ${err.message} (HTTP ${err.status})`);
          }
        } else {
          const message = forTerminal(err instanceof Error ? err.message : String(err));
          if (options.json) {
            writeJsonError({ error: message });
          } else {
            console.error(`Error: ${message}`);
          }
        }
        process.exit(1);
      }
    });
}
