import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";

const BLOG_DIR = path.join(process.cwd(), "src/content/blog");
/** The illustration of a post, public/blog/<slug>.webp, and its social card, public/blog/<slug>.jpg. */
const IMAGE_DIR = path.join(process.cwd(), "public/blog");
const WORDS_PER_MINUTE = 220;

const PostToneSchema = z.enum(["green", "blue", "violet", "cyan", "amber"]);

/** The artwork of a post card, set in the frontmatter under `cover`. */
const PostCoverSchema = z.object({
  /** Up to three letters on the tile in the corner. */
  badge: z.string().min(1).max(3),
  tone: PostToneSchema,
  /** Two short terminal lines, the first one a command. */
  snippet: z.string().default(""),
});

const FrontmatterSchema = z.object({
  title: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excerpt: z.string().min(1),
  tags: z.array(z.string().min(1)),
  author: z.string().min(1),
  cover: PostCoverSchema.optional(),
});

/**
 * The frontmatter of a translation, `<slug>.de.mdx` beside `<slug>.mdx`. It
 * brings its own title and excerpt, and tags if they read differently. The
 * date, the author and the cover stay those of the English post.
 */
const TranslationSchema = FrontmatterSchema.pick({ title: true, excerpt: true }).extend({
  tags: z.array(z.string().min(1)).optional(),
});

export type PostTone = z.infer<typeof PostToneSchema>;
export type PostCover = z.infer<typeof PostCoverSchema>;
export type PostFrontmatter = z.infer<typeof FrontmatterSchema>;

export interface PostSummary extends PostFrontmatter {
  slug: string;
  /** The language the post is written in, English when it has no translation yet. */
  lang: Locale;
  readingMinutes: number;
  /** The path of its illustration, shown on its card and above it, or null without one. */
  image: string | null;
  /** The path of its social card, 1200 by 630, or null to draw one. */
  socialImage: string | null;
}

export interface Post extends PostSummary {
  content: string;
}

export interface Heading {
  id: string;
  text: string;
}

/** A translation sits beside its post, named `<slug>.<locale>.mdx`. */
const TRANSLATION_FILE = new RegExp(`\\.(${LOCALES.filter((l) => l !== DEFAULT_LOCALE).join("|")})\\.mdx$`);

function fileOf(slug: string, locale: Locale): string {
  return locale === DEFAULT_LOCALE ? `${slug}.mdx` : `${slug}.${locale}.mdx`;
}

/** The slugs of the English posts. Every post exists in English. */
export function getAllSlugs(): string[] {
  return fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".mdx") && !TRANSLATION_FILE.test(file))
    .map((file) => file.replace(/\.mdx$/, ""));
}

/** The languages a post is written in, English first. */
export function getPostLocales(slug: string): Locale[] {
  return LOCALES.filter((locale) => fs.existsSync(path.join(BLOG_DIR, fileOf(slug, locale))));
}

function read<T extends z.ZodType>(file: string, schema: T): { data: z.infer<T>; content: string } {
  const { data, content } = matter(fs.readFileSync(path.join(BLOG_DIR, file), "utf8"));
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(`Invalid frontmatter in ${file}: ${parsed.error.message}`);
  return { data: parsed.data, content };
}

/**
 * Reads a post in a language, or in English when it has no translation into
 * it. A frontmatter that does not match its schema fails the build.
 */
export function getPostBySlug(slug: string, locale: Locale = DEFAULT_LOCALE): Post {
  const english = read(fileOf(slug, DEFAULT_LOCALE), FrontmatterSchema);
  const lang = locale !== DEFAULT_LOCALE && getPostLocales(slug).includes(locale) ? locale : DEFAULT_LOCALE;
  const translated = lang === DEFAULT_LOCALE ? null : read(fileOf(slug, lang), TranslationSchema);
  const content = translated?.content ?? english.content;
  const words = content.replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length;
  const has = (file: string) => fs.existsSync(path.join(IMAGE_DIR, file));
  return {
    slug,
    lang,
    content,
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    image: has(`${slug}.webp`) ? `/blog/${slug}.webp` : null,
    socialImage: has(`${slug}.jpg`) ? `/blog/${slug}.jpg` : null,
    ...english.data,
    ...(translated && {
      title: translated.data.title,
      excerpt: translated.data.excerpt,
      tags: translated.data.tags ?? english.data.tags,
    }),
  };
}

export function getAllPosts(locale: Locale = DEFAULT_LOCALE): PostSummary[] {
  return getAllSlugs()
    .map((slug) => {
      const { content: _content, ...meta } = getPostBySlug(slug, locale);
      return meta;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** The id of a heading. German letters are spelled out, so "Schlüssel" becomes "schluessel". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** The `##` headings of a post, outside code fences, for the table of contents. */
export function getHeadings(content: string): Heading[] {
  return content
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => {
      const text = line.slice(3).replace(/[`*_]/g, "").trim();
      return { id: slugify(text), text };
    });
}

/** Splits a title at its dash or colon, so the second half can carry the shine. */
export function splitTitle(title: string): [string, string | null] {
  const dash = title.indexOf(" - ");
  if (dash > 0) return [title.slice(0, dash + 3), title.slice(dash + 3)];
  const colon = title.indexOf(": ");
  if (colon > 0) return [title.slice(0, colon + 2), title.slice(colon + 2)];
  return [title, null];
}
