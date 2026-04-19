#!/usr/bin/env node

import { Command } from "commander";
import { registerUploadCommand } from "./commands/upload.js";
import { registerDownloadCommand } from "./commands/download.js";
import { registerNoteCommand } from "./commands/note.js";
import { registerNoteViewCommand } from "./commands/note-view.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerDeleteCommand } from "./commands/delete.js";

const program = new Command()
  .name("skysend")
  .description("SkySend CLI - upload and download files with end-to-end encryption")
  .version("2.4.0");

registerUploadCommand(program);
registerDownloadCommand(program);
registerNoteCommand(program);
registerNoteViewCommand(program);
registerConfigCommand(program);
registerDeleteCommand(program);

await program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
