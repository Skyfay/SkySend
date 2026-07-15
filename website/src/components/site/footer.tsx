import Link from "next/link";
import Image from "next/image";
import { buttonVariants } from "@/components/ui/button";
import { GithubStarsWidget } from "@/components/site/github-stars-widget";
import { GithubIcon } from "@/components/site/github-icon";
import { DiscordIcon } from "@/components/site/discord-icon";
import { DOCS_URL, DISCORD_URL, GITHUB_REPO } from "@/lib/content";

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/blog", label: "Blog" },
      { href: `https://github.com/${GITHUB_REPO}`, label: "GitHub", external: true },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: DOCS_URL, label: "Documentation", external: true },
      { href: `${DOCS_URL}/changelog`, label: "Changelog", external: true },
      { href: "/roadmap", label: "Roadmap" },
      { href: "/#instances", label: "Server Instances" },
      { href: "/report", label: "Report Abuse" },
    ],
  },
  {
    title: "Community",
    links: [
      { href: DISCORD_URL, label: "Discord", external: true },
      { href: `https://github.com/${GITHUB_REPO}/issues`, label: "Issues", external: true },
      { href: "mailto:support@skysend.app", label: "Support" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative isolate overflow-hidden">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" />
      <div className="bg-dot-grid absolute inset-0 -z-10 opacity-40" />
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo.svg" alt="SkySend" width={24} height={24} />
              <span className="font-semibold">SkySend</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              End-to-end encrypted, self-hostable file and note sharing. No
              accounts, no tracking.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <GithubStarsWidget />
              <a
                href={`https://github.com/${GITHUB_REPO}`}
                target="_blank"
                rel="noreferrer"
                aria-label="SkySend on GitHub"
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <GithubIcon className="size-4" />
              </a>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Join our Discord"
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <DiscordIcon className="size-4" />
              </a>
            </div>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noreferrer" : undefined}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" width={16} height={16} aria-hidden="true" />
            &copy; {new Date().getFullYear()} SkySend. Licensed under AGPL-3.0.
          </p>
          <p>Self-hosted. Open source. Zero-knowledge.</p>
        </div>
      </div>
    </footer>
  );
}
