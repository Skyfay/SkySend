import type { Command } from "commander";
import {
  encryptNoteContent,
  toBase64url,
  type NoteContentType,
} from "@skysend/crypto";
import { fetchConfig, createNote } from "../lib/api.js";
import { prepareUpload } from "../lib/auth.js";
import { buildShareUrl } from "../lib/url.js";
import { resolveServer } from "../lib/config.js";
import {
  formatExpiry,
  parseDuration,
  writeLine,
  promptPassword,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";
import { addNote } from "../lib/history.js";

interface NoteOptions {
  server?: string;
  type?: string;
  expires?: string;
  views?: string;
  password?: boolean | string;
  json?: boolean;
}

const VALID_TYPES: NoteContentType[] = ["text", "password", "code", "markdown", "sshkey"];

export function registerNoteCommand(program: Command): void {
  program
    .command("note")
    .description("Create an encrypted note")
    .argument("<text>", "Note content")
    .option("-s, --server <url>", "Server URL")
    .option("-t, --type <type>", "Content type (text, password, code, markdown, sshkey)", "text")
    .option("-e, --expires <duration>", "Expiry time (e.g. 5m, 1h, 1d, 7d)")
    .option("-v, --views <count>", "Max view count (0 = unlimited)")
    .option("-p, --password [password]", "Password protect (prompts if no value given)")
    .option("--json", "Output as JSON")
    .action(async (text: string, options: NoteOptions) => {
      try {
        const server = resolveServer(options.server);
        const config = await fetchConfig(server);

        // Validate content type
        const contentType = (options.type ?? "text") as NoteContentType;
        if (!VALID_TYPES.includes(contentType)) {
          throw new Error(`Invalid content type: ${contentType}. Options: ${VALID_TYPES.join(", ")}`);
        }

        // Validate size
        const contentBytes = new TextEncoder().encode(text);
        if (contentBytes.byteLength > config.noteMaxSize) {
          throw new Error(`Note too large (${contentBytes.byteLength} bytes). Max: ${config.noteMaxSize}`);
        }

        // Resolve password
        let password: string | undefined;
        if (options.password === true) {
          password = await promptPassword("Password: ");
          if (!password) throw new Error("Password cannot be empty");
        } else if (typeof options.password === "string") {
          password = options.password;
        }

        // Resolve expiry
        const expireSec = options.expires
          ? parseDuration(options.expires)
          : config.noteDefaultExpire;
        if (!config.noteExpireOptions.includes(expireSec)) {
          throw new Error(
            `Invalid expiry. Options: ${config.noteExpireOptions.map((s) => `${s}s`).join(", ")}`,
          );
        }

        // Resolve views
        const maxViews = options.views !== undefined
          ? parseInt(options.views, 10)
          : config.noteDefaultViews;
        if (!config.noteViewOptions.includes(maxViews)) {
          throw new Error(
            `Invalid view count. Options: ${config.noteViewOptions.join(", ")}`,
          );
        }

        // Prepare crypto
        if (!options.json) writeLine("Encrypting note...");
        const creds = await prepareUpload(password);

        // Encrypt note content
        const encrypted = await encryptNoteContent(text, creds.keys.metaKey);

        // Create note
        const result = await createNote(server, {
          encryptedContent: toBase64url(encrypted.ciphertext),
          nonce: toBase64url(encrypted.nonce),
          salt: toBase64url(creds.salt),
          ownerToken: creds.ownerTokenB64,
          authToken: creds.authTokenB64,
          contentType,
          maxViews,
          expireSec,
          hasPassword: creds.hasPassword,
          passwordSalt: creds.passwordSalt ? toBase64url(creds.passwordSalt) : undefined,
          passwordAlgo: creds.passwordAlgo,
        });

        // Build share URL
        const shareUrl = buildShareUrl(server, "note", result.id, creds.effectiveSecretB64);

        // Save to history
        addNote({
          id: result.id,
          server,
          url: shareUrl,
          ownerToken: creds.ownerTokenB64,
          contentType,
          hasPassword: creds.hasPassword,
          createdAt: new Date().toISOString(),
          expireSec,
        });

        if (options.json) {
          console.log(JSON.stringify({
            id: result.id,
            url: shareUrl,
            ownerToken: creds.ownerTokenB64,
            type: contentType,
            expires: expireSec,
            maxViews,
            hasPassword: creds.hasPassword,
          }));
        } else {
          writeLine("");
          writeLine(`Share URL: ${shareUrl}`);
          writeLine(`Type: ${contentType} | Expires: ${formatExpiry(expireSec)} | Views: ${maxViews === 0 ? "unlimited" : maxViews}`);
          if (creds.hasPassword) writeLine("Password protected: yes");
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
