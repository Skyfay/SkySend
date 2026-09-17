import { describe, expect, it } from "vitest";

import { isPreviewImage, renderIndexHtml, resolveOgImage } from "../src/lib/index-html.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEMPLATE = `<html data-default-theme="__DEFAULT_THEME__">
  <head>
    <meta property="og:site_name" content="__CUSTOM_TITLE__" />
    <meta property="og:image" content="__OG_IMAGE__" />
    <meta name="twitter:card" content="__TWITTER_CARD__" />
    <meta name="twitter:image" content="__OG_IMAGE__" />
    <title>__CUSTOM_TITLE__ | Encrypted File & Note Transfer</title>
  </head>
</html>`;

const BASE_CONFIG = {
  BASE_URL: "https://send.example.com",
  CUSTOM_TITLE: "SkySend",
  CUSTOM_LOGO: undefined,
  CUSTOM_OG_IMAGE: undefined,
  CUSTOM_OG_IMAGE_STYLE: "logo",
  DEFAULT_THEME: "system",
} as const;

function makeConfig(overrides: Partial<Parameters<typeof renderIndexHtml>[1]> = {}) {
  return { ...BASE_CONFIG, ...overrides };
}

// ── isPreviewImage ────────────────────────────────────────────────────────────

describe("isPreviewImage", () => {
  it("should accept raster formats regardless of case", () => {
    expect(isPreviewImage("/branding/logo.png")).toBe(true);
    expect(isPreviewImage("/branding/logo.JPG")).toBe(true);
    expect(isPreviewImage("https://cdn.example.com/banner.webp")).toBe(true);
  });

  it("should ignore the query string when reading the extension", () => {
    expect(isPreviewImage("https://cdn.example.com/banner.png?v=2")).toBe(true);
    expect(isPreviewImage("https://cdn.example.com/logo.svg?format=.png")).toBe(false);
  });

  it("should reject SVG and paths without an extension", () => {
    expect(isPreviewImage("/branding/logo.svg")).toBe(false);
    expect(isPreviewImage("https://cdn.example.com/logo")).toBe(false);
  });
});

// ── resolveOgImage ────────────────────────────────────────────────────────────

describe("resolveOgImage", () => {
  it("should fall back to the built-in logo as an absolute URL", () => {
    expect(resolveOgImage(makeConfig())).toBe("https://send.example.com/logo.png");
  });

  it("should prefer CUSTOM_OG_IMAGE over CUSTOM_LOGO", () => {
    const config = makeConfig({
      CUSTOM_LOGO: "/branding/logo.png",
      CUSTOM_OG_IMAGE: "/branding/preview.jpg",
    });
    expect(resolveOgImage(config)).toBe("https://send.example.com/branding/preview.jpg");
  });

  it("should use a raster CUSTOM_LOGO when no preview image is set", () => {
    const config = makeConfig({ CUSTOM_LOGO: "/branding/logo.png" });
    expect(resolveOgImage(config)).toBe("https://send.example.com/branding/logo.png");
  });

  it("should return null for an SVG CUSTOM_LOGO instead of the built-in logo", () => {
    const config = makeConfig({ CUSTOM_LOGO: "/branding/logo.svg" });
    expect(resolveOgImage(config)).toBeNull();
  });

  it("should keep an external URL unchanged", () => {
    const config = makeConfig({ CUSTOM_OG_IMAGE: "https://cdn.example.com/preview.png" });
    expect(resolveOgImage(config)).toBe("https://cdn.example.com/preview.png");
  });
});

// ── renderIndexHtml ───────────────────────────────────────────────────────────

describe("renderIndexHtml", () => {
  it("should fill every placeholder", () => {
    const html = renderIndexHtml(TEMPLATE, makeConfig());

    expect(html).not.toMatch(/__[A-Z_]+__/);
    expect(html).toContain('data-default-theme="system"');
    expect(html).toContain('<meta property="og:site_name" content="SkySend" />');
    expect(html).toContain('<meta property="og:image" content="https://send.example.com/logo.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html).toContain('<meta name="twitter:image" content="https://send.example.com/logo.png" />');
  });

  it("should use the large card for the banner style", () => {
    const html = renderIndexHtml(TEMPLATE, makeConfig({ CUSTOM_OG_IMAGE_STYLE: "banner" }));
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("should drop both image tags when no preview image fits", () => {
    const html = renderIndexHtml(TEMPLATE, makeConfig({ CUSTOM_LOGO: "/branding/logo.svg" }));

    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it("should escape injected values", () => {
    const html = renderIndexHtml(
      TEMPLATE,
      makeConfig({
        CUSTOM_TITLE: `Tom & "Jerry" <Share>`,
        CUSTOM_OG_IMAGE: "https://cdn.example.com/preview.png?a=1&b=2",
      }),
    );

    expect(html).toContain('content="Tom &amp; &quot;Jerry&quot; &lt;Share&gt;"');
    expect(html).toContain('content="https://cdn.example.com/preview.png?a=1&amp;b=2"');
  });

  it("should not treat replacement patterns in the title as special", () => {
    const html = renderIndexHtml(TEMPLATE, makeConfig({ CUSTOM_TITLE: "Send $& Share $1" }));
    expect(html).toContain("<title>Send $&amp; Share $1 | Encrypted File & Note Transfer</title>");
  });
});
