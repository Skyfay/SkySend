import { blogRss } from "@/components/pages/blog-feeds";

// Rendered once during the static export, like every other page of the site.
export const dynamic = "force-static";

export function GET() {
  return blogRss("de");
}
