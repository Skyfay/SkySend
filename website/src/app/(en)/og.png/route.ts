import { siteOgImage } from "@/components/pages/og-image";

// The social card at a fixed path, so every page can name it. Rendered once during the static export.
export const dynamic = "force-static";

export function GET() {
  return siteOgImage("en");
}
