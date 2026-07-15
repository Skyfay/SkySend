import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/site/github-icon";
import { TerminalSnippet } from "@/components/site/terminal-snippet";
import { AmbientGlow } from "@/components/site/ambient-glow";
import { ContributorAvatars } from "@/components/site/contributor-avatars";
import { GITHUB_REPO, GETTING_STARTED_URL } from "@/lib/content";
import { highlightCode } from "@/lib/highlight";

const HERO_SNIPPET = `$ docker run -d \\
  -p 3000:3000 \\
  -e BASE_URL=https://your-domain.com \\
  -v ./data:/data \\
  -v ./uploads:/uploads \\
  skyfay/skysend:latest`;

export async function Hero() {
  const highlightedHtml = await highlightCode(HERO_SNIPPET, "bash");

  return (
    <section className="relative isolate overflow-hidden">
      <AmbientGlow className="h-[420px] sm:h-[520px] lg:h-[600px]" />

      <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
          Share files and notes,{" "}
          <span className="text-primary">without anyone reading them.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Self-hostable, end-to-end encrypted file and note sharing. No
          accounts, no tracking - the server never sees anything but
          ciphertext.
        </p>

        <div className="mt-6 flex justify-center">
          <ContributorAvatars />
        </div>

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
            <Link
              href={`https://github.com/${GITHUB_REPO}`}
              target="_blank"
              rel="noreferrer"
            >
              <GithubIcon className="size-4" />
              View on GitHub
            </Link>
          </Button>
        </div>

        <TerminalSnippet
          code={HERO_SNIPPET}
          highlightedHtml={highlightedHtml}
          className="mx-auto mt-12 max-w-xl text-left"
        />
      </div>
    </section>
  );
}
