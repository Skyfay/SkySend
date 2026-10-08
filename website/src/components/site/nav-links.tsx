"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, LayoutGrid, Map as MapIcon, PenLine, Server, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOCS_URL } from "@/lib/content";

export interface NavLink {
  href: string;
  label: string;
  caption: string;
  icon: LucideIcon;
  /** The tone the link takes in the mobile menu. */
  tone: "blue" | "cyan" | "violet" | "green" | "amber";
  external?: boolean;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/#features", label: "Features", caption: "Everything a private share needs", icon: LayoutGrid, tone: "blue" },
  { href: "/#instances", label: "Instances", caption: "Public servers to share on", icon: Server, tone: "cyan" },
  { href: DOCS_URL, label: "Docs", caption: "Guides, API and the crypto design", icon: BookOpen, tone: "violet", external: true },
  { href: "/roadmap", label: "Roadmap", caption: "Shipped and up next", icon: MapIcon, tone: "green" },
  { href: "/blog", label: "Blog", caption: "Notes from building SkySend", icon: PenLine, tone: "amber" },
];

/** The link of the page being shown, or none on the home page. */
export function useActiveHref() {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  return NAV_LINKS.find((l) => !l.external && !l.href.includes("#") && pathname.startsWith(l.href))?.href;
}

export function NavLinks({ className }: { className?: string }) {
  const active = useActiveHref();

  return (
    <nav aria-label="Main" className={className}>
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          target={link.external ? "_blank" : undefined}
          rel={link.external ? "noreferrer" : undefined}
          aria-current={link.href === active ? "page" : undefined}
          className={cn(
            "flex h-8 items-center rounded-lg px-3 font-medium text-subtle transition-colors hover:bg-foreground/5 hover:text-foreground",
            link.href === active && "bg-foreground/10 text-foreground"
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
