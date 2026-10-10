// @ts-check
/**
 * Open CodeQL alerts on dev, before they reach a release.
 *
 * CodeQL scans every push to dev, but shows what it finds only on the Security tab, so the pull
 * request from dev into main used to be the first place an alert came up. This asks GitHub for
 * the alerts open on dev that main does not have, which are what that pull request reports as
 * new, and whether the scan of the latest commit on dev is finished.
 *
 *   pnpm codeql:check    lists them, and exits 1 only when GitHub could not be asked
 *
 * `pnpm version:bump` runs the same check before it changes anything, and asks whether to go on.
 */

import { REPO, confirm, fail, messageOf, out, run } from "./cli.mjs";

/**
 * @typedef {{
 *     number: number,
 *     html_url: string,
 *     rule: { id: string, description: string, severity?: string | null, security_severity_level?: string | null },
 *     most_recent_instance: { location: { path: string, start_line: number } },
 * }} Alert
 * @typedef {{ category: string, commit_sha: string, created_at: string }} Analysis
 * @typedef {{ head: string, unpushed: number, alerts: Alert[], pending: string[] }} Scan
 */

/**
 * The alerts open on dev that main does not have. An alert keeps its number on every branch.
 *
 * @param {Alert[]} dev
 * @param {Alert[]} main
 * @returns {Alert[]}
 */
export function newAlerts(dev, main) {
  const onMain = new Set(main.map((alert) => alert.number));
  return dev.filter((alert) => !onMain.has(alert.number));
}

/**
 * The languages whose latest analysis is not of `head` yet. CodeQL analyses every language on
 * its own, and the slower one decides when the scan of a commit is complete.
 *
 * @param {Analysis[]} analyses
 * @param {string} head
 * @returns {string[]}
 */
export function pendingLanguages(analyses, head) {
  if (analyses.length === 0) return ["no analysis yet"];
  /** @type {Map<string, Analysis>} */
  const latest = new Map();
  for (const analysis of analyses) {
    const known = latest.get(analysis.category);
    if (!known || analysis.created_at > known.created_at) latest.set(analysis.category, analysis);
  }
  return [...latest.values()]
    .filter((analysis) => analysis.commit_sha !== head)
    .map((analysis) => analysis.category.replace(/^\/language:/, ""));
}

/**
 * Asks git and GitHub for the state of dev. Throws when one of them cannot answer, like gh not
 * being logged in.
 *
 * @param {{ run?: (command: string, args: string[]) => string }} [options]
 * @returns {Scan}
 */
export function scanDev({ run: exec = run } = {}) {
  exec("git", ["fetch", "--quiet", "origin", "dev"]);
  const head = exec("git", ["rev-parse", "origin/dev"]);
  // Commits here that are not on dev yet, which CodeQL has not seen.
  const unpushed = Number(exec("git", ["rev-list", "--count", "origin/dev..HEAD"])) || 0;
  /** @param {string} endpoint */
  const api = (endpoint) => JSON.parse(exec("gh", ["api", endpoint]));
  /** @type {Analysis[]} */
  const analyses = api(`repos/${REPO}/code-scanning/analyses?ref=refs/heads/dev&per_page=30`);
  /** @type {Alert[]} */
  const dev = api(`repos/${REPO}/code-scanning/alerts?ref=refs/heads/dev&state=open&per_page=100`);
  /** @type {Alert[]} */
  const main = api(`repos/${REPO}/code-scanning/alerts?ref=refs/heads/main&state=open&per_page=100`);
  return { head, unpushed, alerts: newAlerts(dev, main), pending: pendingLanguages(analyses, head) };
}

/**
 * The scan as lines for the terminal. No line means there is nothing to look at.
 *
 * @param {Scan} scan
 * @returns {string[]}
 */
export function describeScan(scan) {
  const lines = [];
  const short = scan.head.slice(0, 7);
  if (scan.pending.length > 0) {
    lines.push(`CodeQL has not finished dev at ${short} yet (${scan.pending.join(", ")}), so alerts may still come.`);
  }
  if (scan.unpushed > 0) {
    lines.push(`${scan.unpushed} commit${scan.unpushed === 1 ? " is" : "s are"} not pushed to dev yet, CodeQL has not seen ${scan.unpushed === 1 ? "it" : "them"}.`);
  }
  if (scan.alerts.length > 0) {
    lines.push(`CodeQL has ${scan.alerts.length} open alert${scan.alerts.length === 1 ? "" : "s"} on dev that main does not have:`);
    for (const alert of scan.alerts) {
      const severity = alert.rule.security_severity_level ?? alert.rule.severity ?? "";
      const { path: file, start_line: line } = alert.most_recent_instance.location;
      lines.push(`  #${alert.number} ${severity ? `[${severity}] ` : ""}${alert.rule.description}`);
      lines.push(`      ${file}:${line}  ${alert.html_url}`);
    }
  }
  return lines;
}

/**
 * The check before a release. Goes on by itself when dev is clean, otherwise only when the person
 * at the terminal says so.
 *
 * @returns {Promise<boolean>}
 */
export async function confirmCleanDev() {
  /** @type {Scan} */
  let scan;
  try {
    scan = scanDev();
  } catch (error) {
    out(`Could not ask GitHub for the CodeQL alerts on dev: ${messageOf(error)}`);
    return confirm("Go on without the CodeQL check?", false);
  }
  const lines = describeScan(scan);
  if (lines.length === 0) {
    out(`CodeQL: nothing open on dev at ${scan.head.slice(0, 7)}.`);
    return true;
  }
  for (const line of lines) out(line);
  return confirm("Go on anyway?", false);
}

/** `pnpm codeql:check`: lists the alerts, or says that there are none. */
export function checkCommand() {
  try {
    const lines = describeScan(scanDev());
    if (lines.length === 0) {
      out("CodeQL: nothing open on dev that main does not have.");
      return;
    }
    for (const line of lines) out(line);
  } catch (error) {
    fail(`Could not ask GitHub for the CodeQL alerts on dev: ${messageOf(error)}`);
  }
}
