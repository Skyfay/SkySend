import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

const BLOG_DIR = path.join(process.cwd(), "src/content/blog");
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

export type PostTone = z.infer<typeof PostToneSchema>;
export type PostCover = z.infer<typeof PostCoverSchema>;
export type PostFrontmatter = z.infer<typeof FrontmatterSchema>;

export interface PostSummary extends PostFrontmatter {
  slug: string;
  readingMinutes: number;
}

export interface Post extends PostSummary {
  content: string;
}

export interface Heading {
  id: string;
  text: string;
}

export function getAllSlugs(): string[] {
  return fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => file.replace(/\.mdx$/, ""));
}

/** Reads a post. A frontmatter that does not match the schema fails the build. */
export function getPostBySlug(slug: string): Post {
  const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), "utf8");
  const { data, content } = matter(raw);
  const parsed = FrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid frontmatter in ${slug}.mdx: ${parsed.error.message}`);
  }
  const words = content.replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length;
  return {
    slug,
    content,
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    ...parsed.data,
  };
}

export function getAllPosts(): PostSummary[] {
  return getAllSlugs()
    .map((slug) => {
      const { content: _content, ...meta } = getPostBySlug(slug);
      return meta;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
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
