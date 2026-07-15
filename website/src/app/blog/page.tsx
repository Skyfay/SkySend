import { PostCard } from "@/components/site/post-card";
import { SectionHeading } from "@/components/site/section-heading";
import { getAllPosts } from "@/lib/blog";

export const metadata = {
  title: "Blog",
  description:
    "Announcements, tutorials, and behind-the-scenes posts from the SkySend team.",
  alternates: {
    canonical: "/blog",
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <SectionHeading
        as="h1"
        eyebrow="Blog"
        title="Announcements & tutorials"
        description="Notes on what we're building and how to get the most out of SkySend."
        align="left"
        className="max-w-none"
      />

      <div className="mt-10 flex flex-col gap-6">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
