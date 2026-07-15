import Link from "next/link";
import { TerminalSnippet } from "@/components/site/terminal-snippet";
import { SectionHeading } from "@/components/site/section-heading";
import { QUICK_START_SNIPPET, GETTING_STARTED_URL } from "@/lib/content";
import { highlightCode } from "@/lib/highlight";

export async function QuickStart() {
  const highlightedHtml = await highlightCode(QUICK_START_SNIPPET, "yaml");

  return (
    <section className="mx-auto max-w-4xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="Quick start"
        title="Running in under five minutes"
        description="Save this as docker-compose.yml, set your public URL, and run docker-compose up -d."
      />

      <TerminalSnippet
        code={QUICK_START_SNIPPET}
        highlightedHtml={highlightedHtml}
        className="mt-10"
      />

      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link
          href={GETTING_STARTED_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Read the full installation guide
        </Link>
      </p>
    </section>
  );
}
