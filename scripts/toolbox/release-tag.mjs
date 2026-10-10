// @ts-check
/**
 * The git tag of a release, which starts the release workflow.
 *
 * A release merges dev into main, and the tag goes on that merge commit, whichever branch is
 * checked out here. It is annotated with the title of its version in docs/changelog.md on main,
 * like `v3.0.0 - File and Note Requests, ...`, the way every release so far was tagged.
 *
 *   pnpm release:tag            proposes the tag of the version on main, then creates and pushes it
 *   pnpm release:untag [tag]    deletes a tag here and on GitHub, so a release can be tagged again
 */

import { REPO, ask, attempt, confirm, fail, messageOf, out, run } from "./cli.mjs";

/** A release tag: `v` and a version, with an optional suffix like `-beta`. */
export const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The line the changelog writes below a version until it ships. */
const IN_PROGRESS = "*Release: In Progress*";

/**
 * The heading of a version in the changelog: its title, and whether it still says it is in
 * progress. Null when the changelog has no block for the version.
 *
 * @param {string} changelog
 * @param {string} version
 * @returns {{ title: string | null, inProgress: boolean } | null}
 */
export function releaseHeading(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = `## v${version}`;
  const at = lines.findIndex((line) => line === heading || line.startsWith(`${heading} - `));
  if (at === -1) return null;
  const title = lines[at].slice(heading.length).replace(/^ - /, "").trim() || null;
  const next = lines.slice(at + 1).find((line) => line.trim() !== "");
  return { title, inProgress: next?.trim() === IN_PROGRESS };
}

/**
 * The message of a tag, like the heading of its version in the changelog.
 *
 * @param {string} tag
 * @param {string | null} title
 * @returns {string}
 */
export function tagMessage(tag, title) {
  return title ? `${tag} - ${title}` : tag;
}

/**
 * The commit a tag points to on GitHub, or null when GitHub has no such tag.
 *
 * @param {string} tag
 * @param {{ run?: (command: string, args: string[]) => string }} [options]
 * @returns {string | null}
 */
export function remoteTag(tag, { run: exec = run } = {}) {
  const lines = exec("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  if (lines.length === 0) return null;
  // An annotated tag is listed twice, the second time peeled to the commit it points to.
  const peeled = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
  return (peeled ?? lines[0])[0];
}

/**
 * The commit a tag here points to, or null without one.
 *
 * @param {string} tag
 * @returns {string | null}
 */
function localTag(tag) {
  return attempt("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}^{commit}`]);
}

/**
 * Asks for a tag of its own, when the proposed one is not wanted. Null when none was given.
 *
 * @param {string} changelog
 * @returns {Promise<{ tag: string, message: string } | null>}
 */
async function askForTag(changelog) {
  const tag = await ask("Tag (empty to stop): ");
  if (tag === "") return null;
  if (!TAG.test(tag)) throw new Error(`${tag} is no release tag like v1.2.3 or v1.2.3-beta.`);
  const proposed = tagMessage(tag, releaseHeading(changelog, tag.slice(1))?.title ?? null);
  const message = (await ask(`Message [${proposed}]: `)) || proposed;
  return { tag, message };
}

/** `pnpm release:tag`: proposes the tag of the version on main, then creates and pushes it. */
export async function tagCommand() {
  run("git", ["fetch", "--quiet", "origin", "main"]);
  const commit = run("git", ["rev-parse", "origin/main"]);
  const subject = run("git", ["log", "-1", "--format=%s", "origin/main"]);
  const version = JSON.parse(run("git", ["show", "origin/main:package.json"])).version;
  const changelog = run("git", ["show", "origin/main:docs/changelog.md"]);
  const heading = releaseHeading(changelog, version);

  out(`main is at ${commit.slice(0, 7)} ${subject}, with version ${version}.`);
  if (!heading) out(`docs/changelog.md on main has no block for v${version}, so the message gets no title.`);
  else if (heading.inProgress) {
    out(`docs/changelog.md on main still says "Release: In Progress" for v${version}. The GitHub release copies that line.`);
  }

  let chosen = { tag: `v${version}`, message: tagMessage(`v${version}`, heading?.title ?? null) };
  const tagged = remoteTag(chosen.tag);
  if (tagged) {
    out(`${chosen.tag} is tagged on GitHub already, on ${tagged.slice(0, 7)}.`);
    const own = await askForTag(changelog);
    if (!own) {
      out("Stopped, no tag created.");
      return;
    }
    chosen = own;
  } else {
    out("");
    out(`  Tag:     ${chosen.tag}`);
    out(`  Message: ${chosen.message}`);
    out("");
    if (!(await confirm("Create this tag on main and push it?", true))) {
      const own = await askForTag(changelog);
      if (!own) {
        out("Stopped, no tag created.");
        return;
      }
      chosen = own;
    }
  }

  const { tag, message } = chosen;
  if (tag !== `v${version}` || tagged) {
    if (tag !== `v${version}`) out(`main is at version ${version}, the tag says ${tag}.`);
    if (!(await confirm(`Create ${tag} with "${message}" on main and push it?`, false))) {
      out("Stopped, no tag created.");
      return;
    }
  }

  const elsewhere = remoteTag(tag);
  if (elsewhere) {
    fail(`${tag} is on GitHub already, on ${elsewhere.slice(0, 7)}. Delete it first with pnpm release:untag ${tag}.`);
    return;
  }
  const leftover = localTag(tag);
  if (leftover) {
    out(`${tag} exists here already, on ${leftover.slice(0, 7)}, but not on GitHub.`);
    if (!(await confirm(`Replace the ${tag} here?`, false))) {
      out("Stopped, no tag created.");
      return;
    }
    run("git", ["tag", "-d", tag]);
  }

  run("git", ["tag", "-a", tag, "-m", message, commit]);
  try {
    run("git", ["push", "origin", `refs/tags/${tag}`]);
  } catch (error) {
    run("git", ["tag", "-d", tag]);
    fail(`Pushing ${tag} failed, so it is deleted here again: ${messageOf(error)}`);
    return;
  }
  out(`${tag} is on GitHub, on ${commit.slice(0, 7)}. The release workflow starts now:`);
  out(`  https://github.com/${REPO}/actions/workflows/release.yml`);
}

/**
 * `pnpm release:untag [tag]`: deletes a tag here and on GitHub.
 *
 * @param {string | undefined} given
 */
export async function untagCommand(given) {
  run("git", ["fetch", "--quiet", "--tags", "origin"]);
  let tag = given;
  if (!tag) {
    const recent = run("git", ["tag", "--list", "v*", "--sort=-creatordate"]).split("\n").filter(Boolean).slice(0, 5);
    if (recent.length === 0) {
      fail("There is no tag to delete.");
      return;
    }
    out(`Newest tags: ${recent.join(", ")}`);
    tag = (await ask(`Tag to delete [${recent[0]}]: `)) || recent[0];
  }
  if (!TAG.test(tag)) {
    fail(`${tag} is no release tag like v1.2.3 or v1.2.3-beta.`);
    return;
  }

  const local = localTag(tag);
  const remote = remoteTag(tag);
  if (!local && !remote) {
    fail(`${tag} exists neither here nor on GitHub.`);
    return;
  }
  out(`  here:   ${local ? local.slice(0, 7) : "no"}`);
  out(`  GitHub: ${remote ? remote.slice(0, 7) : "no"}`);
  const release = attempt("gh", ["release", "view", tag, "--repo", REPO, "--json", "url", "--jq", ".url"]);
  if (release) {
    out(`There is a GitHub release for ${tag}, ${release}`);
    out("It stays, and so do the images the workflow pushed. Delete the release on GitHub as well if it should go.");
  }

  const where = local && remote ? "here and on GitHub" : remote ? "on GitHub" : "here";
  if (!(await confirm(`Delete ${tag} ${where}?`, false))) {
    out("Stopped, nothing deleted.");
    return;
  }
  // GitHub first, since it can refuse, a tag of a published release for one. The tag here stays then.
  if (remote) run("git", ["push", "origin", `:refs/tags/${tag}`]);
  if (local) run("git", ["tag", "-d", tag]);
  out(`${tag} is deleted ${where}.`);
}
