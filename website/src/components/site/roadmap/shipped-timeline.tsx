import { ArrowUpRight, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { DOCS_URL } from "@/lib/content";
import { SHIPPED_ITEMS } from "@/lib/roadmap";

export function ShippedTimeline() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="Shipped"
        title="Already live"
        description="Bigger features from the roadmap that have already shipped. See the full changelog for every release."
        align="left"
        className="max-w-none"
      />

      <Reveal>
        <ol className="mt-10 flex flex-col gap-8 border-l border-border pl-6">
          {SHIPPED_ITEMS.map((item) => (
            <li key={item.slug} className="relative">
              <div className="flex flex-wrap items-center gap-2">
                {item.version && <Badge variant="outline">{item.version}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {new Date(item.releaseDate).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
              <h3 className="relative mt-2 font-semibold">
                {item.star ? (
                  <Star className="absolute top-1/2 -left-[32px] size-4 -translate-y-1/2 fill-amber-400 text-amber-400" />
                ) : (
                  <span className="absolute top-1/2 -left-[29px] size-2.5 -translate-y-1/2 rounded-full bg-primary" />
                )}
                {item.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
              <a
                href={
                  item.link
                    ? item.link.href
                    : item.changelogAnchor
                      ? `${DOCS_URL}/changelog#${item.changelogAnchor}`
                      : `${DOCS_URL}/changelog`
                }
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.link ? item.link.label : "View in changelog"}
                <ArrowUpRight className="size-3" />
              </a>
            </li>
          ))}
        </ol>
      </Reveal>
    </div>
  );
}
