"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, LayoutGrid, Map as MapIcon, PenLine, Server, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOCS_URL } from "@/lib/content";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

export interface NavLink {
  /** A path of the site without the language prefix, or an outside URL. */
  href: string;
  label: MessageKey;
  caption: MessageKey;
  icon: LucideIcon;
  /** The tone the link takes in the mobile menu. */
  tone: "blue" | "cyan" | "violet" | "green" | "amber";
  external?: boolean;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/#features", label: "nav.features", caption: "nav.featuresCaption", icon: LayoutGrid, tone: "blue" },
  { href: "/#instances", label: "nav.instances", caption: "nav.instancesCaption", icon: Server, tone: "cyan" },
  { href: DOCS_URL, label: "nav.docs", caption: "nav.docsCaption", icon: BookOpen, tone: "violet", external: true },
  { href: "/roadmap", label: "nav.roadmap", caption: "nav.roadmapCaption", icon: MapIcon, tone: "green" },
  { href: "/blog", label: "nav.blog", caption: "nav.blogCaption", icon: PenLine, tone: "amber" },
];

/** The link of the page being shown, or none on the home page. */
export function useActiveHref() {
  const { path } = useI18n();
  const pathname = usePathname().replace(/\/$/, "") || "/";
  return NAV_LINKS.find((l) => !l.external && !l.href.includes("#") && pathname.startsWith(path(l.href)))?.href;
}

/** The href of a nav link in the language of the page. */
export function useNavHref() {
  const { path } = useI18n();
  return (link: NavLink) => (link.external ? link.href : path(link.href));
}

export function NavLinks({ className }: { className?: string }) {
  const { t } = useI18n();
  const active = useActiveHref();
  const hrefOf = useNavHref();

  return (
    <nav aria-label={t("nav.main")} className={className}>
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={hrefOf(link)}
          target={link.external ? "_blank" : undefined}
          rel={link.external ? "noreferrer" : undefined}
          aria-current={link.href === active ? "page" : undefined}
          className={cn(
            "flex h-8 items-center rounded-lg px-3 font-medium text-subtle transition-colors hover:bg-foreground/5 hover:text-foreground",
            link.href === active && "bg-foreground/10 text-foreground"
          )}
        >
          {t(link.label)}
        </Link>
      ))}
    </nav>
  );
}
