import { Braces, Terminal, Timer, Workflow } from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";

const POINTS = [
  {
    icon: Terminal,
    title: "Cross-platform CLI",
    description:
      "Upload and download with the same end-to-end encryption as the web app, straight from your terminal or CI pipeline.",
    tags: ["skysend upload", "skysend download"],
  },
  {
    icon: Timer,
    title: "Scriptable expiry & limits",
    description:
      "Set expiry time and download count from the command line - no need to touch the web UI for automated shares.",
    tags: ["--expires", "--downloads"],
  },
  {
    icon: Braces,
    title: "A documented REST API",
    description:
      "Every instance exposes the same HTTP API the web app and CLI use, for building your own integrations on top.",
    tags: ["REST API"],
  },
  {
    icon: Workflow,
    title: "Built for CI/CD",
    description:
      "Script a share of build artifacts or logs as part of a pipeline, then drop the link wherever it's needed.",
    tags: ["GitHub Actions", "GitLab CI"],
  },
];

export function AutomationSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="Automation"
        title="Fits into how you already work"
        description="A CLI and TUI client with the same encryption guarantees as the browser, built to be scripted - not just clicked through."
      />

      <Reveal>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {POINTS.map((point) => (
            <div
              key={point.title}
              className="group relative overflow-hidden rounded-xl border border-border bg-card/50 p-6 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
            >
              <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-40" />
              <div className="relative flex size-11 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/15 transition-transform group-hover:scale-110">
                <point.icon className="size-5 text-primary" />
              </div>
              <h3 className="relative mt-3 text-lg font-semibold tracking-tight">
                {point.title}
              </h3>
              <p className="relative mt-1 text-sm text-muted-foreground">
                {point.description}
              </p>
              <div className="relative mt-4 flex flex-wrap gap-1.5">
                {point.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
