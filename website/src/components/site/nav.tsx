import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GithubStarsWidget } from "@/components/site/github-stars-widget";
import { DiscordIcon } from "@/components/site/discord-icon";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { DOCS_URL, DISCORD_URL, GETTING_STARTED_URL } from "@/lib/content";

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#instances", label: "Server Instances" },
  { href: "/#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/report", label: "Report Abuse" },
  { href: DOCS_URL, label: "Docs", external: true },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="SkySend" width={28} height={28} />
          <span className="font-semibold">SkySend</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noreferrer" : undefined}
              className="relative py-1 transition-colors after:absolute after:-bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:scale-0 after:rounded-full after:bg-primary after:transition-transform hover:text-foreground hover:after:scale-100"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-3 lg:flex">
            <GithubStarsWidget />
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Join our Discord"
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                >
                  <DiscordIcon className="size-4" />
                </a>
              </TooltipTrigger>
              <TooltipContent>Join our Discord</TooltipContent>
            </Tooltip>
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href={GETTING_STARTED_URL} target="_blank" rel="noreferrer">
                Get Started
              </Link>
            </Button>
          </div>

          <div className="lg:hidden">
            <ThemeToggle />
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="lg:hidden">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>SkySend</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-4 px-4 text-sm">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    target={link.external ? "_blank" : undefined}
                    rel={link.external ? "noreferrer" : undefined}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="flex items-center gap-3">
                  <GithubStarsWidget />
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
                <Button asChild size="sm">
                  <Link href={GETTING_STARTED_URL} target="_blank" rel="noreferrer">
                    Get Started
                  </Link>
                </Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
