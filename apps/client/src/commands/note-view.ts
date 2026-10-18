import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { parseShareLink } from "@skysend/transfer";
import { App } from "../tui/App.js";
import { resolveServer } from "../lib/config.js";
import { forTerminal } from "../lib/terminal.js";

export function registerNoteViewCommand(program: Command): void {
  program
    .command("note:view")
    .description("View an encrypted note in the interactive TUI")
    .argument("<url>", "SkySend note share URL")
    .action(async (url: string) => {
      try {
        const parsed = parseShareLink(url, ["file", "note"]);

        if (parsed.type !== "note") {
          throw new Error("This URL is a file, not a note. Use 'skysend download' instead.");
        }

        let initialServer: string | undefined;
        try {
          initialServer = resolveServer(parsed.server);
        } catch {
          initialServer = parsed.server;
        }

        const { waitUntilExit } = render(
          React.createElement(App, {
            initialServer,
            initialNoteUrl: url,
          }),
          { exitOnCtrlC: true, alternateScreen: true },
        );

        await waitUntilExit();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${forTerminal(message)}`);
        process.exit(1);
      }
    });
}
