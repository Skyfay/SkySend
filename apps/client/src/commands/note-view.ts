import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { parseShareUrl } from "../lib/url.js";
import { App } from "../tui/App.js";
import { resolveServer } from "../lib/config.js";

export function registerNoteViewCommand(program: Command): void {
  program
    .command("note:view")
    .description("View an encrypted note in the interactive TUI")
    .argument("<url>", "SkySend note share URL")
    .action(async (url: string) => {
      try {
        const parsed = parseShareUrl(url);

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
            initialView: "note-view" as const,
            initialNoteUrl: url,
          }),
          { exitOnCtrlC: true },
        );

        await waitUntilExit();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
