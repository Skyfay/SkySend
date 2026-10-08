"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Rss } from "lucide-react";
import { CONIC, SpinBorder } from "@/components/site/fx";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { PostCoverArt, TONE_RGB } from "@/components/site/blog/post-cover";
import { AuthorAvatar } from "@/components/site/blog/author-avatar";
import type { PostSummary } from "@/lib/blog";
import { cn } from "@/lib/utils";

const MAX_TAGS = 5;

function Tag({ children }: { children: string }) {
  return <span className="rounded-full border border-border-strong px-2 py-0.5 text-xs text-subtle">{children}</span>;
}

export function BlogIndex({ posts, dates }: { posts: PostSummary[]; dates: Record<string, string> }) {
  const [tag, setTag] = useState("all");

  // A post links to the list filtered by its tag as /blog/?tag=name. The page
  // is static, so the filter is read once it runs in the browser.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tag");
    if (wanted && posts.some((p) => p.tags.includes(wanted))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTag(wanted);
    }
  }, [posts]);

  function pickTag(next: string) {
    setTag(next);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("tag");
    else url.searchParams.set("tag", next);
    window.history.replaceState(null, "", url);
  }

  const counts = new Map<string, number>();
  posts.forEach((p) => p.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAGS)
    .map(([name]) => name);
  if (tag !== "all" && !tags.includes(tag)) tags.push(tag);

  const filtered = posts.filter((p) => tag === "all" || p.tags.includes(tag));
  const featured = tag === "all" ? posts[0] : undefined;
  const meta = (p: PostSummary) => `${dates[p.slug]} · ${p.readingMinutes} min read`;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-1.5">
          {["all", ...tags].map((t) => {
            const on = t === tag;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => pickTag(t)}
                className={cn(
                  "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-all duration-200",
                  on ? "border-input bg-card text-foreground shadow-[var(--chip-shadow)] dark:bg-accent" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "all" ? "All posts" : t}
                <span className="font-normal text-faint">{t === "all" ? posts.length : counts.get(t)}</span>
              </button>
            );
          })}
        </div>
        <a href="/blog/rss.xml" className="btn-chip flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium">
          <Rss className="size-3.5" />
          RSS
        </a>
      </div>

      {featured && (
        <Link href={`/blog/${featured.slug}`} className="group fx-lift mt-10 block rounded-3xl">
          <SpinBorder conic={CONIC.green} size={1400} speed="normal" radius={24} innerClassName="bg-card">
            <span className="grid items-center gap-10 p-6 sm:p-10 lg:grid-cols-[1fr_440px]">
              <span className="flex flex-col gap-4">
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <span className="rounded-full bg-tone-green/16 px-2 py-0.5 text-xs font-medium text-tone-green">Latest</span>
                  {meta(featured)}
                </span>
                <span className="text-[28px] leading-[1.12] font-semibold tracking-[-0.03em] sm:text-4xl">{featured.title}</span>
                <span className="text-base leading-relaxed text-muted-foreground">{featured.excerpt}</span>
                <span className="mt-1 flex flex-wrap items-center gap-3">
                  <AuthorAvatar name={featured.author} size={32} />
                  <span className="font-medium">{featured.author}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {featured.tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 font-medium text-tone-green">
                    Read
                    <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </span>
                </span>
              </span>
              <span className="hidden lg:block">
                <PostCoverArt cover={featured.cover} className="h-[260px] rounded-2xl border" />
              </span>
            </span>
          </SpinBorder>
        </Link>
      )}

      <section className="mt-14 flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{tag === "all" ? "All posts" : `Tagged ${tag}`}</h2>
          <span className="text-faint">
            {filtered.length} {filtered.length === 1 ? "post" : "posts"}
          </span>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <SpotlightCard
              key={p.slug}
              as={Link}
              href={`/blog/${p.slug}`}
              rgb={TONE_RGB[p.cover?.tone ?? "green"]}
              reach={360}
              className="group flex flex-col rounded-[20px]"
            >
              <PostCoverArt cover={p.cover} />
              <span className="relative flex grow flex-col gap-2.5 p-5">
                <span className="text-xs text-muted-foreground">{meta(p)}</span>
                <span className="text-[19px] leading-tight font-semibold tracking-[-0.02em]">{p.title}</span>
                <span className="leading-relaxed text-muted-foreground">{p.excerpt}</span>
                <span className="mt-auto flex items-center gap-1.5 pt-2">
                  {p.tags.slice(0, 2).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  <ArrowRight className="ml-auto size-4 text-faint transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              </span>
            </SpotlightCard>
          ))}
        </div>
      </section>
    </>
  );
}
