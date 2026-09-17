import { extname } from "node:path";
import type { Config } from "./config.js";

type IndexHtmlConfig = Pick<
  Config,
  | "BASE_URL"
  | "CUSTOM_TITLE"
  | "CUSTOM_LOGO"
  | "CUSTOM_OG_IMAGE"
  | "CUSTOM_OG_IMAGE_STYLE"
  | "DEFAULT_THEME"
>;

/** Image types that messengers and social networks render in link previews. SVG is not one. */
const PREVIEW_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** Built-in preview image shipped in the SPA's public folder. */
const DEFAULT_OG_IMAGE = "/logo.png";

/** True when a URL or absolute path points at an image type link previews can show. */
export function isPreviewImage(value: string): boolean {
  // The base only exists to parse absolute paths, the host is never used.
  const { pathname } = new URL(value, "http://localhost");
  return PREVIEW_IMAGE_EXTENSIONS.has(extname(pathname).toLowerCase());
}

/**
 * Picks the link preview image as an absolute URL, which the Open Graph spec requires.
 * Returns null for an SVG or other unsupported CUSTOM_LOGO, because falling back to the
 * built-in logo would show SkySend branding on a white-labeled instance.
 */
export function resolveOgImage(config: IndexHtmlConfig): string | null {
  let source: string | null = DEFAULT_OG_IMAGE;
  if (config.CUSTOM_OG_IMAGE) {
    source = config.CUSTOM_OG_IMAGE;
  } else if (config.CUSTOM_LOGO) {
    source = isPreviewImage(config.CUSTOM_LOGO) ? config.CUSTOM_LOGO : null;
  }
  return source && new URL(source, config.BASE_URL).href;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Fills the runtime placeholders in the built index.html.
 * Values are HTML-escaped and inserted through a replacer function, so a "$&" in
 * CUSTOM_TITLE is not read as a replacement pattern.
 */
export function renderIndexHtml(template: string, config: IndexHtmlConfig): string {
  const ogImage = resolveOgImage(config);
  const twitterCard = config.CUSTOM_OG_IMAGE_STYLE === "banner" ? "summary_large_image" : "summary";

  // An empty image tag makes some crawlers fetch the page URL as an image, so drop the tags.
  const html = ogImage ? template : template.replace(/\s*<meta\b[^>]*__OG_IMAGE__[^>]*>/g, "");

  return html
    .replace(/__CUSTOM_TITLE__/g, () => escapeHtml(config.CUSTOM_TITLE))
    // DEFAULT_THEME is a Zod enum. public/theme-init.js reads it before the first paint.
    .replace(/__DEFAULT_THEME__/g, () => config.DEFAULT_THEME)
    .replace(/__OG_IMAGE__/g, () => escapeHtml(ogImage ?? ""))
    .replace(/__TWITTER_CARD__/g, () => twitterCard);
}
