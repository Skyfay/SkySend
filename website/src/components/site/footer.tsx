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

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#instances", label: "Public instances" },
      { href: "/roadmap", label: "Roadmap" },
      { href: "/report", label: "Report a link" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: DOCS_URL, label: "Documentation", external: true },
      { href: CRYPTO_URL, label: "Crypto design", external: true },
      { href: CHANGELOG_URL, label: "Changelog", external: true },
      { href: SECURITY_URL, label: "Security policy", external: true },
    ],
  },
  {
    title: "Community",
    links: [
      { href: GITHUB_URL, label: "GitHub", external: true },
      { href: DISCORD_URL, label: "Discord", external: true },
      { href: "/blog", label: "Blog" },
      { href: SPONSOR_URL, label: "Sponsor", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-28 border-t border-border/70 text-[13px] sm:mt-36">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-8 px-6 py-10 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="col-span-2 flex flex-col gap-2.5 sm:col-span-3 lg:col-span-1">
          <Link href="/" className="flex w-fit items-center gap-2.5 text-sm font-semibold">
            <Image src="/logo.svg" alt="" width={24} height={24} />
            SkySend
          </Link>
          <span className="text-faint">Zero-knowledge file and note sharing · AGPL-3.0</span>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-1 sm:gap-2">
            <h2 className="mb-1 font-medium sm:mb-0">{column.title}</h2>
            {column.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                className="w-fit py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:py-0"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}
