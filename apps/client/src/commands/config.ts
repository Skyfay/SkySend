import type { Command } from "commander";
import {
  loadConfig,
  saveConfig,
  resetConfig,
  getConfigFilePath,
} from "../lib/config.js";
import { writeLine } from "../lib/progress.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage client configuration");

  // Default action: show current config
  configCmd
    .action(() => {
      const config = loadConfig();
      const configPath = getConfigFilePath();

      writeLine(`Config file: ${configPath}`);
      if (config.server) {
        writeLine(`Server: ${config.server}`);
      } else {
        writeLine("Server: (not set)");
      }

      const env = process.env["SKYSEND_SERVER"];
      if (env) {
        writeLine(`SKYSEND_SERVER: ${env}`);
      }
    });

  configCmd
    .command("set-server")
    .description("Save the default server URL")
    .argument("<url>", "Server URL (e.g. https://send.example.com)")
    .action((url: string) => {
      const cleanUrl = url.replace(/\/+$/, "");
      try {
        new URL(cleanUrl);
      } catch {
        console.error(`Error: Invalid URL: ${cleanUrl}`);
        process.exit(1);
      }
      const config = loadConfig();
      config.server = cleanUrl;
      saveConfig(config);
      writeLine(`Server set to: ${cleanUrl}`);
    });

  configCmd
    .command("reset")
    .description("Reset configuration to defaults")
    .action(() => {
      resetConfig();
      writeLine("Configuration reset.");
    });
}
