#!/usr/bin/env node

import { Command } from "commander";
import { registerUploadCommand } from "./commands/upload.js";
import { registerDownloadCommand } from "./commands/download.js";
import { registerNoteCommand } from "./commands/note.js";
import { registerNoteViewCommand } from "./commands/note-view.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerInteractiveCommand } from "./commands/interactive.js";
import { registerLsCommand } from "./commands/ls.js";
import { APP_VERSION } from "./version.js";

const program = new Command()
  .name("skysend")
  .description("")
  .addHelpText("beforeAll", "SkySend CLI - upload and download files with end-to-end encryption\n\nRun 'skysend' without arguments to start the interactive TUI.\n")
  .version(APP_VERSION);

registerUploadCommand(program);
registerDownloadCommand(program);
registerNoteCommand(program);
registerNoteViewCommand(program);
registerConfigCommand(program);
registerDeleteCommand(program);
registerLsCommand(program);
registerUpdateCommand(program);
registerInteractiveCommand(program);

await program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

process.exit(0);
