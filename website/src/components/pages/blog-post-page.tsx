import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Languages } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import { PageBackdrop } from "@/components/site/page-backdrop";
import { AuthorAvatar } from "@/components/site/blog/author-avatar";
import { mdxComponents } from "@/components/site/blog/mdx-components";
import { CopyLinkButton, ReadingProgress, TableOfContents } from "@/components/site/blog/post-client";
import { CONIC, Glow, SpinBorder } from "@/components/site/fx";
import { JsonLd } from "@/components/site/json-ld";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { getAllPosts, getAllSlugs, getHeadings, getPostBySlug, getPostLocales, splitTitle } from "@/lib/blog";
import { CRYPTO_URL, DISCORD_URL, GITHUB_URL } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { formatDate } from "@/lib/utils";

// CodeBlock renders its own theme-aware box, so a light/dark theme pair here
// tracks the site's toggle.
const CODE_THEME = { light: "github-light-default", dark: "github-dark-default" };

export function blogPostParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

/**
 * A post in a language it is not translated into yet shows the English text,
 * so its canonical is the English page and it only lists the languages it is
 * written in.
 */
export function blogPostMetadata(locale: Locale, slug: string) {
  if (!getAllSlugs().includes(slug)) return {};
  const post = getPostBySlug(slug, locale);
  return pageMetadata(locale, `/blog/${slug}/`, {
    title: post.title,
    description: post.excerpt,
    canonicalLocale: post.lang,
    languages: getPostLocales(slug),
    type: "article",
    image: localePath(locale, `/blog/${slug}/og.png`),
  });
}

function Tag({ children }: { children: string }) {
  return <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs text-subtle">{children}</span>;
}

export function BlogPostPage({ locale, slug }: { locale: Locale; slug: string }) {
  if (!getAllSlugs().includes(slug)) notFound();
  const t = createTranslator(locale);
  const post = getPostBySlug(slug, locale);
  const headings = getHeadings(post.content);
  const [titleHead, titleTail] = splitTitle(post.title);
  const meta = t("blog.readingTime", { date: formatDate(post.date, locale), minutes: post.readingMinutes });
  const tone = `var(--tone-${post.cover?.tone ?? "green"})`;
  const tint = (pct: number) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;

  const posts = getAllPosts(locale);
  const index = posts.findIndex((p) => p.slug === slug);
  const older = posts[index + 1];
  const neighbour = older ?? posts[index - 1];

  const postUrl = `${SITE_URL}${localePath(post.lang, `/blog/${slug}/`)}`;
  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: post.lang,
    image: `${SITE_URL}${localePath(locale, `/blog/${slug}/og.png`)}`,
    author: { "@type": "Person", name: post.author, url: GITHUB_URL },
    publisher: { "@type": "Organization", name: "SkySend", logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` } },
    mainEntityOfPage: { "@type": "WebPage", "@id": postUrl },
    url: postUrl,
    keywords: post.tags.join(", "),
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "SkySend", item: `${SITE_URL}${localePath(locale, "/")}` },
      { "@type": "ListItem", position: 2, name: t("meta.blogTitle"), item: `${SITE_URL}${localePath(locale, "/blog/")}` },
      { "@type": "ListItem", position: 3, name: post.title, item: postUrl },
    ],
  };

  return (
    <div className="relative">
      <JsonLd data={blogPostingJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <ReadingProgress targetId="post-body" />
      <PageBackdrop />

      <header className="relative mx-auto flex max-w-[1088px] flex-col gap-[22px] px-4 pt-[124px] sm:px-6 sm:pt-[156px]">
        <nav aria-label={t("blog.breadcrumb")} className="flex items-center gap-2">
          <Link
            href={localePath(locale, "/blog/")}
            className="group inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-surface/70 pr-3 pl-1.5 text-[13px] font-medium text-subtle backdrop-blur transition-colors hover:border-input hover:text-foreground"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-muted transition-transform duration-200 group-hover:-translate-x-0.5">
              <ArrowLeft className="size-3" />
            </span>
            {t("blog.back")}
          </Link>
          {post.tags[0] && (
            <>
              <ChevronRight aria-hidden="true" className="size-3.5 text-fainter" />
              <Link
                href={localePath(locale, `/blog/?tag=${encodeURIComponent(post.tags[0])}`)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-[filter] hover:brightness-110"
                style={{ color: tone, borderColor: tint(30), background: tint(10) }}
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
                {post.tags[0]}
              </Link>
            </>
          )}
        </nav>
        {post.lang !== locale && (
          <p className="flex w-fit items-center gap-2 rounded-full border border-tone-amber/35 bg-tone-amber/10 px-3 py-1 text-[13px] font-medium text-tone-amber">
            <Languages aria-hidden="true" className="size-3.5" />
            {t("blog.onlyEnglish")}
          </p>
        )}
        <h1
          lang={post.lang}
          className="max-w-[900px] text-[36px] leading-[1.06] font-semibold tracking-[-0.045em] sm:text-[60px] sm:leading-[1.05]"
        >
          {titleHead}
          {titleTail && <span className="fx-shine">{titleTail}</span>}
        </h1>
        <p lang={post.lang} className="max-w-[760px] text-lg leading-[1.55] text-muted-foreground sm:text-xl">
          {post.excerpt}
        </p>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 pt-1.5">
          <div className="flex items-center gap-3.5">
            <AuthorAvatar name={post.author} size={40} />
            <div>
              <div className="font-semibold">{post.author}</div>
              <div className="text-[13px] text-muted-foreground">{meta}</div>
            </div>
          </div>
          <div className="order-last flex w-full flex-wrap gap-1.5 sm:order-none sm:ml-3 sm:w-auto">
            {post.tags.map((name) => (
              <Tag key={name}>{name}</Tag>
            ))}
          </div>
          <div className="ml-auto">
            <CopyLinkButton />
          </div>
        </div>
      </header>

      <div className="relative mx-auto mt-12 grid max-w-[1088px] items-start gap-16 px-4 sm:px-6 lg:grid-cols-[minmax(0,720px)_1fr]">
        <article id="post-body" lang={post.lang} className="post-prose min-w-0">
          <MDXRemote
            source={post.content}
            options={{
              mdxOptions: {
                rehypePlugins: [[rehypePrettyCode, { theme: CODE_THEME, keepBackground: false }]],
              },
            }}
            components={mdxComponents(t)}
          />
        </article>

        <aside className="sticky top-24 hidden flex-col gap-5 lg:flex">
          <TableOfContents headings={headings} />
          <div className="panel relative flex flex-col gap-3 overflow-hidden rounded-2xl p-[18px]">
            <Glow color="#17a37a" opacity={0.25} blur={50} className="-top-[60px] -right-[60px] size-[180px]" />
            <Image src="/logo.svg" alt="" width={36} height={36} className="relative" />
            <div className="relative font-semibold">{t("blog.trySkySend")}</div>
            <p className="relative text-[13px] leading-[1.55] text-muted-foreground">{t("blog.trySkySendText")}</p>
            <Link
              href={localePath(locale, "/#start")}
              className="btn-primary relative flex h-9 items-center justify-center rounded-lg font-medium"
            >
              {t("blog.getStarted")}
            </Link>
          </div>
        </aside>
      </div>

      <section className="relative mx-auto mt-[72px] flex max-w-[1088px] flex-col gap-5 px-4 sm:px-6">
        <div className="panel flex flex-wrap items-center gap-4 rounded-[18px] p-5">
          <AuthorAvatar name={post.author} size={48} />
          <div className="grow">
            <div className="font-semibold">{t("blog.writtenBy", { name: post.author })}</div>
            <div className="text-muted-foreground">{t("blog.maintainer")}</div>
          </div>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-chip flex h-9 items-center rounded-lg px-3.5 font-medium"
          >
            {t("blog.discuss")}
          </a>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {neighbour && (
            <Link
              href={localePath(locale, `/blog/${neighbour.slug}/`)}
              className="panel flex flex-col gap-2 rounded-[18px] p-[22px] transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input"
            >
              <span className="flex items-center gap-1.5 text-[13px] text-faint">
                {older ? <ChevronLeft className="size-3.5" /> : null}
                {older ? t("blog.previous") : t("blog.newer")}
                {older ? null : <ChevronRight className="size-3.5" />}
              </span>
              <span lang={neighbour.lang} className="text-lg font-semibold tracking-[-0.02em]">
                {neighbour.title}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {t("blog.readingTime", { date: formatDate(neighbour.date, locale), minutes: neighbour.readingMinutes })}
              </span>
            </Link>
          )}
          <Link
            href={localePath(locale, "/blog/")}
            className="panel flex flex-col items-end gap-2 rounded-[18px] p-[22px] text-right transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input sm:col-start-2"
          >
            <span className="flex items-center gap-1.5 text-[13px] text-faint">
              {t("blog.allPostsLink")}
              <ChevronRight className="size-3.5" />
            </span>
            <span className="text-lg font-semibold tracking-[-0.02em]">{t("blog.backToBlog")}</span>
            <span className="text-[13px] text-muted-foreground">{t("blog.posts", { count: posts.length })}</span>
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-[72px] max-w-[1248px] px-4 sm:px-6">
        <SpinBorder conic={CONIC.green} size={1600} speed="normal" radius={28} innerClassName="dark overflow-hidden bg-[#0c0d0e] text-foreground">
          <Glow color="#17a37a" opacity={0.25} blur={90} drift={1} className="-top-[60px] left-[30%] h-[260px] w-[500px]" />
          <div className="relative flex flex-wrap items-center gap-8 p-7 sm:p-14">
            <div className="min-w-[240px] grow basis-0">
              <div className="text-[28px] font-semibold tracking-[-0.035em] sm:text-4xl">{t("blog.ctaTitle")}</div>
              <div className="mt-2 text-base text-muted-foreground">{t("blog.ctaLead")}</div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link
                href={localePath(locale, "/#start")}
                className="btn-primary flex h-[46px] items-center rounded-[10px] px-[22px] text-[15px] font-medium"
              >
                {t("blog.getStarted")}
              </Link>
              <a
                href={CRYPTO_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-chip flex h-[46px] items-center rounded-[10px] px-[22px] text-[15px] font-medium"
              >
                {t("blog.cryptoDesign")}
              </a>
            </div>
          </div>
        </SpinBorder>
      </section>
    </div>
  );
}
