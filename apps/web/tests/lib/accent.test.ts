import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT_DARK,
  DEFAULT_ACCENT_LIGHT,
  TEXT_CONTRAST,
  accentCss,
  contrast,
  deriveAccent,
  parseHex,
} from "../../src/lib/accent";

// Colors an operator might plausibly pick, including the hard cases at both ends.
const SAMPLES = [
  "#2eb68c", "#46c89d", "#00b378", "#2563eb", "#7c3aed", "#e11d48", "#dc2626",
  "#f59e0b", "#fde047", "#84cc16", "#06b6d4", "#ec4899", "#64748b",
  "#000000", "#18181b", "#ffffff", "#f4f4f5", "#808080", "#777777",
];

// Every 17th gray step plus a hue sweep, so no mid-tone slips through.
const SWEEP = [
  ...Array.from({ length: 16 }, (_, i) => {
    const v = (i * 17).toString(16).padStart(2, "0");
    return `#${v}${v}${v}`;
  }),
  ...Array.from({ length: 24 }, (_, i) => {
    const h = (i * 15) / 60;
    const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)));
    const [r, g, b] = h < 1 ? [255, x, 0] : h < 2 ? [x, 255, 0] : h < 3 ? [0, 255, x] : h < 4 ? [0, x, 255] : h < 5 ? [x, 0, 255] : [255, 0, x];
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }),
];

describe("parseHex", () => {
  it("accepts six hex digits with or without the hash", () => {
    expect(parseHex("#2eb68c")).toEqual([46, 182, 140]);
    expect(parseHex("2EB68C")).toEqual([46, 182, 140]);
  });

  it("rejects anything else", () => {
    expect(() => parseHex("#fff")).toThrow();
    expect(() => parseHex("red")).toThrow();
  });
});

describe("deriveAccent", () => {
  it("uses SkySend green with a lighter dark shade by default", () => {
    const accent = deriveAccent();
    expect(accent.light.base).toBe(DEFAULT_ACCENT_LIGHT);
    expect(accent.dark.base).toBe(DEFAULT_ACCENT_DARK);
  });

  it("keeps a custom color unchanged as the base of both schemes", () => {
    const accent = deriveAccent("#ff6b35");
    expect(accent.light.base).toBe("#ff6b35");
    expect(accent.dark.base).toBe("#ff6b35");
  });

  it("puts white text on dark colors and black text on light colors", () => {
    expect(deriveAccent("#2563eb").light.foreground).toBe("#ffffff");
    expect(deriveAccent("#fde047").light.foreground).toBe("#000000");
  });

  it.each([...SAMPLES, ...SWEEP])("keeps text on %s at 4.5:1 or more", (color) => {
    const { light, dark } = deriveAccent(color);
    for (const shade of [light, dark]) {
      expect(contrast(parseHex(shade.foreground), parseHex(shade.base))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([...SAMPLES, ...SWEEP])("makes %s readable as text in both schemes", (color) => {
    const { light, dark } = deriveAccent(color);
    expect(contrast(parseHex(light.text), [255, 255, 255])).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrast(parseHex(dark.text), [30, 30, 34])).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });
});

describe("accentCss", () => {
  it("sets every primary token for light and dark", () => {
    const css = accentCss(deriveAccent("#2563eb"));
    expect(css).toMatch(/^:root \{/);
    expect(css).toContain(".dark {");
    for (const token of ["primary", "primary-foreground", "primary-text", "primary-soft", "primary-line", "primary-glow", "ring"]) {
      expect(css.match(new RegExp(`--color-${token}:`, "g"))).toHaveLength(2);
    }
  });
});

// index.css carries the default accent so the first paint is right before any script runs.
// It has to match what deriveAccent() makes of the defaults.
describe("index.css defaults", () => {
  const css = readFileSync(resolve(__dirname, "../../src/index.css"), "utf8");

  it.each(["light", "dark"] as const)("match the derived %s accent", (mode) => {
    const shades = deriveAccent()[mode];
    const block = mode === "light"
      ? css.slice(css.indexOf("@theme"), css.indexOf("\n}\n", css.indexOf("@theme")))
      : css.slice(css.indexOf("\n.dark {"), css.indexOf("\n}\n", css.indexOf("\n.dark {")));
    const read = (token: string) => new RegExp(`--color-${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
    expect(read("primary")).toBe(shades.base);
    expect(read("primary-foreground")).toBe(shades.foreground);
    expect(read("primary-text")).toBe(shades.text);
    expect(read("primary-soft")).toBe(shades.soft);
    expect(read("primary-line")).toBe(shades.line);
    expect(read("primary-glow")).toBe(shades.glow);
  });
});
