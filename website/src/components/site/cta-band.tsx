import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/site/github-icon";
import { SectionHeading } from "@/components/site/section-heading";
import { GETTING_STARTED_URL, GITHUB_REPO } from "@/lib/content";

export function CtaBand() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 text-center sm:py-24">
      <SectionHeading
        title="Share files and notes without giving up your privacy"
        description="Self-hosted, open source, and yours to run - free of charge, forever."
      />
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button
          asChild
          size="lg"
          className="transition-all hover:-translate-y-0.5 hover:shadow-lg"
        >
          <Link href={GETTING_STARTED_URL} target="_blank" rel="noreferrer">
            Get Started
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={`https://github.com/${GITHUB_REPO}`} target="_blank" rel="noreferrer">
            <GithubIcon className="size-4" />
            Star on GitHub
          </Link>
        </Button>
      </div>
    </section>
  );
}
