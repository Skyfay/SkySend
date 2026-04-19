import type { Command } from "commander";
import { deleteUpload, deleteNote } from "../lib/api.js";
import { parseShareUrl } from "../lib/url.js";
import { writeLine } from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";

interface DeleteOptions {
  json?: boolean;
}

export function registerDeleteCommand(program: Command): void {
  program
    .command("delete")
    .description("Delete an upload or note by URL and owner token")
    .argument("<url>", "SkySend share URL")
    .argument("<ownerToken>", "Owner token (from upload --json output)")
    .option("--json", "Output as JSON")
    .action(async (url: string, ownerToken: string, options: DeleteOptions) => {
      try {
        const parsed = parseShareUrl(url);

        if (parsed.type === "file") {
          await deleteUpload(parsed.server, parsed.id, ownerToken);
        } else {
          await deleteNote(parsed.server, parsed.id, ownerToken);
        }

        if (options.json) {
          console.log(JSON.stringify({ deleted: true, id: parsed.id, type: parsed.type }));
        } else {
          writeLine(`Deleted ${parsed.type}: ${parsed.id}`);
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
