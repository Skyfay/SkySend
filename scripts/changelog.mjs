// @ts-check
/**
 * Changelog fragments.
 *
 * Every pull request writes its changelog entries into a file of its own under
 * `changelog/unreleased/`, so pull requests that run side by side never edit the same file. The
 * release collects the fragments into one version block of `docs/changelog.md` and deletes them.
 * The format of a fragment is described in `changelog/unreleased/README.md`.
 *
 *   node scripts/changelog.mjs check                     checks every fragment, exits 1 on a problem
 *   node scripts/changelog.mjs preview                   prints the block the next release writes
 *   node scripts/changelog.mjs release <version> <tags>  writes that block and deletes the fragments
 *
 * `pnpm version:bump` runs `release` itself, with the Docker tags of the new version. Preview and
 * release thank the author of an outside pull request at the end of each entry of its fragment,
 * so a contributor never has to write the thanks and the maintainer never has to add it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the fragments of the next release wait. */
export const FRAGMENT_DIR = path.join(ROOT, "changelog", "unreleased");

/** The published changelog, which only the release writes to. */
export const CHANGELOG = path.join(ROOT, "docs", "changelog.md");

/** The repository on GitHub, which the links of the changelog point to. */
const REPO = "Skyfay/SkySend";

/** Whose pull requests get no thanks, since they maintain the project. */
const MAINTAINERS = ["Skyfay"];

/** A GitHub login: letters, digits and single hyphens, at most 39 characters. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** The line of the changelog that new version blocks go below. */
const MARKER = "All notable changes to SkySend are documented here.";

/** The file in the fragment folder that explains it, which is no fragment. */
const README = "README.md";

/** The sections a fragment may use, in the order the changelog shows them. The release adds Docker. */
export const SECTIONS = [
  "### ✨ Features",
  "### 🐛 Bug Fixes",
  "### 🔒 Security",
  "### 🎨 Improvements",
  "### 🔄 Changed",
  "### 🗑️ Removed",
  "### 📝 Documentation",
  "### 🧪 Tests",
  "### 🔧 CI/CD",
];

/** The scopes an entry may name, one part of the monorepo each. See docs/CLAUDE.md. */
export const SCOPES = [
  "server",
  "web",
  "client",
  "cli",
  "crypto",
  "docs",
  "website",
  "docker",
  "infra",
];

const DOCKER_SECTION = "### 🐳 Docker";
/** A note above the sections, like `> ⚠️ **Breaking:**` or `> ⚠️ **Before updating:**`. */
const NOTE = /^> (\S+ )?\*\*[^*]+\*\*/;
const ENTRY = /^- \*\*([^*]+)\*\*: (.+)$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

/**
 * @typedef {object} Fragment
 * @property {string} name The file name.
 * @property {string[]} notes The notes above the sections, like `> ⚠️ **Breaking:**`, each a whole line.
 * @property {Map<string, string[]>} sections The entry lines under each section heading.
 * @property {string[]} problems What breaks the format, empty for a good fragment.
 */

/**
 * @typedef {object} Contribution
 * @property {string} author The GitHub login of whoever opened the pull request.
 * @property {number} number The number of the pull request.
 */

/**
 * @typedef {(command: string, args: string[]) => string} Run
 * Runs a command without a shell and returns its output. Throws when it fails.
 */

/**
 * What breaks the rules of an entry's description: at most two sentences, no `;` and no hyphen
 * used as a dash, which is a hyphen followed by a space. A sentence ends at a `.`, `!` or `?` that the end of the line or the start of a new
 * sentence follows, which is good enough to catch a third one.
 *
 * @param {string} description
 * @returns {string[]}
 */
export function checkDescription(description) {
  const problems = [];
  if (description.includes(";")) problems.push("a description has no `;`");
  if (/(^|\s)- /.test(description)) problems.push("a description uses no hyphen as a dash");
  const sentences = description.match(/[.!?](?=\s+[A-Z*`"(]|\s*$)/g)?.length ?? 0;
  if (sentences > 2) {
    problems.push(`a description has at most two sentences, this one has ${sentences}`);
  }
  return problems;
}

/**
 * Reads one fragment. It holds notes like breaking changes above its first section, then
 * sections from `SECTIONS` with entries under them, and blank lines between them.
 *
 * @param {string} text
 * @param {string} name
 * @returns {Fragment}
 */
export function parseFragment(text, name) {
  /** @type {string[]} */
  const notes = [];
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  /** @type {string[]} */
  const problems = [];
  /** @type {string[] | null} */
  let current = null;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd();
    const at = `line ${index + 1}`;
    if (line === "") return;

    if (line.startsWith("### ")) {
      if (line === DOCKER_SECTION) problems.push(`${at}: the release writes the Docker section`);
      else if (!SECTIONS.includes(line)) {
        problems.push(`${at}: "${line}" is not one of the changelog sections`);
      }
      current = sections.get(line) ?? [];
      sections.set(line, current);
      return;
    }
    if (line.startsWith("## ")) {
      problems.push(`${at}: a fragment has no version header, the release writes it`);
      return;
    }
    if (line.startsWith(">")) {
      if (!NOTE.test(line)) {
        problems.push(`${at}: a note starts with a bold label, like "> ⚠️ **Breaking:**"`);
      } else if (current) problems.push(`${at}: a note goes above the first section`);
      else notes.push(line);
      return;
    }

    const entry = ENTRY.exec(line);
    if (!entry) {
      problems.push(`${at}: "${line}" is no entry, write it as - **scope**: description`);
      return;
    }
    if (!current) problems.push(`${at}: an entry goes under a section`);
    else current.push(line);
    const [, scope = "", description = ""] = entry;
    if (!SCOPES.includes(scope)) {
      problems.push(`${at}: "${scope}" is not a scope, use one of ${SCOPES.join(", ")}`);
    }
    for (const problem of checkDescription(description)) problems.push(`${at}: ${problem}`);
  });

  for (const [heading, entries] of sections) {
    if (entries.length === 0) problems.push(`"${heading}" has no entries`);
  }
  if (text.trim() === "") problems.push("the fragment is empty");
  if (!FILE_NAME.test(name)) {
    problems.push(
      "the file name holds letters, digits, dots, dashes and underscores and ends in .md",
    );
  }

  return { name, notes, sections, problems };
}

/**
 * Every fragment of a folder, by file name, without the README that explains them.
 *
 * @param {string} [dir]
 * @returns {Fragment[]}
 */
export function readFragments(dir = FRAGMENT_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== README)
    .sort()
    .map((name) => parseFragment(fs.readFileSync(path.join(dir, name), "utf8"), name));
}

/** @type {Run} */
function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The pull request that added a fragment, if someone outside the project opened it. The commit
 * that added the file comes from git, the pull request of that commit and its author from the
 * GitHub CLI. Null for a fragment without a pull request, or with one a maintainer or a bot
 * opened. Throws when git or gh cannot answer, so the caller can say the thanks is missing.
 *
 * @param {string} name The file name of the fragment.
 * @param {{ dir?: string, run?: Run }} [options]
 * @returns {Contribution | null}
 */
export function findContribution(name, { dir = FRAGMENT_DIR, run: exec = run } = {}) {
  const file = path.join(dir, name);
  const sha = exec("git", ["log", "-1", "--diff-filter=A", "--format=%H", "--", file]).trim();
  // Not committed yet, so no pull request can hold it.
  if (sha === "") return null;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`git returned no commit for ${name}`);

  const found = exec("gh", [
    "api",
    `repos/${REPO}/commits/${sha}/pulls`,
    "--jq",
    ".[0] | [.number, .user.login, .user.type] | @tsv",
  ]).trim();
  if (found === "") return null;
  const [number = "", author = "", type = ""] = found.split("\t");
  // The values end up in the changelog, so they have to look exactly like what GitHub hands out.
  if (!/^[1-9][0-9]*$/.test(number)) throw new Error(`gh returned no pull request for ${name}`);
  // Bots get no thanks, and their logins look different anyway, like `dependabot[bot]`.
  if (type !== "User") return null;
  if (!LOGIN.test(author)) throw new Error(`gh returned no pull request for ${name}`);
  return MAINTAINERS.includes(author) ? null : { author, number: Number(number) };
}

/**
 * The fragment with the thanks of its contribution at the end of every entry, like
 * `Thanks @user ([#81](https://github.com/Skyfay/SkySend/pull/81))`. An entry that thanks
 * someone already, the reporter of an advisory for example, keeps its own words.
 *
 * @param {Fragment} fragment
 * @param {Contribution | null} contribution
 * @returns {Fragment}
 */
export function creditFragment(fragment, contribution) {
  if (!contribution) return fragment;
  const { author, number } = contribution;
  const thanks = `Thanks @${author} ([#${number}](https://github.com/${REPO}/pull/${number}))`;
  const sections = new Map(
    [...fragment.sections].map(([heading, entries]) => [
      heading,
      entries.map((entry) => (entry.includes("Thanks @") ? entry : `${entry} ${thanks}`)),
    ]),
  );
  return { ...fragment, sections };
}

/**
 * Credits every fragment through `findContribution`. A fragment whose lookup fails stays as it
 * is and ends up in `missing`, so a release without network or gh still goes through.
 *
 * @param {Fragment[]} fragments
 * @param {(name: string) => Contribution | null} [find]
 * @returns {{ fragments: Fragment[], missing: string[] }}
 */
export function creditAll(fragments, find = findContribution) {
  /** @type {string[]} */
  const missing = [];
  const credited = fragments.map((fragment) => {
    try {
      return creditFragment(fragment, find(fragment.name));
    } catch {
      missing.push(fragment.name);
      return fragment;
    }
  });
  return { fragments: credited, missing };
}

/**
 * The entries of a section grouped by scope, in the order of `SCOPES`, so a reader finds the
 * lines of one part of SkySend together. Within a scope they keep the order of the fragments.
 *
 * @param {string[]} entries
 * @returns {string[]}
 */
function byScope(entries) {
  const rank = (/** @type {string} */ entry) => SCOPES.indexOf(ENTRY.exec(entry)?.[1] ?? "");
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

/**
 * The version block the fragments add up to: the notes, then every section in the
 * order of `SECTIONS` with the entries of all fragments grouped by scope, then the Docker
 * section.
 *
 * @param {string} version Without the leading `v`, like `2.13.0`.
 * @param {string} tags The other Docker tags of the image, like `` `latest`, `v2` ``.
 * @param {Fragment[]} fragments
 * @returns {string}
 */
export function renderBlock(version, tags, fragments) {
  const lines = [`## v${version}`, "", "*Release: In Progress*", ""];
  for (const note of fragments.flatMap((fragment) => fragment.notes)) lines.push(note, "");
  for (const heading of SECTIONS) {
    const entries = fragments.flatMap((fragment) => fragment.sections.get(heading) ?? []);
    if (entries.length > 0) lines.push(heading, "", ...byScope(entries), "");
  }
  lines.push(
    DOCKER_SECTION,
    "",
    `- **Image**: \`skyfay/skysend:v${version}\``,
    `- **Also tagged as**: ${tags}`,
    "- **Platforms**: linux/amd64, linux/arm64",
  );
  return lines.join("\n");
}

/**
 * The changelog with a version block on top of the versions it already lists.
 *
 * @param {string} changelog
 * @param {string} block
 * @returns {string}
 */
export function insertBlock(changelog, block) {
  const at = changelog.indexOf(MARKER);
  if (at === -1) throw new Error(`The changelog lacks the line "${MARKER}".`);
  const end = at + MARKER.length;
  return `${changelog.slice(0, end)}\n\n${block}${changelog.slice(end)}`;
}

/**
 * Every problem of the fragments, each prefixed with the name of its file.
 *
 * @param {Fragment[]} fragments
 * @returns {string[]}
 */
function problemsOf(fragments) {
  return fragments.flatMap((fragment) =>
    fragment.problems.map((problem) => `${fragment.name}: ${problem}`),
  );
}

/**
 * Writes the block of a release into the changelog and deletes the fragments it took. Nothing
 * changes while a fragment breaks the format or the changelog lists the version already.
 * `credit` adds the thanks of a contribution to the fragments, see `creditAll`.
 *
 * @param {{
 *   version: string,
 *   tags: string,
 *   dir?: string,
 *   changelog?: string,
 *   credit?: (fragments: Fragment[]) => Fragment[],
 * }} options
 * @returns {Fragment[]} The fragments the block was made of.
 */
export function release({
  version,
  tags,
  dir = FRAGMENT_DIR,
  changelog = CHANGELOG,
  credit = (fragments) => fragments,
}) {
  const fragments = readFragments(dir);
  const problems = problemsOf(fragments);
  if (problems.length > 0) {
    throw new Error(`Fix the changelog fragments first:\n${problems.join("\n")}`);
  }

  const content = fs.readFileSync(changelog, "utf8");
  const header = `## v${version}`;
  // Compared as text, since the version comes from the command line and must
  // not be read as a pattern. A title may follow the version, a suffix may not.
  const listed = content
    .split(/\r?\n/)
    .some((line) => line === header || line.startsWith(`${header} `));
  if (listed) {
    throw new Error(`The changelog already lists v${version}.`);
  }

  const block = renderBlock(version, tags, credit(fragments));
  fs.writeFileSync(changelog, insertBlock(content, block));
  for (const fragment of fragments) fs.rmSync(path.join(dir, fragment.name));
  return fragments;
}

/** @param {string} text */
function out(text) {
  process.stdout.write(`${text}\n`);
}

/** @param {string} text */
function fail(text) {
  process.stderr.write(`${text}\n`);
  process.exitCode = 1;
}

/**
 * Credits the fragments for preview and release, and warns about every fragment whose
 * contribution git or gh could not look up, so its thanks can be added by hand.
 *
 * @param {Fragment[]} fragments
 * @returns {Fragment[]}
 */
function creditWithWarning(fragments) {
  const { fragments: credited, missing } = creditAll(fragments);
  if (missing.length > 0) {
    process.stderr.write(
      `Could not look up the pull request of ${missing.join(", ")}. Is gh installed and logged in? ` +
        "Add the thanks of an outside contribution by hand.\n",
    );
  }
  return credited;
}

function main() {
  const [command, version, tags] = process.argv.slice(2);
  const fragments = readFragments();
  const problems = problemsOf(fragments);

  switch (command) {
    case "check":
      if (problems.length > 0) fail(problems.join("\n"));
      else {
        out(
          `${fragments.length} changelog fragment${fragments.length === 1 ? "" : "s"}, all in order.`,
        );
      }
      return;
    case "preview":
      if (problems.length > 0) fail(problems.join("\n"));
      out(renderBlock("NEXT", "`latest`, `vNEXT`", creditWithWarning(fragments)));
      return;
    case "release":
      if (!version || !tags) {
        fail("Usage: node scripts/changelog.mjs release <version> <tags>");
        return;
      }
      try {
        const used = release({ version, tags, credit: creditWithWarning });
        out(
          `docs/changelog.md has v${version} with ${used.length} fragment${used.length === 1 ? "" : "s"}, which are deleted.`,
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
      return;
    default:
      fail("Usage: node scripts/changelog.mjs check | preview | release <version> <tags>");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
