import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { App } from "../tui/App.js";
import { resolveServer } from "../lib/config.js";

export function registerInteractiveCommand(program: Command): void {
  program
    .command("interactive", { isDefault: true })
    .alias("i")
    .description("Interactive TUI mode")
    .option("-s, --server <url>", "Server URL")
    .action(async (options: { server?: string }) => {
      let initialServer: string | undefined;
      try {
        initialServer = resolveServer(options.server);
      } catch {
        // No server configured - will show server select
      }

      const { waitUntilExit } = render(
        React.createElement(App, { initialServer }),
        { exitOnCtrlC: true },
      );

      await waitUntilExit();
    });
}
