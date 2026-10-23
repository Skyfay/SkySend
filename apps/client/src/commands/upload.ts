import * as fs from "node:fs";
import type { Command } from "commander";
import { calculateEncryptedSize } from "@skysend/crypto";
import { apiFor } from "../lib/api.js";
import { getWebSocket, resolveServer } from "../lib/config.js";
import { ensureOidcAuth } from "../lib/oidc.js";
import {
  formatBytes,
  formatSpeed,
  formatExpiry,
  parseDuration,
  renderProgress,
  clearLine,
  writeProgress,
  writeLine,
  promptPassword,
  type ProgressState,
  writeJsonError,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";
import { addUpload } from "../lib/history.js";
import { openRequest, runRequestUpload, runUpload } from "../lib/upload-job.js";
import { forTerminal } from "../lib/terminal.js";
import { checkNewPassword } from "../lib/input.js";

interface UploadOptions {
  server?: string;
  expires?: string;
  downloads?: string;
  password?: boolean | string;
  json?: boolean;
  /** False with --no-ws. Commander stores a negated flag under its positive name. */
  ws?: boolean;
  /** The upload link of a file request to send into. */
  to?: string;
}

/**
 * Sends files into a file request. The request decides how long they stay, how often they are
 * downloaded and that only its inbox opens them, so none of that is asked here.
 */
async function sendToRequest(files: string[], link: string, options: UploadOptions): Promise<void> {
  if (options.expires || options.downloads || options.password !== undefined || options.server) {
    throw new Error(
      "A request sets how long its files stay and who opens them, so --to goes without --expires, --downloads, --password and --server.",
    );
  }
  const request = await openRequest(link);
  if (!options.json) {
    const host = new URL(request.server).host;
    writeLine(request.brief.title ? `Request: ${forTerminal(request.brief.title)}` : `A file request on ${forTerminal(host)}`);
    writeLine(
      `Takes ${request.status.uploadsLeft === 1 ? "1 more upload" : `${request.status.uploadsLeft} more uploads`} of up to ${formatBytes(request.status.maxUploadSize)}.`,
    );
  }

  const progress: ProgressState = { loaded: 0, total: 0, startTime: Date.now() };
  let uploadEndTime = 0;
  const result = await runRequestUpload(
    { request, paths: files, webSocket: options.ws !== false && getWebSocket(request.server) },
    {
      onProgress: (loaded, total) => {
        progress.loaded = loaded;
        progress.total = total;
        if (!options.json) writeProgress(renderProgress(progress, "Uploading"));
      },
      onPhase: (phase) => {
        if (phase !== "saving-meta" || uploadEndTime > 0) return;
        uploadEndTime = Date.now();
        if (!options.json) writeProgress("Finalizing...");
      },
    },
  );

  if (options.json) {
    console.log(
      JSON.stringify({
        delivered: true,
        id: result.id,
        size: result.size,
        fileCount: result.fileCount,
        transport: result.transport,
      }),
    );
    return;
  }
  clearLine();
  const elapsedSec = ((uploadEndTime || Date.now()) - progress.startTime) / 1000;
  const avgSpeed = elapsedSec > 0 ? ` | Avg speed: ${formatSpeed(calculateEncryptedSize(result.size) / elapsedSec)}` : "";
  writeLine("Delivered. Only whoever made the request can open it.");
  writeLine(`Files: ${result.fileCount} | Size: ${formatBytes(result.size)}${avgSpeed}`);
}

export function registerUploadCommand(program: Command): void {
  program
    .command("upload")
    .description("Upload file(s) with end-to-end encryption")
    .argument("<files...>", "Files or folders to upload")
    .option("-s, --server <url>", "Server URL")
    .option("-e, --expires <duration>", "Expiry time (e.g. 5m, 1h, 1d, 7d)")
    .option("-d, --downloads <count>", "Max download count")
    .option("-p, --password [password]", "Password protect (prompts if no value given)")
    .option("--no-ws", "Disable WebSocket transport, use HTTP chunked upload")
    .option("--to <link>", "Send into a file request, from its upload link")
    .option("--json", "Output as JSON")
    .action(async (files: string[], options: UploadOptions) => {
      try {
        for (const file of files) {
          if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
          const stat = fs.statSync(file);
          if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Not a file or folder: ${file}`);
        }

        if (options.to !== undefined) {
          await sendToRequest(files, options.to, options);
          return;
        }

        const server = resolveServer(options.server);

        const config = await apiFor(server).fetchConfig();

        // Authenticate with OIDC if the server requires it for file uploads
        let oidcToken: string | undefined;
        if (config.oidcProtectFiles) {
          if (!options.json) writeLine("Server requires authentication...");
          oidcToken = await ensureOidcAuth(server);
        }

        let password: string | undefined;
        if (options.password === true) {
          password = await promptPassword("Password: ");
        } else if (typeof options.password === "string") {
          password = options.password;
        } else if (config.forceFilePassword) {
          if (!options.json) writeLine("Password is required by server policy.");
          password = await promptPassword("Password: ");
        }

        // A new password has to hold against guessing with the link and the server's database.
        if (password !== undefined) {
          const problem = checkNewPassword(password);
          if (problem !== true) throw new Error(problem);
        }

        const expireSec = options.expires ? parseDuration(options.expires) : config.fileDefaultExpire;
        if (!config.fileExpireOptions.includes(expireSec)) {
          throw new Error(
            `Invalid expiry. Options: ${config.fileExpireOptions.map((s) => `${s}s`).join(", ")}`,
          );
        }

        const maxDownloads = options.downloads
          ? parseInt(options.downloads, 10)
          : config.fileDefaultDownload;
        if (!config.fileDownloadOptions.includes(maxDownloads)) {
          throw new Error(
            `Invalid download count. Options: ${config.fileDownloadOptions.join(", ")}`,
          );
        }

        const progress: ProgressState = { loaded: 0, total: 0, startTime: Date.now() };
        let uploadEndTime = 0;
        const result = await runUpload(
          {
            server,
            paths: files,
            config,
            expireSec,
            maxDownloads,
            ...(password !== undefined ? { password } : {}),
            ...(oidcToken ? { oidcToken } : {}),
            webSocket: options.ws !== false && getWebSocket(server),
          },
          {
            onProgress: (loaded, total) => {
              progress.loaded = loaded;
              progress.total = total;
              if (!options.json) writeProgress(renderProgress(progress, "Uploading"));
            },
            onPhase: (phase) => {
              if (phase !== "saving-meta" || uploadEndTime > 0) return;
              uploadEndTime = Date.now();
              if (!options.json) writeProgress("Finalizing...");
            },
          },
        );
        if (!options.json) {
          clearLine();
          writeLine("Upload complete.");
        }

        addUpload({
          id: result.id,
          server,
          url: result.url,
          ownerToken: result.ownerToken,
          fileNames: result.names,
          totalSize: result.totalSize,
          hasPassword: result.hasPassword,
          createdAt: new Date().toISOString(),
          expireSec,
        });

        const encryptedSize = calculateEncryptedSize(result.size);
        if (options.json) {
          console.log(
            JSON.stringify({
              id: result.id,
              url: result.url,
              ownerToken: result.ownerToken,
              size: result.size,
              encryptedSize,
              fileCount: result.fileCount,
              expires: expireSec,
              maxDownloads,
              hasPassword: result.hasPassword,
              transport: result.transport,
            }),
          );
        } else {
          const elapsedSec = ((uploadEndTime || Date.now()) - progress.startTime) / 1000;
          const avgSpeed =
            elapsedSec > 0 ? ` | Avg speed: ${formatSpeed(encryptedSize / elapsedSec)}` : "";
          writeLine("");
          writeLine(`Share URL: ${result.url}`);
          writeLine(
            `Files: ${result.fileCount} | Size: ${formatBytes(result.size)} | Expires: ${formatExpiry(expireSec)} | Downloads: ${maxDownloads}${avgSpeed}`,
          );
          if (result.hasPassword) writeLine("Password protected: yes");
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
