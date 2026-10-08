import fs from "node:fs";
import path from "node:path";
import { CHANGELOG_URL } from "@/lib/content";

export interface Release {
  version: string;
  /** YYYY-MM-DD, or null while its block still says "Release: In Progress". */
  date: string | null;
  /** The link to the version block in the changelog on the docs site. */
  href: string;
}

/** The anchor VitePress gives a heading, so a release links to its own block. */
function vitepressSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

let cached: Release[] | null = null;

/**
 * Every version in `docs/changelog.md`, newest first, read at build time. The
 * changelog is the source of truth: a version links to its block as soon as
 * `pnpm version:bump` writes it, and gets its date once the block says
 * "Released". Pre-releases like v3.0.0-beta are left out. Empty when the build
 * runs without the rest of the repository.
 */
export function getReleases(): Release[] {
  if (cached) return cached;
  let text: string;
  try {
    text = fs.readFileSync(path.join(process.cwd(), "..", "docs", "changelog.md"), "utf8");
  } catch {
    return (cached = []);
  }
  const releases: Release[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const head = line.match(/^## (v\d+\.\d+\.\d+)(?=\s|$)/);
    if (!head) return;
    const near = lines.slice(i + 1, i + 4).join("\n");
    const released = near.match(/\*Released: ([A-Za-z]+ \d{1,2}, \d{4})\*/);
    const date = released ? new Date(`${released[1]} UTC`) : null;
    const title = line.slice(3).replace(/&amp;/g, "&");
    releases.push({
      version: head[1],
      date: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
      href: `${CHANGELOG_URL}#${vitepressSlug(title)}`,
    });
  });
  return (cached = releases);
}

export function findRelease(version: string | undefined): Release | undefined {
  return version ? getReleases().find((r) => r.version === version) : undefined;
}
