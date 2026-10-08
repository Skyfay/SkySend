import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import { PageBackdrop } from "@/components/site/blog/page-backdrop";
import { AuthorAvatar } from "@/components/site/blog/author-avatar";
import { MDX_COMPONENTS } from "@/components/site/blog/mdx-components";
import { CopyLinkButton, ReadingProgress, TableOfContents } from "@/components/site/blog/post-client";
import { CONIC, Glow, SpinBorder } from "@/components/site/fx";
import { JsonLd } from "@/components/site/json-ld";
import { getAllPosts, getAllSlugs, getHeadings, getPostBySlug, splitTitle } from "@/lib/blog";
import { CRYPTO_URL, DISCORD_URL } from "@/lib/content";
import { SITE_URL } from "@/lib/site";
import { formatDate } from "@/lib/utils";

// CodeBlock renders its own theme-aware box, so a light/dark theme pair here
// tracks the site's toggle.
const CODE_THEME = { light: "github-light-default", dark: "github-dark-default" };

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getAllSlugs().includes(slug)) return {};
  const post = getPostBySlug(slug);
  return {
    title: post.title,
    description: post.excerpt,
    alternates: {
      canonical: `/blog/${slug}`,
    },
  };
}

function Tag({ children }: { children: string }) {
  return <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs text-subtle">{children}</span>;
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getAllSlugs().includes(slug)) notFound();
  const post = getPostBySlug(slug);
  const headings = getHeadings(post.content);
  const [titleHead, titleTail] = splitTitle(post.title);
  const meta = `${formatDate(post.date)} · ${post.readingMinutes} min read`;
  const tone = `var(--tone-${post.cover?.tone ?? "green"})`;
  const tint = (pct: number) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;

  const posts = getAllPosts();
  const index = posts.findIndex((p) => p.slug === slug);
  const older = posts[index + 1];
  const neighbour = older ?? posts[index - 1];

  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { "@type": "Person", name: post.author },
    url: `${SITE_URL}/blog/${slug}`,
  };

  return (
    <div className="relative">
      <JsonLd data={blogPostingJsonLd} />
      <ReadingProgress targetId="post-body" />
      <PageBackdrop />

      <header className="relative mx-auto flex max-w-[1088px] flex-col gap-[22px] px-4 pt-[124px] sm:px-6 sm:pt-[156px]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2">
          <Link
            href="/blog"
            className="group inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-surface/70 pr-3 pl-1.5 text-[13px] font-medium text-subtle backdrop-blur transition-colors hover:border-input hover:text-foreground"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-muted transition-transform duration-200 group-hover:-translate-x-0.5">
              <ArrowLeft className="size-3" />
            </span>
            Blog
          </Link>
          {post.tags[0] && (
            <>
              <ChevronRight aria-hidden="true" className="size-3.5 text-fainter" />
              <Link
                href={`/blog/?tag=${encodeURIComponent(post.tags[0])}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-[filter] hover:brightness-110"
                style={{ color: tone, borderColor: tint(30), background: tint(10) }}
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
                {post.tags[0]}
              </Link>
            </>
          )}
        </nav>
        <h1 className="max-w-[900px] text-[36px] leading-[1.06] font-semibold tracking-[-0.045em] sm:text-[60px] sm:leading-[1.05]">
          {titleHead}
          {titleTail && <span className="fx-shine">{titleTail}</span>}
        </h1>
        <p className="max-w-[760px] text-lg leading-[1.55] text-muted-foreground sm:text-xl">{post.excerpt}</p>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 pt-1.5">
          <div className="flex items-center gap-3.5">
            <AuthorAvatar name={post.author} size={40} />
            <div>
              <div className="font-semibold">{post.author}</div>
              <div className="text-[13px] text-muted-foreground">{meta}</div>
            </div>
          </div>
          <div className="order-last flex w-full flex-wrap gap-1.5 sm:order-none sm:ml-3 sm:w-auto">
            {post.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
          <div className="ml-auto">
            <CopyLinkButton />
          </div>
        </div>
      </header>

      <div className="relative mx-auto mt-12 grid max-w-[1088px] items-start gap-16 px-4 sm:px-6 lg:grid-cols-[minmax(0,720px)_1fr]">
        <article id="post-body" className="post-prose min-w-0">
          <MDXRemote
            source={post.content}
            options={{
              mdxOptions: {
                rehypePlugins: [[rehypePrettyCode, { theme: CODE_THEME, keepBackground: false }]],
              },
            }}
            components={MDX_COMPONENTS}
          />
        </article>

        <aside className="sticky top-24 hidden flex-col gap-5 lg:flex">
          <TableOfContents headings={headings} />
          <div className="panel relative flex flex-col gap-3 overflow-hidden rounded-2xl p-[18px]">
            <Glow color="#17a37a" opacity={0.25} blur={50} className="-top-[60px] -right-[60px] size-[180px]" />
            <Image src="/logo.svg" alt="" width={36} height={36} className="relative" />
            <div className="relative font-semibold">Try SkySend</div>
            <p className="relative text-[13px] leading-[1.55] text-muted-foreground">
              One container, files and notes encrypted in the browser, a key the server never sees.
            </p>
            <Link href="/#start" className="btn-primary relative flex h-9 items-center justify-center rounded-lg font-medium">
              Get started
            </Link>
          </div>
        </aside>
      </div>

      <section className="relative mx-auto mt-[72px] flex max-w-[1088px] flex-col gap-5 px-4 sm:px-6">
        <div className="panel flex flex-wrap items-center gap-4 rounded-[18px] p-5">
          <AuthorAvatar name={post.author} size={48} />
          <div className="grow">
            <div className="font-semibold">Written by {post.author}</div>
            <div className="text-muted-foreground">Maintainer of SkySend.</div>
          </div>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-chip flex h-9 items-center rounded-lg px-3.5 font-medium"
          >
            Discuss on Discord
          </a>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {neighbour && (
            <Link
              href={`/blog/${neighbour.slug}`}
              className="panel flex flex-col gap-2 rounded-[18px] p-[22px] transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input"
            >
              <span className="flex items-center gap-1.5 text-[13px] text-faint">
                {older ? <ChevronLeft className="size-3.5" /> : null}
                {older ? "Previous" : "Newer"}
                {older ? null : <ChevronRight className="size-3.5" />}
              </span>
              <span className="text-lg font-semibold tracking-[-0.02em]">{neighbour.title}</span>
              <span className="text-[13px] text-muted-foreground">
                {formatDate(neighbour.date)} · {neighbour.readingMinutes} min read
              </span>
            </Link>
          )}
          <Link
            href="/blog"
            className="panel flex flex-col items-end gap-2 rounded-[18px] p-[22px] text-right transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input sm:col-start-2"
          >
            <span className="flex items-center gap-1.5 text-[13px] text-faint">
              All posts
              <ChevronRight className="size-3.5" />
            </span>
            <span className="text-lg font-semibold tracking-[-0.02em]">Back to the blog</span>
            <span className="text-[13px] text-muted-foreground">
              {posts.length} {posts.length === 1 ? "post" : "posts"}
            </span>
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-[72px] max-w-[1248px] px-4 sm:px-6">
        <SpinBorder conic={CONIC.green} size={1600} speed="normal" radius={28} innerClassName="dark overflow-hidden bg-[#0c0d0e] text-foreground">
          <Glow color="#17a37a" opacity={0.25} blur={90} drift={1} className="-top-[60px] left-[30%] h-[260px] w-[500px]" />
          <div className="relative flex flex-wrap items-center gap-8 p-7 sm:p-14">
            <div className="min-w-[240px] grow basis-0">
              <div className="text-[28px] font-semibold tracking-[-0.035em] sm:text-4xl">Share without trusting the server.</div>
              <div className="mt-2 text-base text-muted-foreground">Free and open source under AGPL-3.0.</div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link
                href="/#start"
                className="btn-primary flex h-[46px] items-center rounded-[10px] px-[22px] text-[15px] font-medium"
              >
                Get started
              </Link>
              <a
                href={CRYPTO_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-chip flex h-[46px] items-center rounded-[10px] px-[22px] text-[15px] font-medium"
              >
                Read the crypto design
              </a>
            </div>
          </div>
        </SpinBorder>
      </section>
    </div>
  );
}
