import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHANGELOG,
  FRAGMENT_DIR,
  SECTIONS,
  amend,
  creditAll,
  creditFragment,
  findContribution,
  insertBlock,
  listedVersions,
  parseFragment,
  readFragments,
  release,
  renderBlock,
} from "./changelog.mjs";

const DIR = "/repo/changelog/unreleased";
const MEMORY_CHANGELOG = "/repo/docs/changelog.md";

const RELEASED = [
  "# Changelog",
  "",
  "All notable changes to SkySend are documented here.",
  "",
  "## v2.12.1 - Link Preview and Branding Improvements",
  "",
  "*Released: September 17, 2026*",
  "",
].join("\n");

/** The problems of a fragment, without the line numbers. */
function problemsOf(text: string, name = "Skyfay-fix.md") {
  return parseFragment(text, name).problems.map((problem) => problem.replace(/^line \d+: /, ""));
}

/** Files that exist in memory only, for the release. */
function memoryFiles(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  vi.spyOn(fs, "existsSync").mockImplementation((target) =>
    [...store.keys()].some((file) => path.dirname(file) === String(target)),
  );
  vi.spyOn(fs, "readdirSync").mockImplementation(((dir: fs.PathLike) =>
    [...store.keys()]
      .filter((file) => path.dirname(file) === String(dir))
      .map((file) => path.basename(file))) as unknown as typeof fs.readdirSync);
  vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor) => {
    const content = store.get(String(file));
    if (content === undefined) throw new Error(`ENOENT: ${String(file)}`);
    return content;
  }) as unknown as typeof fs.readFileSync);
  vi.spyOn(fs, "writeFileSync").mockImplementation((file, data) => {
    store.set(String(file), String(data));
  });
  vi.spyOn(fs, "rmSync").mockImplementation((file) => {
    store.delete(String(file));
  });
  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// The guard over the real fragments and the real changelog. Entries written straight into
// docs/changelog.md made every pair of pull requests conflict, so every fragment is checked here
// and unreleased blocks stay out of the changelog itself.
describe("the changelog fragments of the repository", () => {
  it("follow the format of the changelog", () => {
    const problems = readFragments(FRAGMENT_DIR).flatMap((fragment) =>
      fragment.problems.map((problem) => `changelog/unreleased/${fragment.name}: ${problem}`),
    );
    expect(problems, "Fix these fragments, see changelog/unreleased/README.md").toEqual([]);
  });

  it("leave the changelog to the release, which writes no vNEXT block", () => {
    const changelog = fs.readFileSync(CHANGELOG, "utf-8");
    expect(
      /^## vNEXT/m.test(changelog),
      "docs/changelog.md has a vNEXT block, move its entries into a fragment under changelog/unreleased/",
    ).toBe(false);
  });

  it("use the section headings the changelog already shows", () => {
    const changelog = fs.readFileSync(CHANGELOG, "utf-8");
    const missing = SECTIONS.filter((heading) => !changelog.includes(`\n${heading}\n`));
    expect(
      missing,
      "scripts/changelog.mjs names a section the changelog spells differently",
    ).toEqual([]);
  });
});

describe("a changelog fragment", () => {
  it("takes a breaking note, a note before updating and entries in two sections", () => {
    const fragment = parseFragment(
      [
        "> ⚠️ **Breaking:** The old endpoint is gone.",
        "",
        "> ⚠️ **Before updating:** Back up the data directory first.",
        "",
        "### 🐛 Bug Fixes",
        "",
        "- **web**: Downloads work on Safari again. A failed one shows the error.",
        "",
        "### ✨ Features",
        "",
        "- **server**: Uploads can be named ([#67](https://github.com/Skyfay/SkySend/issues/67)).",
      ].join("\n"),
      "Skyfay-safari.md",
    );

    expect(fragment.problems).toEqual([]);
    expect(fragment.notes).toEqual([
      "> ⚠️ **Breaking:** The old endpoint is gone.",
      "> ⚠️ **Before updating:** Back up the data directory first.",
    ]);
    expect([...fragment.sections.keys()]).toEqual(["### 🐛 Bug Fixes", "### ✨ Features"]);
  });

  it("turns down a section the changelog does not have, and the Docker section the release writes", () => {
    expect(problemsOf("### 🚀 Shiny\n\n- **web**: New.")).toEqual([
      '"### 🚀 Shiny" is not one of the changelog sections',
    ]);
    expect(problemsOf("### 🐳 Docker\n\n- **docker**: `skyfay/skysend:v2`")).toEqual([
      "the release writes the Docker section",
    ]);
  });

  it("turns down a version header, which the release writes", () => {
    expect(problemsOf("## vNEXT\n\n### 🐛 Bug Fixes\n\n- **web**: Fixed.")).toEqual([
      "a fragment has no version header, the release writes it",
    ]);
  });

  it("turns down a scope that is not a part of the monorepo, or two joined", () => {
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **ui**: Fixed.")).toEqual([
      '"ui" is not a scope, use one of server, web, client, cli, crypto, docs, website, docker, infra',
    ]);
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **web, server**: Fixed.")[0]).toMatch(
      /^"web, server" is not a scope/,
    );
  });

  it("keeps entries under a section and notes above the first one", () => {
    expect(problemsOf("- **web**: Fixed.")).toEqual(["an entry goes under a section"]);
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **web**: Fixed.\n\n> ⚠️ **Breaking:** Late.")).toEqual(
      ["a note goes above the first section"],
    );
    expect(problemsOf("> just a quote")).toEqual([
      'a note starts with a bold label, like "> ⚠️ **Breaking:**"',
    ]);
  });

  it("turns down an entry with a semicolon, a dash or a third sentence", () => {
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **web**: One part; another part.")).toEqual([
      "a description has no `;`",
    ]);
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **web**: One part - another part.")).toEqual([
      "a description uses no hyphen as a dash",
    ]);
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **web**: One. Two. Three.")).toEqual([
      "a description has at most two sentences, this one has 3",
    ]);
  });

  it("counts code, versions, a hyphenated word and a link at the end as no extra sentence", () => {
    expect(
      problemsOf(
        "### 🐛 Bug Fixes\n\n- **server**: `GET /api/health` works on v2.12.1 again, behind a self-hosted proxy too. It returns `ok` ([#9](https://github.com/x/y/issues/9)).",
      ),
    ).toEqual([]);
  });

  it("turns down a line that is no entry, like a wrapped one", () => {
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **web**: A long entry\n  that goes on.")).toEqual([
      '"  that goes on." is no entry, write it as - **scope**: description',
    ]);
  });

  it("turns down an empty file, an empty section and a file name with a space", () => {
    expect(problemsOf("\n\n")).toEqual(["the fragment is empty"]);
    expect(problemsOf("### 🐛 Bug Fixes\n")).toEqual(['"### 🐛 Bug Fixes" has no entries']);
    expect(problemsOf("### 🐛 Bug Fixes\n\n- **web**: Fixed.", "my fix.md")).toEqual([
      "the file name holds letters, digits, dots, dashes and underscores and ends in .md",
    ]);
  });
});

describe("the version block of a release", () => {
  const first = parseFragment("### 🐛 Bug Fixes\n\n- **web**: First fix.", "a.md");
  const second = parseFragment(
    "> ⚠️ **Breaking:** Something breaks.\n\n### 🔧 CI/CD\n\n- **infra**: A pipeline.\n\n### ✨ Features\n\n- **server**: A feature.\n\n### 🐛 Bug Fixes\n\n- **client**: Second fix.",
    "b.md",
  );

  it("puts the notes first and the sections in the order of the changelog", () => {
    const block = renderBlock("2.13.0", "`latest`, `v2`", [first, second]);

    expect(block.split("\n").slice(0, 19)).toEqual([
      "## v2.13.0",
      "",
      "*Release: In Progress*",
      "",
      "> ⚠️ **Breaking:** Something breaks.",
      "",
      "### ✨ Features",
      "",
      "- **server**: A feature.",
      "",
      "### 🐛 Bug Fixes",
      "",
      "- **web**: First fix.",
      "- **client**: Second fix.",
      "",
      "### 🔧 CI/CD",
      "",
      "- **infra**: A pipeline.",
      "",
    ]);
  });

  it("ends with the Docker section of the version and its tags", () => {
    const block = renderBlock("2.13.0", "`latest`, `v2`", [first]);

    expect(
      block.endsWith(
        [
          "### 🐳 Docker",
          "",
          "- **Image**: `skyfay/skysend:v2.13.0`",
          "- **Also tagged as**: `latest`, `v2`",
          "- **Platforms**: linux/amd64, linux/arm64",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  it("goes above the newest version with one blank line before it", () => {
    const changelog = insertBlock(RELEASED, "## v2.13.0\n\n*Release: In Progress*");

    expect(changelog).toBe(
      [
        "# Changelog",
        "",
        "All notable changes to SkySend are documented here.",
        "",
        "## v2.13.0",
        "",
        "*Release: In Progress*",
        "",
        "## v2.12.1 - Link Preview and Branding Improvements",
        "",
        "*Released: September 17, 2026*",
        "",
      ].join("\n"),
    );
  });
});

describe("the entries of a section", () => {
  it("are grouped by scope in the order of the scopes, each keeping the order of its fragments", () => {
    const first = parseFragment(
      "### ✨ Features\n\n- **web**: Web one.\n- **infra**: Infra one.\n- **server**: Server one.",
      "a.md",
    );
    const second = parseFragment(
      "### ✨ Features\n\n- **client**: Client one.\n- **web**: Web two.\n- **server**: Server two.",
      "b.md",
    );

    const block = renderBlock("3.0.0", "`latest`, `v3`", [first, second]);
    const features = block.split("\n").filter((line) => line.startsWith("- **"));
    expect(features.slice(0, 6)).toEqual([
      "- **server**: Server one.",
      "- **server**: Server two.",
      "- **web**: Web one.",
      "- **web**: Web two.",
      "- **client**: Client one.",
      "- **infra**: Infra one.",
    ]);
  });
});

describe("a release", () => {
  it("writes the block into the changelog and deletes the fragments, but keeps the README", () => {
    const files = memoryFiles({
      [MEMORY_CHANGELOG]: RELEASED,
      [`${DIR}/README.md`]: "# Unreleased changelog entries",
      [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **web**: Fixed.",
    });

    const used = release({
      version: "2.13.0",
      tags: "`latest`, `v2`",
      dir: DIR,
      changelog: MEMORY_CHANGELOG,
    });

    expect(used.map((fragment) => fragment.name)).toEqual(["Skyfay-fix.md"]);
    expect(files.get(MEMORY_CHANGELOG)).toContain(
      "## v2.13.0\n\n*Release: In Progress*\n\n### 🐛 Bug Fixes\n\n- **web**: Fixed.",
    );
    expect([...files.keys()]).toEqual([MEMORY_CHANGELOG, `${DIR}/README.md`]);
  });

  it("changes nothing while a fragment breaks the format", () => {
    const files = memoryFiles({
      [MEMORY_CHANGELOG]: RELEASED,
      [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **web**: One; two.",
    });

    expect(() =>
      release({ version: "2.13.0", tags: "`latest`, `v2`", dir: DIR, changelog: MEMORY_CHANGELOG }),
    ).toThrow(/Skyfay-fix\.md: line 3: a description has no `;`/);
    expect(files.get(MEMORY_CHANGELOG)).toBe(RELEASED);
    expect(files.has(`${DIR}/Skyfay-fix.md`)).toBe(true);
  });

  it("tells a version apart from a pre-release of it", () => {
    const files = memoryFiles({
      [MEMORY_CHANGELOG]: RELEASED.replace("## v2.12.1 - ", "## v2.13.0-beta - "),
      [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **web**: Fixed.",
    });

    release({ version: "2.13.0", tags: "`latest`, `v2`", dir: DIR, changelog: MEMORY_CHANGELOG });

    expect(files.get(MEMORY_CHANGELOG)).toContain("## v2.13.0\n");
  });

  it("refuses a version the changelog lists already", () => {
    const files = memoryFiles({
      [MEMORY_CHANGELOG]: RELEASED,
      [`${DIR}/Skyfay-fix.md`]: "### 🐛 Bug Fixes\n\n- **web**: Fixed.",
    });

    expect(() =>
      release({ version: "2.12.1", tags: "`latest`, `v2`", dir: DIR, changelog: MEMORY_CHANGELOG }),
    ).toThrow(/already lists v2\.12\.1/);
    expect(files.has(`${DIR}/Skyfay-fix.md`)).toBe(true);
  });
});

describe("the thanks of an outside contribution", () => {
  const PR_81 = "Thanks @NotAFlightRisk ([#81](https://github.com/Skyfay/SkySend/pull/81))";
  const contribution = { author: "NotAFlightRisk", number: 81 };

  it("goes at the end of every entry of the fragment", () => {
    const fragment = parseFragment(
      "### 🐛 Bug Fixes\n\n- **client**: Kept the file.\n\n### 🧪 Tests\n\n- **client**: Covered it.",
      "fix-keep-file-on-failed-download.md",
    );
    const credited = creditFragment(fragment, contribution);
    expect(credited.sections.get("### 🐛 Bug Fixes")).toEqual([
      `- **client**: Kept the file. ${PR_81}`,
    ]);
    expect(credited.sections.get("### 🧪 Tests")).toEqual([`- **client**: Covered it. ${PR_81}`]);
    // The fragment read from disk stays as it was.
    expect(fragment.sections.get("### 🐛 Bug Fixes")).toEqual(["- **client**: Kept the file."]);
  });

  it("leaves an entry that thanks someone already, and a fragment without a contribution", () => {
    const advisory =
      "- **server**: Fixed. Thanks @rajnisht7 ([GHSA-9rmm-v3p2-c26g](https://github.com/Skyfay/SkySend/security/advisories/GHSA-9rmm-v3p2-c26g))";
    const fragment = parseFragment(`### 🔒 Security\n\n${advisory}`, "fix.md");
    expect(creditFragment(fragment, contribution).sections.get("### 🔒 Security")).toEqual([
      advisory,
    ]);
    expect(creditFragment(fragment, null)).toBe(fragment);
  });

  it("ends up in the version block of the release", () => {
    const files = memoryFiles({
      [MEMORY_CHANGELOG]: RELEASED,
      [`${DIR}/fix-keep-file-on-failed-download.md`]:
        "### 🐛 Bug Fixes\n\n- **client**: Kept the file.",
    });

    release({
      version: "2.13.0",
      tags: "`latest`, `v2`",
      dir: DIR,
      changelog: MEMORY_CHANGELOG,
      credit: (fragments) => creditAll(fragments, () => contribution).fragments,
    });

    expect(files.get(MEMORY_CHANGELOG)).toContain(`- **client**: Kept the file. ${PR_81}`);
  });

  it("is left out for a fragment whose lookup fails, which the release names", () => {
    const fragments = [
      parseFragment("### 🐛 Bug Fixes\n\n- **client**: One.", "a.md"),
      parseFragment("### 🐛 Bug Fixes\n\n- **web**: Two.", "b.md"),
    ];
    const { fragments: credited, missing } = creditAll(fragments, (name) => {
      if (name === "a.md") throw new Error("gh: not logged in");
      return contribution;
    });
    expect(missing).toEqual(["a.md"]);
    expect(credited[0]).toBe(fragments[0]);
    expect(credited[1]?.sections.get("### 🐛 Bug Fixes")).toEqual([`- **web**: Two. ${PR_81}`]);
  });
});

describe("the pull request behind a fragment", () => {
  const SHA = "5e3d2206161668ba7e428dd0e6550dfc7ddbfd5c";

  /** Answers git with the commit that added the fragment and gh with the pull request. */
  function answers(git: string, gh: string) {
    const calls: Array<[string, string[]]> = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, args]);
      return command === "git" ? git : gh;
    };
    return { run, calls };
  }

  it("is the pull request of the commit that added the file, with its author", () => {
    const { run, calls } = answers(`${SHA}\n`, "81\tNotAFlightRisk\tUser\n");
    expect(findContribution("fix.md", { dir: DIR, run })).toEqual({
      author: "NotAFlightRisk",
      number: 81,
    });
    expect(calls[0]).toEqual([
      "git",
      ["log", "-1", "--diff-filter=A", "--format=%H", "--", `${DIR}/fix.md`],
    ]);
    expect(calls[1]?.[1]).toContain(`repos/Skyfay/SkySend/commits/${SHA}/pulls`);
  });

  it("thanks nobody for a maintainer's pull request, a bot's, or a fragment without one", () => {
    expect(findContribution("a.md", { dir: DIR, ...answers(SHA, "80\tSkyfay\tUser") })).toBeNull();
    expect(
      findContribution("a.md", { dir: DIR, ...answers(SHA, "90\tdependabot[bot]\tBot") }),
    ).toBeNull();
    expect(findContribution("a.md", { dir: DIR, ...answers(SHA, "") })).toBeNull();
    // A fragment that is not committed yet.
    expect(findContribution("a.md", { dir: DIR, ...answers("", "unused") })).toBeNull();
  });

  it("turns down an answer that does not look like what GitHub hands out", () => {
    for (const gh of [
      "81\tevil)](https://x.example)\tUser",
      "0\tsomeone\tUser",
      "81\t-dash\tUser",
    ]) {
      expect(() => findContribution("a.md", { dir: DIR, ...answers(SHA, gh) })).toThrow(
        /no pull request/,
      );
    }
    expect(() => findContribution("a.md", { dir: DIR, ...answers("not-a-sha", "") })).toThrow(
      /no commit/,
    );
  });
});

describe("adding fragments to a version block written already", () => {
  const BUMPED = [
    "# Changelog",
    "",
    "All notable changes to SkySend are documented here.",
    "",
    "## v3.0.1 - Fixes",
    "",
    "*Released: October 10, 2026*",
    "",
    "### 🐛 Bug Fixes",
    "",
    "- **server**: Uploads resume after a lost connection.",
    "- **docker**: The image starts without internet access.",
    "",
    "### 🐳 Docker",
    "",
    "- **Image**: `skyfay/skysend:v3.0.1`",
    "- **Also tagged as**: `latest`, `v3`",
    "- **Platforms**: linux/amd64, linux/arm64",
    "",
    "## v3.0.0 - File and Note Requests",
    "",
    "*Released: October 4, 2026*",
    "",
  ].join("\n");

  it("sorts the new entries in by scope and keeps the title, the date and the Docker section", () => {
    const files = memoryFiles({
      [MEMORY_CHANGELOG]: BUMPED,
      [`${DIR}/late-fix.md`]: "### 🐛 Bug Fixes\n\n- **web**: The upload page loads again.\n\n### 🔧 CI/CD\n\n- **infra**: The release tags itself.",
    });

    amend({ version: "3.0.1", dir: DIR, changelog: MEMORY_CHANGELOG });
    expect(files.get(MEMORY_CHANGELOG)).toBe(
      BUMPED.replace(
        "- **server**: Uploads resume after a lost connection.\n",
        "- **server**: Uploads resume after a lost connection.\n- **web**: The upload page loads again.\n",
      ).replace("\n### 🐳 Docker", "\n### 🔧 CI/CD\n\n- **infra**: The release tags itself.\n\n### 🐳 Docker"),
    );
    expect(files.has(`${DIR}/late-fix.md`)).toBe(false);
  });

  it("refuses a block with a line it cannot read, and changes nothing", () => {
    const handWritten = BUMPED.replace("*Released: October 10, 2026*\n", "*Released: October 10, 2026*\n\nA paragraph written by hand.\n");
    const files = memoryFiles({
      [MEMORY_CHANGELOG]: handWritten,
      [`${DIR}/late-fix.md`]: "### 🐛 Bug Fixes\n\n- **web**: The upload page loads again.",
    });

    expect(() => amend({ version: "3.0.1", dir: DIR, changelog: MEMORY_CHANGELOG })).toThrow(/by hand/);
    expect(files.get(MEMORY_CHANGELOG)).toBe(handWritten);
    expect(files.has(`${DIR}/late-fix.md`)).toBe(true);
  });

  it("refuses a version the changelog has no block for", () => {
    memoryFiles({ [MEMORY_CHANGELOG]: BUMPED, [`${DIR}/late-fix.md`]: "### 🐛 Bug Fixes\n\n- **web**: Fixed." });
    expect(() => amend({ version: "9.9.9", dir: DIR, changelog: MEMORY_CHANGELOG })).toThrow(/no block for v9\.9\.9/);
  });

  it("lists the versions of the changelog, newest first", () => {
    expect(listedVersions(BUMPED)).toEqual(["3.0.1", "3.0.0"]);
  });
});
