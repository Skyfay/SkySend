import { BlogIndexPage, blogIndexMetadata } from "@/components/pages/blog-index-page";

export const metadata = blogIndexMetadata("de");

export default function Blog() {
  return <BlogIndexPage locale="de" />;
}
