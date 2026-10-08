import { blogPostOgImage } from "@/components/pages/og-image";
import { blogPostParams } from "@/components/pages/blog-post-page";

// The social card of a post at a fixed .png path. Rendered once per post during the static export.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return blogPostParams();
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return blogPostOgImage("de", (await params).slug);
}
