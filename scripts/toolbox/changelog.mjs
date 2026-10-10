// @ts-check
/**
 * Changelog fragments.
 *
 * Every pull request writes its changelog entries into a file of its own under
 * `changelog/unreleased/`, so pull requests that run side by side never edit the same file. The
 * release collects the fragments into one version block of `docs/changelog.md` and deletes them.
 * The format of a fragment is described in `changelog/unreleased/README.md`.
 *
 *   pnpm changelog:check             checks every fragment, exits 1 on a problem
 *   pnpm changelog:preview           prints the block the next release writes
 *   pnpm changelog:amend [version]   adds the fragments to a block the changelog has already
 *
 * `pnpm version:bump` writes that block and deletes the fragments, with the Docker tags of the new
 * version. Preview, release and amend thank the author of an outside pull request at the end of
 * each entry of its fragment, so a contributor never has to write the thanks and the maintainer
 * never has to add it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ask, confirm } from "./cli.mjs";
import { remoteTag } from "./release-tag.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
 * The notes of the fragments, then every section in the order of `SECTIONS` with the entries of
 * all fragments grouped by scope. Every part ends with a blank line.
 *
 * @param {Fragment[]} fragments
 * @returns {string[]}
 */
function renderSections(fragments) {
  /** @type {string[]} */
  const lines = [];
  for (const note of fragments.flatMap((fragment) => fragment.notes)) lines.push(note, "");
  for (const heading of SECTIONS) {
    const entries = fragments.flatMap((fragment) => fragment.sections.get(heading) ?? []);
    if (entries.length > 0) lines.push(heading, "", ...byScope(entries), "");
  }
  return lines;
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
  const lines = [`## v${version}`, "", "*Release: In Progress*", "", ...renderSections(fragments)];
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
 * Every version the changelog has a block for, newest first, without the leading `v`.
 *
 * @param {string} changelog
 * @returns {string[]}
 */
export function listedVersions(changelog) {
  return changelog
    .split(/\r?\n/)
    .filter((line) => line.startsWith("## v"))
    .map((line) => line.slice("## v".length).split(" ")[0]);
}

/**
 * A version block with the entries of the fragments among its own, sorted in the way a release
 * sorts them. Its heading, its date line and its Docker section stay as they are.
 *
 * Throws when the block holds a line that is no note and no entry of a section, a paragraph
 * written by hand for one, since that line would get lost. Such a block is changed by hand.
 *
 * @param {string} block From its heading to the last line before the next version.
 * @param {Fragment[]} fragments
 * @returns {string}
 */
export function amendBlock(block, fragments) {
  const lines = block.split(/\r?\n/);
  const first = lines.findIndex((line, index) => index > 0 && line.trim() !== "");
  // The heading, and the date line below it when the block has one.
  const head = first !== -1 && lines[first].startsWith("*Release") ? first + 1 : 1;
  const docker = lines.indexOf(DOCKER_SECTION);
  const body = lines.slice(head, docker === -1 ? lines.length : docker).join("\n");
  const own = parseFragment(body, "block.md");

  // Read in and written out again, the block has to come back with every line it had.
  /** @param {string[]} text */
  const content = (text) => text.map((line) => line.trimEnd()).filter((line) => line !== "").join("\n");
  if (content(renderSections([own])) !== content(body.split("\n"))) {
    throw new Error("The block has lines that are no note and no entry of a section. Add the fragments to it by hand.");
  }

  const tail = docker === -1 ? [] : lines.slice(docker);
  return [...lines.slice(0, head), "", ...renderSections([own, ...fragments]), ...tail].join("\n").replace(/\n+$/, "");
}

/**
 * Adds the fragments to the block of a version the changelog lists already and deletes them, for
 * a change that still belongs to a release after the version bump wrote its block. Nothing
 * changes while a fragment breaks the format or the block cannot take them.
 *
 * @param {{
 *     version: string,
 *     dir?: string,
 *     changelog?: string,
 *     credit?: (fragments: Fragment[]) => Fragment[],
 * }} options
 * @returns {Fragment[]} The fragments that were added.
 */
export function amend({ version, dir = FRAGMENT_DIR, changelog = CHANGELOG, credit = (fragments) => fragments }) {
  const fragments = readFragments(dir);
  if (fragments.length === 0) throw new Error("There are no fragments to add.");
  const problems = fragments.flatMap((fragment) => fragment.problems.map((problem) => `${fragment.name}: ${problem}`));
  if (problems.length > 0) throw new Error(`Fix the changelog fragments first:\n${problems.join("\n")}`);

  const lines = fs.readFileSync(changelog, "utf8").split("\n");
  const heading = `## v${version}`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) throw new Error(`The changelog has no block for v${version}.`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## v"));
  const end = next === -1 ? lines.length : next;

  // The blank lines before the next version stay, so the block keeps its distance to it.
  let blank = 0;
  while (end - blank - 1 > start && lines[end - blank - 1].trim() === "") blank++;
  const block = amendBlock(lines.slice(start, end - blank).join("\n"), credit(fragments));
  fs.writeFileSync(changelog, [...lines.slice(0, start), block, ...lines.slice(end - blank)].join("\n"));
  for (const fragment of fragments) fs.rmSync(path.join(dir, fragment.name));
  return fragments;
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

/**
 * `pnpm changelog:check`: checks every fragment against the rules.
 *
 * @returns {boolean} Whether all of them are in order.
 */
export function checkCommand() {
  const fragments = readFragments();
  const problems = problemsOf(fragments);
  if (problems.length > 0) {
    fail(problems.join("\n"));
    return false;
  }
  out(`${fragments.length} changelog fragment${fragments.length === 1 ? "" : "s"}, all in order.`);
  return true;
}

/** `pnpm changelog:preview`: prints the block the next release writes. */
export function previewCommand() {
  const fragments = readFragments();
  const problems = problemsOf(fragments);
  if (problems.length > 0) fail(problems.join("\n"));
  out(renderBlock("NEXT", "`latest`, `vNEXT`", creditWithWarning(fragments)));
}

/**
 * Writes the block of a release into the changelog and deletes its fragments, for the version
 * bump.
 *
 * @param {string} version
 * @param {string} tags
 * @returns {boolean} Whether the changelog took the version.
 */
export function releaseCommand(version, tags) {
  try {
    const used = release({ version, tags, credit: creditWithWarning });
    out(
      `docs/changelog.md has v${version} with ${used.length} fragment${used.length === 1 ? "" : "s"}, which are deleted.`,
    );
    return true;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * `pnpm changelog:amend [version]`: adds the fragments to a block the changelog has already, the
 * newest one unless another is named.
 *
 * @param {string[]} args
 */
export async function amendCommand([given]) {
  const fragments = readFragments();
  if (fragments.length === 0) {
    out("There are no fragments to add.");
    return;
  }
  if (!checkCommand()) return;

  const versions = listedVersions(fs.readFileSync(CHANGELOG, "utf8"));
  if (versions.length === 0) {
    fail("The changelog has no version block yet.");
    return;
  }
  out(`The newest versions: ${versions.slice(0, 3).map((version) => `v${version}`).join(", ")}`);
  const version = (given ?? ((await ask(`Add them to which version? [v${versions[0]}]: `)) || versions[0])).replace(/^v/, "");
  if (!versions.includes(version)) {
    fail(`The changelog has no block for v${version}.`);
    return;
  }

  let tagged = null;
  try {
    tagged = remoteTag(`v${version}`);
  } catch {
    out("Could not ask GitHub whether the version is tagged already.");
  }
  if (tagged) out(`v${version} is tagged already. Its GitHub release and its images stay as they are, only docs/changelog.md changes.`);

  const entries = fragments.flatMap((fragment) => [...fragment.sections.values()].flat());
  for (const entry of entries) out(`  ${entry}`);
  if (!(await confirm(`Add ${entries.length === 1 ? "this entry" : `these ${entries.length} entries`} to v${version}?`, !tagged))) {
    out("Stopped, nothing changed.");
    return;
  }
  try {
    const used = amend({ version, credit: creditWithWarning });
    out(`docs/changelog.md: v${version} has the entries of ${used.length} more fragment${used.length === 1 ? "" : "s"}, which are deleted.`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
