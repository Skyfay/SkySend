// @ts-check
/**
 * The toolbox: the commands for releasing and maintaining SkySend behind one menu.
 *
 *   pnpm toolbox                    shows the menu
 *   pnpm toolbox <command> [args]   runs a command, like `pnpm toolbox release:untag v3.0.1`
 *
 * Every command is a script of its own in package.json as well, listed right below `toolbox`, so
 * `pnpm version:bump` and `pnpm toolbox version:bump` are the same. How to add one: README.md.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkCommand as checkAudit } from "./audit.mjs";
import { amendCommand, checkCommand as checkChangelog, previewCommand } from "./changelog.mjs";
import { ask, bold, closePrompt, fail, messageOf, out } from "./cli.mjs";
import { checkCommand as checkCodeql } from "./codeql.mjs";
import { tagCommand, untagCommand } from "./release-tag.mjs";
import { checkCommand as checkUpdates } from "./updates.mjs";
import { bumpCommand, syncCommand } from "./version.mjs";

/**
 * @typedef {{ name: string, group: string, title: string, run: (args: string[]) => unknown }} Command
 */

/**
 * Every command, in the order of the menu. The name is the script in package.json.
 *
 * @type {Command[]}
 */
export const COMMANDS = [
  { name: "version:bump", group: "Release", title: "Bump the version and write its changelog block", run: (args) => bumpCommand(args) },
  { name: "release:tag", group: "Release", title: "Tag the release on main and push the tag", run: () => tagCommand() },
  { name: "release:untag", group: "Release", title: "Delete a tag here and on GitHub", run: ([tag]) => untagCommand(tag) },
  { name: "version:sync", group: "Release", title: "Copy the current version everywhere", run: () => syncCommand() },
  { name: "changelog:check", group: "Changelog", title: "Check the changelog fragments", run: () => checkChangelog() },
  { name: "changelog:preview", group: "Changelog", title: "Preview the block of the next release", run: () => previewCommand() },
  { name: "changelog:amend", group: "Changelog", title: "Add the fragments to a version block written already", run: (args) => amendCommand(args) },
  { name: "codeql:check", group: "Security", title: "CodeQL alerts on dev that main does not have", run: () => checkCodeql() },
  { name: "audit:check", group: "Security", title: "Known vulnerabilities in the dependencies", run: () => checkAudit() },
  { name: "update:check", group: "Maintenance", title: "Outdated dependencies", run: () => checkUpdates() },
];

/**
 * The menu, one numbered line per command below the heading of its group.
 *
 * @param {Command[]} commands
 * @returns {string[]}
 */
export function menuLines(commands) {
  const width = Math.max(...commands.map((command) => command.title.length));
  /** @type {string[]} */
  const lines = [];
  let group = "";
  commands.forEach((command, index) => {
    if (command.group !== group) {
      group = command.group;
      lines.push("", ` ${bold(group)}`);
    }
    const number = String(index + 1).padStart(String(commands.length).length);
    lines.push(`   ${number}) ${command.title.padEnd(width)}   pnpm ${command.name}`);
  });
  return lines;
}

/** Shows the menu and runs the command picked. */
async function menu() {
  out(bold("SkySend toolbox"));
  for (const line of menuLines(COMMANDS)) out(line);
  out("");
  const choice = await ask(`Select [1-${COMMANDS.length}, Enter to quit]: `);
  if (choice === "") return;
  const command = COMMANDS[Number(choice) - 1];
  if (!command || !/^\d+$/.test(choice)) {
    fail(`No command ${choice}.`);
    return;
  }
  out("");
  await command.run([]);
}

async function main() {
  const [name, ...args] = process.argv.slice(2);
  try {
    if (name === undefined) {
      await menu();
      return;
    }
    const command = COMMANDS.find((candidate) => candidate.name === name);
    if (!command) {
      fail(`No command ${name}. The commands: ${COMMANDS.map((candidate) => candidate.name).join(", ")}`);
      return;
    }
    await command.run(args);
  } catch (error) {
    fail(messageOf(error));
  } finally {
    closePrompt();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main();
