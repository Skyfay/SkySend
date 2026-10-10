// @ts-check
/**
 * What the release scripts share: running git and gh, and asking on the terminal.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/** The root of the repository, where every command runs. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The repository on GitHub. */
export const REPO = "Skyfay/SkySend";

/** @param {string} text */
export function out(text) {
  process.stdout.write(`${text}\n`);
}

/** @param {string} text */
export function fail(text) {
  process.stderr.write(`${text}\n`);
  process.exitCode = 1;
}

/** @param {unknown} error */
export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a command and returns what it printed. A command that fails throws with what it wrote to
 * stderr, and so does one that is not installed.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
export function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${args[0] ?? ""} exited with ${result.status}`);
  }
  return result.stdout.trim();
}

/**
 * Like `run`, but a command that fails or is missing gives null instead of throwing.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {string | null}
 */
export function attempt(command, args) {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

/**
 * Runs a command with the terminal attached, so its output shows as it comes.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {boolean} Whether it succeeded.
 */
export function runVisible(command, args, cwd = ROOT) {
  return spawnSync(command, args, { cwd, stdio: "inherit" }).status === 0;
}

/** @param {string} text */
export function bold(text) {
  return process.stdout.isTTY ? `\x1b[1m${text}\x1b[0m` : text;
}

/** @type {readline.Interface | null} */
let reader = null;

/** Lines typed before their question came. */
const typed = /** @type {string[]} */ ([]);

/** Questions waiting for a line. */
const waiting = /** @type {((line: string) => void)[]} */ ([]);

/** Whether the terminal closed, after which every answer is empty. */
let ended = false;

function startReader() {
  const lines = readline.createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    const answer = waiting.shift();
    if (answer) answer(line);
    else typed.push(line);
  });
  lines.on("close", () => {
    ended = true;
    for (const answer of waiting.splice(0)) answer("");
  });
  return lines;
}

/**
 * Asks on the terminal. Without one there is nobody to answer, so the answer is empty.
 *
 * Lines are read as they come and wait for the question they answer, so nothing typed ahead gets
 * lost while a command runs. `closePrompt()` stops reading, so the script can exit.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function ask(question) {
  if (!process.stdin.isTTY) return "";
  reader ??= startReader();
  process.stdout.write(question);
  const early = typed.shift();
  if (early !== undefined) return early.trim();
  if (ended) return "";
  return (await new Promise((resolve) => waiting.push(resolve))).trim();
}

export function closePrompt() {
  reader?.close();
  reader = null;
}

/**
 * A yes or no question, where Enter takes `fallback`. Without a terminal the answer is always no,
 * so nothing happens that nobody agreed to.
 *
 * @param {string} question
 * @param {boolean} fallback
 * @returns {Promise<boolean>}
 */
export async function confirm(question, fallback) {
  if (!process.stdin.isTTY) return false;
  const answer = (await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
  if (answer === "") return fallback;
  return ["y", "yes", "j", "ja"].includes(answer);
}
