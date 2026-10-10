// @ts-check
/**
 * Outdated dependencies of every workspace package.
 *
 *   pnpm update:check
 *
 * The packages come from pnpm itself, so a new app or worker is covered without a change here.
 * Each one is checked on its own instead of through `pnpm outdated --recursive`, which merges all
 * of them into one table that no longer says which versions belong together.
 */

import path from "node:path";
import { ROOT, bold, out, run, runVisible } from "./cli.mjs";

/** `pnpm update:check`: runs `pnpm outdated` in every package and sums up which have updates. */
export function checkCommand() {
  const packages = run("pnpm", ["list", "--recursive", "--depth", "-1", "--parseable"]).split("\n").filter(Boolean);
  if (packages.length === 0) throw new Error("No workspace packages found.");

  /** @type {string[]} */
  const outdated = [];
  out(bold("Checking SkySend dependencies..."));
  out("");
  for (const dir of packages) {
    const name = dir === ROOT ? "root" : path.relative(ROOT, dir);
    out(bold(`── ${name} ──`));
    // `pnpm outdated` exits 1 whenever it finds something, the way `diff` does. That is the
    // normal result here, so it is counted rather than ending the run.
    if (runVisible("pnpm", ["outdated"], dir)) out("✓ up to date");
    else outdated.push(name);
    out("");
  }
  out(bold("═══ Summary ═══"));
  if (outdated.length === 0) out(`  ✓ All ${packages.length} packages are up to date.`);
  else out(`  ${outdated.length} of ${packages.length} packages have updates: ${outdated.join(", ")}`);
}
