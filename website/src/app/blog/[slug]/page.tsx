import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { MDXRemote } from "next-mdx-remote/rsc";
import { notFound } from "next/navigation";
import rehypePrettyCode from "rehype-pretty-code";
import { CodeBlock } from "@/components/site/code-block";
import { JsonLd } from "@/components/site/json-ld";
import { SITE_URL } from "@/lib/site";

// CodeBlock renders its own theme-aware `bg-card` box (not Typography's fixed
// dark `prose-pre` background), so a light/dark theme pair here tracks the
// site's toggle correctly instead of being paired with a background that
// doesn't change.
const CODE_THEME = { light: "github-light-default", dark: "github-dark-default" };

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
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

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getAllSlugs().includes(slug)) notFound();
  const post = getPostBySlug(slug);

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
    <article className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <JsonLd data={blogPostingJsonLd} />
      <p className="text-sm text-muted-foreground">
        {new Date(post.date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}{" "}
        · {post.author}
      </p>
      <h1 className="mt-2 text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl">
        {post.title}
      </h1>
      <div className="prose prose-neutral dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-card [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 mt-8 max-w-none">
        <MDXRemote
          source={post.content}
          options={{
            mdxOptions: {
              rehypePlugins: [
                [rehypePrettyCode, { theme: CODE_THEME, keepBackground: false }],
              ],
            },
          }}
          components={{ pre: CodeBlock }}
        />
      </div>
    </article>
  );
}
