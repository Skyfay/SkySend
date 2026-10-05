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
 * `pnpm version:bump` runs `release` itself, with the Docker tags of the new version.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the fragments of the next release wait. */
export const FRAGMENT_DIR = path.join(ROOT, "changelog", "unreleased");

/** The published changelog, which only the release writes to. */
export const CHANGELOG = path.join(ROOT, "docs", "changelog.md");

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

/**
 * The version block the fragments add up to: the notes, then every section in the
 * order of `SECTIONS` with the entries of all fragments, then the Docker section.
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
    if (entries.length > 0) lines.push(heading, "", ...entries, "");
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
 *
 * @param {{ version: string, tags: string, dir?: string, changelog?: string }} options
 * @returns {Fragment[]} The fragments the block was made of.
 */
export function release({ version, tags, dir = FRAGMENT_DIR, changelog = CHANGELOG }) {
  const fragments = readFragments(dir);
  const problems = problemsOf(fragments);
  if (problems.length > 0) {
    throw new Error(`Fix the changelog fragments first:\n${problems.join("\n")}`);
  }

  const content = fs.readFileSync(changelog, "utf8");
  if (new RegExp(`^## v${version.replace(/\./g, "\\.")}\\b`, "m").test(content)) {
    throw new Error(`The changelog already lists v${version}.`);
  }

  fs.writeFileSync(changelog, insertBlock(content, renderBlock(version, tags, fragments)));
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
      out(renderBlock("NEXT", "`latest`, `vNEXT`", fragments));
      return;
    case "release":
      if (!version || !tags) {
        fail("Usage: node scripts/changelog.mjs release <version> <tags>");
        return;
      }
      try {
        const used = release({ version, tags });
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
