// @ts-check
/**
 * The version of SkySend. It lives in the root package.json and is copied to every workspace
 * package and to the version the CLI client compiles in.
 *
 *   pnpm version:sync                       copies the current version everywhere
 *   pnpm version:bump                       asks for the next version
 *   pnpm version:bump patch|minor|major     bumps without asking
 *   pnpm version:bump 3.1.0-beta            sets that version
 *
 * A bump checks the changelog fragments and the CodeQL alerts on dev first, and asks whether to go
 * on while an alert is open. Then it writes the version block of docs/changelog.md from the
 * fragments (see changelog.mjs) and the version itself. `--ignore-codeql` skips the
 * CodeQL check.
 */

import fs from "node:fs";
import path from "node:path";
import { checkCommand as checkFragments, releaseCommand } from "./changelog.mjs";
import { ROOT, ask, fail, out } from "./cli.mjs";
import { confirmCleanDev } from "./codeql.mjs";

const PACKAGE = path.join(ROOT, "package.json");

/** The workspace packages, which carry the version of the root. */
const PACKAGES = [
  "apps/server",
  "apps/web",
  "apps/cli",
  "apps/client",
  "packages/crypto",
  "packages/note-format",
  "docs",
].map((dir) => path.join(ROOT, dir, "package.json"));

/** The version the CLI client compiles in, for `--version` and the `update` command. */
const CLIENT_VERSION = path.join(ROOT, "apps", "client", "src", "version.ts");

/** A version as the release takes it, with an optional suffix like `-beta`. */
export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The next version, counted the way npm counts it: a version with a suffix like `-beta` becomes
 * the release it is a preview of, where the bump allows that.
 *
 * @param {string} current
 * @param {"patch" | "minor" | "major"} type
 * @returns {string}
 */
export function nextVersion(current, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(current);
  if (!match) throw new Error(`Not a version: ${current}`);
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  const preview = match[4] !== undefined;
  if (type === "major") return preview && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`;
  if (type === "minor") return preview && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
  return preview ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
}

/**
 * The Docker tags the image of a version gets besides its own, as the changelog lists them.
 *
 * @param {string} version
 * @returns {string}
 */
export function dockerTags(version) {
  if (version.includes("-beta")) return "`beta`";
  if (version.includes("-dev")) return "`dev`";
  return `\`latest\`, \`v${version.split(".")[0]}\``;
}

/**
 * A package.json with another version, changed in place so its formatting stays as it is.
 *
 * @param {string} json
 * @param {string} version
 * @returns {string}
 */
export function withVersion(json, version) {
  const changed = json.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (JSON.parse(changed).version !== version) throw new Error("package.json has no top-level version");
  return changed;
}

/**
 * The source file of the version the CLI client compiles in.
 *
 * @param {string} version
 * @returns {string}
 */
export function clientVersion(version) {
  return `// Auto-synced by scripts/toolbox/version.mjs - do not edit manually\nexport const APP_VERSION = "${version}";\n`;
}

function readVersion() {
  return JSON.parse(fs.readFileSync(PACKAGE, "utf8")).version;
}

/**
 * Copies a version to every place that shows it.
 *
 * @param {string} version
 */
function sync(version) {
  out(`Syncing version ${version} ...`);
  for (const file of PACKAGES) {
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = version;
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    out(`  ✓ ${path.relative(ROOT, file)}`);
  }
  fs.writeFileSync(CLIENT_VERSION, clientVersion(version));
  out(`  ✓ ${path.relative(ROOT, CLIENT_VERSION)}`);
}

/**
 * The version to bump to: from the argument, or picked on the terminal. Null when nothing was
 * picked.
 *
 * @param {string} current
 * @param {string | undefined} given
 * @returns {Promise<string | null>}
 */
async function pickVersion(current, given) {
  if (given === "patch" || given === "minor" || given === "major") return nextVersion(current, given);
  if (given !== undefined) {
    if (!VERSION.test(given)) throw new Error(`Not a version: ${given}`);
    return given;
  }

  out("");
  out(`  Current version: v${current}`);
  out("");
  out(`  1) Patch  → v${nextVersion(current, "patch")}`);
  out(`  2) Minor  → v${nextVersion(current, "minor")}`);
  out(`  3) Major  → v${nextVersion(current, "major")}`);
  out("  4) Custom");
  out("");
  const choice = await ask("  Select [1-4]: ");
  if (choice === "1") return nextVersion(current, "patch");
  if (choice === "2") return nextVersion(current, "minor");
  if (choice === "3") return nextVersion(current, "major");
  if (choice !== "4") return null;
  const custom = await ask("  Enter version (e.g. 3.1.0-beta): ");
  if (!VERSION.test(custom)) throw new Error(`Not a version: ${custom || "(empty)"}`);
  return custom;
}

/** `pnpm version:sync`: copies the current version everywhere. */
export function syncCommand() {
  const version = readVersion();
  sync(version);
  out(`Done, all files at v${version}.`);
}

/**
 * `pnpm version:bump [patch|minor|major|<version>] [--ignore-codeql]`.
 *
 * @param {string[]} args
 */
export async function bumpCommand(args) {
  const ignoreCodeql = args.includes("--ignore-codeql");
  const [given] = args.filter((arg) => !arg.startsWith("--"));
  if (!checkFragments()) {
    fail("Fix the changelog fragments first, nothing changed.");
    return;
  }
  if (!ignoreCodeql && !(await confirmCleanDev())) {
    fail("Stopped, nothing changed.");
    return;
  }

  const current = readVersion();
  const version = await pickVersion(current, given);
  if (!version) {
    fail("Stopped, nothing changed.");
    return;
  }

  // The changelog first, since it refuses a version it lists already, before anything else changed.
  if (!releaseCommand(version, dockerTags(version))) {
    fail("The changelog refused the version, nothing else changed.");
    return;
  }
  fs.writeFileSync(PACKAGE, withVersion(fs.readFileSync(PACKAGE, "utf8"), version));
  out(`package.json: ${current} → ${version}`);
  sync(version);
  out(`Done, all files at v${version}.`);
}
