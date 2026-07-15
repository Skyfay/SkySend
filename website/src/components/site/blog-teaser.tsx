import Link from "next/link";
import { PostCard } from "@/components/site/post-card";
import { SectionHeading } from "@/components/site/section-heading";
import { getAllPosts } from "@/lib/blog";

export function BlogTeaser() {
  const posts = getAllPosts().slice(0, 2);
  if (posts.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading title="From the blog" align="left" className="max-w-none" />
        <Link
          href="/blog"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          View all posts &rarr;
        </Link>
      </div>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
