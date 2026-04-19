import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  createDecryptStream,
  decryptMetadata,
  type FileMetadata,
} from "@skysend/crypto";
import {
  fetchInfo,
  downloadFile,
  verifyPassword,
} from "../lib/api.js";
import { prepareDownload } from "../lib/auth.js";
import { parseShareUrl } from "../lib/url.js";
import {
  formatBytes,
  renderProgress,
  clearLine,
  writeProgress,
  writeLine,
  promptPassword,
  type ProgressState,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";

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
        // Parse the share URL
        const parsed = parseShareUrl(url);
        const server = parsed.server;

        if (parsed.type !== "file") {
          throw new Error("This URL is a note, not a file. Use 'skysend note:view' instead.");
        }

        // Fetch upload info
        if (!options.json) writeLine("Fetching file info...");
        const info = await fetchInfo(server, parsed.id);

        // Handle password
        let password: string | undefined;
        if (info.hasPassword) {
          if (options.password === true) {
            password = await promptPassword("Password: ");
          } else if (typeof options.password === "string") {
            password = options.password;
          } else {
            password = await promptPassword("This file is password protected. Password: ");
          }
          if (!password) throw new Error("Password is required for this file");
        }

        // Derive keys
        if (!options.json) writeLine("Deriving keys...");
        const creds = await prepareDownload(
          parsed.secret,
          info.salt,
          password,
          info.passwordSalt,
          info.passwordAlgo,
        );

        // Verify password if needed
        if (info.hasPassword) {
          const valid = await verifyPassword(server, parsed.id, creds.authTokenB64);
          if (!valid) throw new Error("Invalid password");
        }

        // Decrypt metadata
        let metadata: FileMetadata | undefined;
        if (info.encryptedMeta && info.nonce) {
          const ciphertext = new Uint8Array(
            Buffer.from(info.encryptedMeta, "base64"),
          ) as Uint8Array<ArrayBuffer>;
          const iv = new Uint8Array(
            Buffer.from(info.nonce, "base64"),
          ) as Uint8Array<ArrayBuffer>;
          metadata = await decryptMetadata(ciphertext, iv, creds.keys.metaKey);
        }

        // Determine output path
        let outputPath: string;
        const defaultName = metadata?.type === "single"
          ? metadata.name
          : metadata?.type === "archive"
            ? "archive.zip"
            : `download-${parsed.id}`;

        if (options.output) {
          const stat = fs.existsSync(options.output) ? fs.statSync(options.output) : null;
          if (stat?.isDirectory()) {
            outputPath = path.join(options.output, defaultName);
          } else {
            outputPath = options.output;
          }
        } else {
          outputPath = path.join(process.cwd(), defaultName);
        }

        // Ensure output directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Download + decrypt
        if (!options.json) {
          writeLine(`Downloading to: ${outputPath}`);
        }

        const { stream } = await downloadFile(server, parsed.id, creds.authTokenB64);
        const decryptedStream = stream.pipeThrough(
          createDecryptStream(creds.keys.fileKey),
        );

        const progressState: ProgressState = {
          loaded: 0,
          total: info.size,
          startTime: Date.now(),
        };

        // Write to file
        const writer = fs.createWriteStream(outputPath);
        const reader = decryptedStream.getReader();

        let totalWritten = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
          totalWritten += value.byteLength;
          progressState.loaded = totalWritten;
          if (!options.json) {
            writeProgress(renderProgress(progressState, "Downloading"));
          }
        }

        await new Promise<void>((resolve, reject) => {
          writer.end(() => resolve());
          writer.on("error", reject);
        });

        if (!options.json) { clearLine(); writeLine("Download complete."); }

        if (options.json) {
          console.log(JSON.stringify({
            id: parsed.id,
            file: outputPath,
            size: totalWritten,
            name: defaultName,
            fileCount: info.fileCount,
          }));
        } else {
          writeLine(`Saved: ${outputPath} (${formatBytes(totalWritten)})`);
          if (metadata?.type === "archive") {
            writeLine(`Archive contains ${metadata.files.length} files`);
          }
        }
      } catch (err) {
        if (err instanceof ApiError) {
          if (options.json) {
            console.error(JSON.stringify({ error: err.message, status: err.status }));
          } else {
            console.error(`Error: ${err.message} (HTTP ${err.status})`);
          }
        } else {
          const message = err instanceof Error ? err.message : String(err);
          if (options.json) {
            console.error(JSON.stringify({ error: message }));
          } else {
            console.error(`Error: ${message}`);
          }
        }
        process.exit(1);
      }
    });
}
