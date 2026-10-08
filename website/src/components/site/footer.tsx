import Link from "next/link";
import Image from "next/image";
import {
  CHANGELOG_URL,
  CRYPTO_URL,
  DISCORD_URL,
  DOCS_URL,
  GITHUB_URL,
  SECURITY_URL,
  SPONSOR_URL,
} from "@/lib/content";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/translate";

const FOOTER_COLUMNS: { title: MessageKey; links: { href: string; label: MessageKey; external?: boolean }[] }[] = [
  {
    title: "footer.product",
    links: [
      { href: "/#features", label: "footer.features" },
      { href: "/#instances", label: "footer.publicInstances" },
      { href: "/roadmap", label: "footer.roadmap" },
      { href: "/report", label: "footer.report" },
    ],
  },
  {
    title: "footer.resources",
    links: [
      { href: DOCS_URL, label: "footer.documentation", external: true },
      { href: CRYPTO_URL, label: "footer.cryptoDesign", external: true },
      { href: CHANGELOG_URL, label: "footer.changelog", external: true },
      { href: SECURITY_URL, label: "footer.securityPolicy", external: true },
    ],
  },
  {
    title: "footer.community",
    links: [
      { href: GITHUB_URL, label: "footer.github", external: true },
      { href: DISCORD_URL, label: "footer.discord", external: true },
      { href: "/blog", label: "footer.blog" },
      { href: SPONSOR_URL, label: "footer.sponsor", external: true },
    ],
  },
];

export function Footer({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <footer className="relative mt-28 border-t border-border/70 text-[13px] sm:mt-36">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-8 px-6 py-10 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="col-span-2 flex flex-col gap-2.5 sm:col-span-3 lg:col-span-1">
          <Link href={localePath(locale, "/")} className="flex w-fit items-center gap-2.5 text-sm font-semibold">
            <Image src="/logo.svg" alt="" width={24} height={24} />
            SkySend
          </Link>
          <span className="text-faint">{t("footer.tagline")}</span>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-1 sm:gap-2">
            <h2 className="mb-1 font-medium sm:mb-0">{t(column.title)}</h2>
            {column.links.map((link) => (
              <Link
                key={link.href}
                href={link.external ? link.href : localePath(locale, link.href)}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                className="w-fit py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:py-0"
              >
                {t(link.label)}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}
