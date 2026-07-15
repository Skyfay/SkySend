import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const BLOG_DIR = path.join(process.cwd(), "src/content/blog");

export interface PostFrontmatter {
  title: string;
  date: string;
  excerpt: string;
  tags: string[];
  author: string;
}

export interface PostSummary extends PostFrontmatter {
  slug: string;
}

export interface Post extends PostSummary {
  content: string;
}

export function getAllSlugs(): string[] {
  return fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => file.replace(/\.mdx$/, ""));
}

export function getPostBySlug(slug: string): Post {
  const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), "utf8");
  const { data, content } = matter(raw);
  return { slug, content, ...(data as PostFrontmatter) };
}

export function getAllPosts(): PostSummary[] {
  return getAllSlugs()
    .map((slug) => {
      const { content: _content, ...meta } = getPostBySlug(slug);
      return meta;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
