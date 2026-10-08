import Link from "next/link";
import Image from "next/image";
import { GithubStarsWidget } from "@/components/site/github-stars-widget";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { NavLinks } from "@/components/site/nav-links";
import { MobileMenu } from "@/components/site/mobile-menu";
import { SponsorButton } from "@/components/site/sponsor-button";
import { getReleaseVersion } from "@/lib/version";

// The header floats over the top of every page as a glass pill, so each page
// starts its first section with room for it (pt-[124px] sm:pt-[172px]).
export function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-5">
      <div className="glass pointer-events-auto mx-auto flex h-14 max-w-[1100px] items-center gap-5 rounded-[14px] pr-2 pl-3.5 sm:pr-2.5 sm:pl-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold">
          <Image src="/logo.svg" alt="" width={26} height={26} />
          SkySend
        </Link>

        <NavLinks className="hidden gap-0.5 lg:flex" />

        <div className="ml-auto flex items-center gap-2">
          <SponsorButton />
          <span className="hidden sm:block">
            <ThemeToggle />
          </span>
          <GithubStarsWidget className="hidden sm:flex" />
          <Link
            href="/#start"
            className="btn-primary hidden h-9 items-center rounded-lg px-3.5 font-medium sm:flex"
          >
            Get started
          </Link>

          <MobileMenu version={getReleaseVersion()} />
        </div>
      </div>
    </header>
  );
}
