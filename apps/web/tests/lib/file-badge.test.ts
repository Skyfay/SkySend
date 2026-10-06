import { describe, expect, it } from "vitest";
import { fileBadge } from "../../src/lib/file-badge";

const NEUTRAL = "bg-muted text-muted-foreground";

describe("fileBadge", () => {
  it.each([
    ["report.pdf", "PDF", "blue"],
    ["holiday.jpg", "JPG", "sky"],
    ["backup.tar.gz", "GZ", "amber"],
    ["clip.mp4", "MP4", "rose"],
    ["deploy.yaml", "YAML", "emerald"],
  ])("labels %s as %s in the %s of its kind", (name, label, color) => {
    const badge = fileBadge(name);
    expect(badge.label).toBe(label);
    expect(badge.className).toContain(`text-${color}-`);
  });

  it("gives every colored kind a variant for the dark color scheme", () => {
    for (const name of ["a.pdf", "a.png", "a.zip", "a.mov", "a.ts"]) {
      expect(fileBadge(name).className).toMatch(/dark:text-\w+-300/);
    }
  });

  it("reads the extension regardless of case", () => {
    expect(fileBadge("PHOTO.HEIC")).toEqual(fileBadge("photo.heic"));
  });

  it("cuts a long extension to four characters", () => {
    expect(fileBadge("deck.pages").label).toBe("PAGE");
  });

  it("treats a dotfile name as its extension", () => {
    expect(fileBadge(".env").label).toBe("ENV");
    expect(fileBadge(".env").className).toContain("text-emerald-");
  });

  it("shows an unknown extension in a neutral badge", () => {
    expect(fileBadge("data.xyz")).toEqual({ label: "XYZ", className: NEUTRAL });
  });

  it("says FILE when there is no extension", () => {
    expect(fileBadge("Makefile")).toEqual({ label: "FILE", className: NEUTRAL });
    expect(fileBadge("draft.")).toEqual({ label: "FILE", className: NEUTRAL });
  });
});
