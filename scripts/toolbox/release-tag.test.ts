import { describe, expect, it } from "vitest";
import { TAG, releaseHeading, remoteTag, tagMessage } from "./release-tag.mjs";

const CHANGELOG = [
  "# Changelog",
  "",
  "All notable changes to SkySend are documented here.",
  "",
  "## v4.0.1 - Offline First Start, Docker Socket and Rsync Fixes, and Updated Guides",
  "*Release: In Progress*",
  "",
  "## v4.0.0 - Redesigned Interface",
  "*Released: Oct 4, 2026*",
  "",
  "## v3.9.0",
  "*Released: Sep 1, 2026*",
].join("\n");

describe("the tag of a release", () => {
  it("takes its message from the heading of the version in the changelog", () => {
    const heading = releaseHeading(CHANGELOG, "4.0.1");
    expect(heading).toEqual({ title: "Offline First Start, Docker Socket and Rsync Fixes, and Updated Guides", inProgress: true });
    expect(tagMessage("v4.0.1", heading?.title ?? null)).toBe(
      "v4.0.1 - Offline First Start, Docker Socket and Rsync Fixes, and Updated Guides",
    );
  });

  it("finds the in progress line below an empty line, the way this changelog writes it", () => {
    expect(releaseHeading("## v3.0.1 - Fixes\n\n*Release: In Progress*\n", "3.0.1")).toEqual({ title: "Fixes", inProgress: true });
  });

  it("knows a version that shipped with its date", () => {
    expect(releaseHeading(CHANGELOG, "4.0.0")).toEqual({ title: "Redesigned Interface", inProgress: false });
  });

  it("tags a version without a title with its name alone", () => {
    expect(releaseHeading(CHANGELOG, "3.9.0")).toEqual({ title: null, inProgress: false });
    expect(tagMessage("v3.9.0", null)).toBe("v3.9.0");
  });

  it("does not take the block of a beta for the release of the same version", () => {
    expect(releaseHeading("## v4.1.0-beta - Preview\n*Release: In Progress*\n", "4.1.0")).toBeNull();
  });

  it("accepts release tags only", () => {
    expect(TAG.test("v4.0.1")).toBe(true);
    expect(TAG.test("v4.1.0-beta")).toBe(true);
    expect(TAG.test("4.0.1")).toBe(false);
    expect(TAG.test("v4.0.1; rm -rf /")).toBe(false);
  });
});

describe("a tag on GitHub", () => {
  it("points to the commit of an annotated tag, not to the tag object", () => {
    const sha = remoteTag("v4.0.0", {
      run: () =>
        "5c7cdc2ad2ff12bd0a185ebf8e4a1a8ec6a41d31\trefs/tags/v4.0.0\nbdb737fa62f2d98df26d542e0215f841e2f95569\trefs/tags/v4.0.0^{}",
    });
    expect(sha).toBe("bdb737fa62f2d98df26d542e0215f841e2f95569");
  });

  it("is missing when GitHub lists nothing", () => {
    expect(remoteTag("v9.9.9", { run: () => "" })).toBeNull();
  });
});
