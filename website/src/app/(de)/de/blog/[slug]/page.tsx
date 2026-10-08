import { BlogPostPage, blogPostMetadata, blogPostParams } from "@/components/pages/blog-post-page";

export const dynamicParams = false;

export function generateStaticParams() {
  return blogPostParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return blogPostMetadata("de", (await params).slug);
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  return <BlogPostPage locale="de" slug={(await params).slug} />;
}
