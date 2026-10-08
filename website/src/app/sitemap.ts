import type { MetadataRoute } from "next";
import { DEFAULT_LOCALE, LOCALES, localePath, type Locale } from "@/i18n/config";
import { getAllPosts, getPostLocales } from "@/lib/blog";
import { getReleases } from "@/lib/releases";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

type Entry = MetadataRoute.Sitemap[number];

/**
 * One entry per language a page exists in, each naming the others. A post
 * only counts as existing in the languages it is written in, since its other
 * pages point their canonical at the English one.
 */
function entries(path: string, locales: readonly Locale[], rest: Omit<Entry, "url" | "alternates">): Entry[] {
  const urls = Object.fromEntries(locales.map((l) => [l, `${SITE_URL}${localePath(l, path)}`]));
  const languages = { ...urls, "x-default": `${SITE_URL}${localePath(DEFAULT_LOCALE, path)}` };
  return locales.map((locale) => ({ url: urls[locale], alternates: { languages }, ...rest }));
}

/**
 * A page only carries a lastmod where a real date exists: the newest post for
 * the blog, the newest release for the home page and the roadmap. Google
 * ignores a lastmod that changes with every build.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  const newestPost = posts[0] ? new Date(posts[0].date) : undefined;
  const newestRelease = getReleases().find((r) => r.date)?.date;
  const released = newestRelease ? new Date(newestRelease) : undefined;
  return [
    ...entries("/", LOCALES, { lastModified: released, changeFrequency: "weekly", priority: 1.0 }),
    ...entries("/blog/", LOCALES, { lastModified: newestPost, changeFrequency: "weekly", priority: 0.8 }),
    ...entries("/roadmap/", LOCALES, { lastModified: released, changeFrequency: "weekly", priority: 0.8 }),
    ...entries("/report/", LOCALES, { changeFrequency: "monthly", priority: 0.3 }),
    ...posts.flatMap((post) =>
      entries(`/blog/${post.slug}/`, getPostLocales(post.slug), {
        lastModified: new Date(post.date),
        changeFrequency: "monthly",
        priority: 0.6,
      })
    ),
  ];
}
