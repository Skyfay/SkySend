import type { Command } from "commander";
import {
  decryptNoteContent,
  fromBase64url,
  deriveKeys,
  computeAuthToken,
  toBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  deriveKeyFromPasswordArgon2,
  type Argon2idHashFn,
} from "@skysend/crypto";
import { argon2id } from "hash-wasm";
import {
  fetchNoteInfo,
  viewNote,
  verifyNotePassword,
} from "../lib/api.js";
import { parseShareUrl } from "../lib/url.js";
import {
  writeLine,
  promptPassword,
} from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";

const hashWasmArgon2: Argon2idHashFn = async (
  password: Uint8Array,
  salt: Uint8Array,
  params: { memory: number; iterations: number; parallelism: number; hashLength: number },
): Promise<Uint8Array> => {
  const result = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.hashLength,
    outputType: "binary",
  });
  return new Uint8Array(result);
};

interface NoteViewOptions {
  password?: boolean | string;
  json?: boolean;
}

export function registerNoteViewCommand(program: Command): void {
  program
    .command("note:view")
    .description("View an encrypted note")
    .argument("<url>", "SkySend note share URL")
    .option("-p, --password [password]", "Password (prompts if no value given)")
    .option("--json", "Output as JSON")
    .action(async (url: string, options: NoteViewOptions) => {
      try {
        const parsed = parseShareUrl(url);

        if (parsed.type !== "note") {
          throw new Error("This URL is a file, not a note. Use 'skysend download' instead.");
        }

        // Fetch note info
        if (!options.json) writeLine("Fetching note info...");
        const info = await fetchNoteInfo(parsed.server, parsed.id);

        // Handle password
        let password: string | undefined;
        if (info.hasPassword) {
          if (options.password === true) {
            password = await promptPassword("Password: ");
          } else if (typeof options.password === "string") {
            password = options.password;
          } else {
            password = await promptPassword("This note is password protected. Password: ");
          }
          if (!password) throw new Error("Password is required for this note");
        }

        // Derive keys
        let secret = fromBase64url(parsed.secret) as Uint8Array<ArrayBuffer>;
        const salt = fromBase64url(info.salt) as Uint8Array<ArrayBuffer>;

        if (password && info.passwordSalt && info.passwordAlgo) {
          const passwordSalt = fromBase64url(info.passwordSalt) as Uint8Array<ArrayBuffer>;
          let passwordKey: Uint8Array;

          if (info.passwordAlgo === "argon2id") {
            passwordKey = await deriveKeyFromPasswordArgon2(
              password,
              passwordSalt,
              hashWasmArgon2,
            );
          } else {
            const { key } = await deriveKeyFromPassword(password, passwordSalt);
            passwordKey = key;
          }

          secret = applyPasswordProtection(secret, passwordKey) as Uint8Array<ArrayBuffer>;
        }

        const keys = await deriveKeys(secret, salt);
        const authToken = await computeAuthToken(keys.authKey);
        const authTokenB64 = toBase64url(authToken);

        // Verify password if needed
        if (info.hasPassword) {
          const valid = await verifyNotePassword(parsed.server, parsed.id, authTokenB64);
          if (!valid) throw new Error("Invalid password");
        }

        // View note (consumes a view)
        const noteData = await viewNote(parsed.server, parsed.id, authTokenB64);

        // Decrypt content
        const ciphertext = fromBase64url(noteData.encryptedContent) as Uint8Array<ArrayBuffer>;
        const nonce = fromBase64url(noteData.nonce) as Uint8Array<ArrayBuffer>;
        const content = await decryptNoteContent(ciphertext, nonce, keys.metaKey);

        if (options.json) {
          console.log(JSON.stringify({
            id: parsed.id,
            content,
            type: info.contentType,
            viewCount: noteData.viewCount,
            maxViews: noteData.maxViews,
          }));
        } else {
          writeLine("");
          console.log(content);
          writeLine("");
          writeLine(`Type: ${info.contentType} | Views: ${noteData.viewCount}/${noteData.maxViews === 0 ? "∞" : noteData.maxViews}`);
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
