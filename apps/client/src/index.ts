#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerUploadCommand } from "./commands/upload.js";
import { registerDownloadCommand } from "./commands/download.js";
import { registerNoteCommand } from "./commands/note.js";
import { registerNoteViewCommand } from "./commands/note-view.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerInteractiveCommand } from "./commands/interactive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

const program = new Command()
  .name("skysend")
  .description("SkySend CLI - upload and download files with end-to-end encryption")
  .version(pkg.version);

registerUploadCommand(program);
registerDownloadCommand(program);
registerNoteCommand(program);
registerNoteViewCommand(program);
registerConfigCommand(program);
registerDeleteCommand(program);
registerUpdateCommand(program);
registerInteractiveCommand(program);

await program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

process.exit(0);
