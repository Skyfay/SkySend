// @ts-check
/**
 * Known vulnerabilities in the dependencies of every workspace package.
 *
 *   pnpm audit:check
 *
 * The workspace shares one lockfile, so one `pnpm audit` at the root covers every package.
 */

import { bold, out, runVisible } from "./cli.mjs";

/** `pnpm audit:check`: runs `pnpm audit` for the whole workspace. */
export function checkCommand() {
  out(bold("Auditing the SkySend dependencies..."));
  out("");
  // `pnpm audit` exits 1 when it finds something. That is a result here, not a failure.
  if (runVisible("pnpm", ["audit"])) out("✓ No known vulnerabilities in any workspace package.");
  else out("pnpm audit has findings, or could not reach the registry. Its report is above.");
}
