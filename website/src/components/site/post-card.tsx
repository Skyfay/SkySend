import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { PostSummary } from "@/lib/blog";

export function PostCard({ post }: { post: PostSummary }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col rounded-xl border border-border bg-card/50 p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
    >
      <p className="text-sm text-muted-foreground">
        {new Date(post.date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      <h3 className="mt-2 text-lg font-semibold tracking-tight transition-colors group-hover:text-primary">
        {post.title}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">{post.excerpt}</p>
      {post.tags?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {post.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}
