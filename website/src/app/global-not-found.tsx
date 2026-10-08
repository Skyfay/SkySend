import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RootShell } from "@/components/pages/root-shell";
import { PageBackdrop } from "@/components/site/page-backdrop";
import { createTranslator } from "@/i18n/translate";
import { SITE_URL } from "@/lib/site";

// One static 404 for every language. The host serves it for any path it does not
// have, set by not_found_handling in wrangler.jsonc. Next marks it noindex itself.
const t = createTranslator("en");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `404 | SkySend`,
  description: t("notFound.text"),
  icons: { icon: "/logo.svg", apple: "/apple-touch-icon.png" },
};

export default function GlobalNotFound() {
  return (
    <RootShell locale="en" languageScript={false}>
      <div className="relative">
        <PageBackdrop />
        <section className="relative z-[2] mx-auto flex max-w-[720px] flex-col items-center gap-5 px-4 pt-[124px] text-center sm:px-6 sm:pt-[172px]">
          <span className="text-[64px] leading-none font-semibold tracking-[-0.045em] text-faint sm:text-[96px]">404</span>
          <h1 className="text-[32px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[44px]">{t("notFound.title")}</h1>
          <p className="text-lg leading-relaxed text-muted-foreground">{t("notFound.text")}</p>
          <Link href="/" className="btn-primary mt-2 flex h-[46px] items-center gap-2 rounded-[10px] px-5 font-medium">
            <ArrowLeft className="size-4" />
            {t("notFound.home")}
          </Link>
        </section>
      </div>
    </RootShell>
  );
}
