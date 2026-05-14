import type { Command } from "commander";
import { resolveServer, clearStoredToken, getStoredToken } from "../lib/config.js";
import { performOidcLogin, decodeTokenUser, isTokenExpired } from "../lib/oidc.js";
import { writeLine } from "../lib/progress.js";
import { ApiError } from "../lib/errors.js";

interface AuthOptions {
  server?: string;
}

function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString();
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage OIDC authentication for a server");

  // ── auth login ─────────────────────────────────────

  auth
    .command("login")
    .description("Log in to a server via browser-based OIDC")
    .option("-s, --server <url>", "Server URL")
    .action(async (options: AuthOptions) => {
      try {
        const server = resolveServer(options.server);
        writeLine(`Logging in to ${server}...`);
        const token = await performOidcLogin(server);
        const user = decodeTokenUser(token);
        if (user) {
          writeLine(`Logged in as: ${user.name}${user.email ? ` <${user.email}>` : ""}`);
          writeLine(`Session expires: ${formatDate(user.exp)}`);
        } else {
          writeLine("Login successful.");
        }
      } catch (err) {
        if (err instanceof ApiError) {
          console.error(`Error: ${err.message} (HTTP ${err.status})`);
        } else {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
      }
    });

  // ── auth logout ────────────────────────────────────

  auth
    .command("logout")
    .description("Remove stored OIDC session for a server")
    .option("-s, --server <url>", "Server URL")
    .action((options: AuthOptions) => {
      try {
        const server = resolveServer(options.server);
        clearStoredToken(server);
        writeLine(`Logged out from ${server}.`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // ── auth status ────────────────────────────────────

  auth
    .command("status")
    .description("Show current OIDC session status for a server")
    .option("-s, --server <url>", "Server URL")
    .action((options: AuthOptions) => {
      try {
        const server = resolveServer(options.server);
        const token = getStoredToken(server);
        if (!token) {
          writeLine(`Not logged in to ${server}.`);
          return;
        }
        const user = decodeTokenUser(token);
        if (!user) {
          writeLine("Stored token is malformed. Run 'skysend auth login' to re-authenticate.");
          return;
        }
        const expired = isTokenExpired(token);
        writeLine(`Server:  ${server}`);
        writeLine(`User:    ${user.name}${user.email ? ` <${user.email}>` : ""}`);
        writeLine(`Expires: ${formatDate(user.exp)}${expired ? " (expired)" : ""}`);
        writeLine(`Status:  ${expired ? "expired - run 'skysend auth login' to refresh" : "active"}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
