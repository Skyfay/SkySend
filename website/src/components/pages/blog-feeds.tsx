import { localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The RSS feed of the blog in a language. A post not translated yet comes in English. */
export function blogRss(locale: Locale) {
  const t = createTranslator(locale);
  const blogUrl = `${SITE_URL}${localePath(locale, "/blog/")}`;
  const items = getAllPosts(locale)
    .map((post) => {
      const url = `${SITE_URL}${localePath(locale, `/blog/${post.slug}/`)}`;
      return `    <item>
      <title>${escape(post.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <description>${escape(post.excerpt)}</description>
${post.tags.map((tag) => `      <category>${escape(tag)}</category>`).join("\n")}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(t("meta.blogOgLabel"))}</title>
    <link>${blogUrl}</link>
    <atom:link href="${SITE_URL}${localePath(locale, "/blog/rss.xml")}" rel="self" type="application/rss+xml" />
    <description>${escape(t("meta.blogDescription"))}</description>
    <language>${locale}</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
