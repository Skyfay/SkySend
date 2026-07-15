import { Container, Globe, SquareTerminal, Webhook } from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { ACCESS_METHODS } from "@/lib/content";

const ACCESS_METHOD_ICONS = [Globe, SquareTerminal, Webhook, Container];

export function AccessMethods() {
  return (
    <section className="relative border-y border-border/60 bg-card/40 dark:border-transparent dark:bg-card/20">
      <div className="bg-dot-grid absolute inset-0 -z-10 opacity-40" />
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <SectionHeading
          eyebrow="Access"
          title="Use it however fits your workflow"
          description="The same instance, reachable from the browser, the terminal, or your own scripts."
        />

        <Reveal>
          <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {ACCESS_METHODS.map((method, i) => {
              const Icon = ACCESS_METHOD_ICONS[i] ?? Globe;
              return (
                <div
                  key={method.title}
                  className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card/50 p-6 text-center transition-all hover:-translate-y-1 hover:border-primary/30 hover:bg-card hover:shadow-lg"
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 transition-colors group-hover:bg-primary/15 sm:size-14 dark:bg-primary/15 dark:group-hover:bg-primary/20">
                    <Icon className="size-6 text-primary sm:size-7" />
                  </div>
                  <span className="text-sm font-medium">{method.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {method.description}
                  </span>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
