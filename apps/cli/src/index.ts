#!/usr/bin/env node

import { Command } from "commander";
import { createContext, destroyContext } from "./lib/context.js";
import { listUploads } from "./commands/list.js";
import { deleteUpload } from "./commands/delete.js";
import { showStats } from "./commands/stats.js";
import { runCleanupCommand } from "./commands/cleanup.js";
import { showConfig } from "./commands/config.js";

const program = new Command()
  .name("skysend")
  .description("SkySend admin CLI - manage uploads and server configuration")
  .version("0.0.0");

async function withContext(fn: (ctx: ReturnType<typeof createContext>) => Promise<void>): Promise<void> {
  const ctx = createContext();
  try {
    await fn(ctx);
  } finally {
    destroyContext();
  }
}

program
  .command("list")
  .description("Show active uploads and notes")
  .option("-a, --all", "Include expired uploads")
  .option("--json", "Output as JSON")
  .action((options: { all?: boolean; json?: boolean }) =>
    withContext((ctx) => listUploads(ctx, options)),
  );

program
  .command("delete <id>")
  .description("Delete an upload or note by ID")
  .action((id: string) =>
    withContext((ctx) => deleteUpload(ctx, id)),
  );

program
  .command("stats")
  .description("Show storage overview")
  .option("--json", "Output as JSON")
  .action((options: { json?: boolean }) =>
    withContext((ctx) => showStats(ctx, options)),
  );

program
  .command("cleanup")
  .description("Remove expired uploads and notes")
  .option("-n, --dry-run", "Show what would be cleaned up")
  .action((options: { dryRun?: boolean }) =>
    withContext((ctx) => runCleanupCommand(ctx, options)),
  );

program
  .command("config")
  .description("Show server configuration")
  .option("--json", "Output as JSON")
  .action((options: { json?: boolean }) =>
    withContext((ctx) => showConfig(ctx, options)),
  );

await program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
