import type { Metadata } from "next";
import { DEFAULT_LOCALE, INTL_LOCALE, LOCALES, localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";

/** The size of every social card of the site. */
export const OG_SIZE = { width: 1200, height: 630 };

/** The language versions of a path for hreflang, with English as the default. */
function languageAlternates(path: string, available: readonly Locale[] = LOCALES) {
  const languages: Record<string, string> = {};
  for (const locale of available) languages[locale] = localePath(locale, path);
  languages["x-default"] = localePath(DEFAULT_LOCALE, path);
  return languages;
}



/**
 * The metadata of a page in a language: its title and description, the
 * canonical URL, the other languages it exists in and its social cards. A page
 * that only exists in English, like an untranslated post, passes `languages`
 * and points its canonical at the English version with `canonicalLocale`.
 *
 * Every page names its social card, since a page that sets its own Open Graph
 * replaces the whole object of the layout. The card is the one of the site
 * unless the page passes the path of its own as `image`. Cards are served
 * from a `.png` path, so the host sends them as images.
 */
export function pageMetadata(
  locale: Locale,
  path: string,
  {
    title,
    description,
    canonicalLocale,
    languages = LOCALES,
    type = "website",
    image = localePath(locale, "/og.png"),
  }: {
    title?: string;
    description?: string;
    canonicalLocale?: Locale;
    languages?: readonly Locale[];
    type?: "website" | "article";
    image?: string;
  } = {}
): Metadata {
  const t = createTranslator(locale);
  const contentLocale = canonicalLocale ?? locale;
  const cardTitle = title ? `${title} | SkySend` : t("meta.siteTitle");
  const cardDescription = description ?? t("meta.tagline");
  const images = [{ url: image, ...OG_SIZE, alt: title ?? t("meta.siteTitle") }];
  return {
    ...(title && { title }),
    ...(description && { description }),
    alternates: {
      canonical: localePath(contentLocale, path),
      languages: languageAlternates(path, languages),
    },
    openGraph: {
      title: cardTitle,
      description: cardDescription,
      url: localePath(contentLocale, path),
      siteName: "SkySend",
      type,
      locale: INTL_LOCALE[contentLocale].replace("-", "_"),
      alternateLocale: languages.filter((l) => l !== contentLocale).map((l) => INTL_LOCALE[l].replace("-", "_")),
      images,
    },
    twitter: { card: "summary_large_image", title: cardTitle, description: cardDescription, images },
  };
}

/**
 * The metadata every page of a language shares, set by its root layout. It
 * leaves out the canonical and the alternates, so a page without its own
 * never claims to be the home page.
 */
export function rootMetadata(locale: Locale, siteUrl: string): Metadata {
  const t = createTranslator(locale);
  const { alternates: _alternates, ...shared } = pageMetadata(locale, "/");
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t("meta.siteTitle"), template: "%s | SkySend" },
    description: t("meta.tagline"),
    icons: { icon: "/logo.svg", apple: "/apple-touch-icon.png" },
    manifest: "/manifest.webmanifest",
    ...shared,
  };
}
