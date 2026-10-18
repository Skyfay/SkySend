import type { Command } from "commander";
import { apiFor } from "../lib/api.js";
import { parseShareLink } from "@skysend/transfer";
import { writeLine } from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";
import { forTerminal } from "../lib/terminal.js";

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
        const parsed = parseShareLink(url, ["file", "note"]);

        if (parsed.type === "file") {
          await apiFor(parsed.server).deleteUpload(parsed.id, ownerToken);
        } else {
          await apiFor(parsed.server).deleteNote(parsed.id, ownerToken);
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
            console.error(`Error: ${forTerminal(message)}`);
          }
        }
        process.exit(1);
      }
    });
}
