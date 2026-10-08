"use client";

import { useState } from "react";
import { ArrowUpRight, MessageSquare, Plus, Star } from "lucide-react";
import { CategoryPill } from "@/components/site/roadmap/category";
import { GITHUB_URL } from "@/lib/content";
import type { RoadmapItem, ShippedItem } from "@/lib/roadmap";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * A shipped entry with its text in the language of the page, and its date and
 * link resolved from the changelog at build time.
 */
export interface ResolvedShipped extends Omit<ShippedItem, "highlights"> {
  title: string;
  description: string;
  highlights?: string[];
  /** "Oct 5, 2026", or "New" for a release the changelog does not have yet. */
  dateLabel: string;
  href: string;
}

/** A planned item or an idea with its text in the language of the page. */
export interface ResolvedItem extends RoadmapItem {
  title: string;
  description: string;
}

type Filter = "all" | "releases" | "stars";
type Side = "back" | "ahead";

const FILTERS: { id: Filter; label: MessageKey }[] = [
  { id: "all", label: "roadmap.filterAll" },
  { id: "releases", label: "roadmap.filterReleases" },
  { id: "stars", label: "roadmap.filterStars" },
];

// The cards hang off the spine in the middle: a short line from the card to a
// dot on the spine. Both only show from lg up, where the spine is drawn.
const DOT = "absolute top-[22px] hidden size-3 rounded-full border-2 bg-background lg:block";
const LINE = "absolute top-[27px] hidden h-px w-[34px] bg-border lg:block";

function ShippedEntry({ item, latest }: { item: ResolvedShipped; latest: boolean }) {
  const star = item.stars !== undefined;
  return (
    <div className="relative">
      <span aria-hidden="true" className={cn(LINE, "-right-10")} />
      <span
        aria-hidden="true"
        className={cn(
          DOT,
          "-right-[46px]",
          star
            ? "border-tone-amber shadow-[0_0_10px_rgb(251_191_36/0.6)]"
            : latest
              ? "border-tone-blue bg-tone-blue shadow-[0_0_0_4px_rgb(96_165_250/0.18),0_0_14px_rgb(96_165_250/0.7)]"
              : "border-tone-blue"
        )}
      />
      {star ? (
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-[14px] border border-tone-amber/30 bg-gradient-to-r from-tone-amber/10 to-tone-amber/[0.02] px-[18px] py-3.5"
        >
          <Star className="size-[18px] shrink-0 fill-tone-amber text-tone-amber" />
          <span className="font-semibold">{item.title}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">{item.dateLabel}</span>
        </a>
      ) : (
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          className="panel group flex flex-col gap-1.5 rounded-[14px] px-[18px] py-3.5 transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input"
        >
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="inline-flex h-[22px] items-center rounded-full bg-tone-blue/14 px-2 text-xs font-semibold text-tone-blue-soft tabular-nums">
              {item.version}
            </span>
            <span className="font-semibold">{item.title}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{item.dateLabel}</span>
          </span>
          <span className="leading-normal text-muted-foreground">{item.description}</span>
        </a>
      )}
    </div>
  );
}

function AheadCard({ item }: { item: ResolvedItem }) {
  const { t } = useI18n();
  const planned = item.status === "planned";
  const discuss = item.issueNumber ? `${GITHUB_URL}/issues/${item.issueNumber}` : `${GITHUB_URL}/issues`;
  return (
    <div className="relative">
      <span aria-hidden="true" className={cn(LINE, "-left-10")} />
      <span aria-hidden="true" className={cn(DOT, "-left-[46px]", planned ? "border-tone-green" : "border-tone-violet")} />
      <div className="panel flex flex-col gap-2 rounded-[14px] px-[18px] py-4">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold",
              planned ? "bg-tone-green/16 text-tone-green" : "bg-tone-violet/16 text-tone-violet"
            )}
          >
            {planned ? t("roadmap.planned") : t("roadmap.idea")}
          </span>
          <CategoryPill category={item.category} />
          <a
            href={discuss}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <MessageSquare className="size-3" />
            {t("roadmap.discuss")}
          </a>
        </span>
        <span className="text-base font-semibold">{item.title}</span>
        <span className="leading-[1.55] text-muted-foreground">{item.description}</span>
      </div>
    </div>
  );
}

/**
 * One spine through the roadmap: shipped work runs down the left, newest
 * first, planned work then ideas run down the right. Below lg two buttons
 * switch between the sides.
 */
export function RoadmapTimeline({
  shipped,
  ahead,
  releaseCount,
  changelogUrl,
}: {
  shipped: ResolvedShipped[];
  ahead: ResolvedItem[];
  releaseCount: number;
  changelogUrl: string;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [side, setSide] = useState<Side>("back");

  const latest = shipped.find((s) => s.stars === undefined)?.slug;
  const visible = shipped.filter((s) => filter === "all" || (filter === "stars") === (s.stars !== undefined));
  const sorted = [...ahead].sort((a, b) => Number(a.status === "idea") - Number(b.status === "idea"));

  return (
    <section aria-labelledby="roadmap-back" className="relative z-[2] mx-auto mt-14 max-w-[1248px] px-4 sm:px-6">
      <div role="group" aria-label={t("roadmap.side")} className="mb-6 flex h-11 rounded-xl border border-border bg-surface p-[3px] lg:hidden">
        {(
          [
            ["back", "roadmap.lookingBack"],
            ["ahead", "roadmap.ahead"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={side === id}
            onClick={() => setSide(id)}
            className={cn(
              "grow rounded-[9px] text-[13px] font-medium transition-colors",
              side === id
                ? id === "ahead"
                  ? "bg-tone-green/16 text-tone-green"
                  : "bg-card text-foreground shadow-[var(--chip-shadow)] dark:bg-accent"
                : "text-muted-foreground"
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div className="relative grid lg:grid-cols-[minmax(0,1fr)_80px_minmax(0,1fr)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 -ml-px hidden w-0.5 lg:block"
          style={{
            background:
              "linear-gradient(color-mix(in srgb, var(--tone-green) 80%, transparent), color-mix(in srgb, var(--tone-green) 35%, transparent) 30%, var(--border) 70%, transparent)",
          }}
        />

        <div className={cn("flex-col gap-3", side === "back" ? "flex" : "hidden lg:flex")}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 id="roadmap-back" className="text-xl font-semibold tracking-[-0.02em]">
              {t("roadmap.lookingBack")}
            </h2>
            <div role="group" aria-label={t("roadmap.show")} className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "h-[30px] rounded-full border px-3 text-[13px] font-medium transition-colors",
                    filter === f.id
                      ? "border-input bg-card text-foreground shadow-[var(--chip-shadow)] dark:bg-accent"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(f.label)}
                </button>
              ))}
            </div>
          </div>
          {visible.map((item) => (
            <ShippedEntry key={item.slug} item={item} latest={item.slug === latest} />
          ))}
          <a
            href={changelogUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-input font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {releaseCount > 0 ? t("roadmap.allReleases", { count: releaseCount }) : t("roadmap.everyRelease")}
            <ArrowUpRight className="size-3.5" />
          </a>
        </div>

        <div aria-hidden="true" className="hidden lg:block" />

        <div className={cn("flex-col gap-3", side === "ahead" ? "flex" : "hidden lg:flex")}>
          <h2 className="mb-2 flex h-[30px] items-center text-xl font-semibold tracking-[-0.02em]">{t("roadmap.ahead")}</h2>
          {sorted.map((item) => (
            <AheadCard key={item.slug} item={item} />
          ))}
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-dashed border-input p-5">
            <span className="font-semibold">{t("roadmap.missing")}</span>
            <span className="leading-[1.55] text-muted-foreground">{t("roadmap.missingText")}</span>
            <a
              href={`${GITHUB_URL}/issues/new`}
              target="_blank"
              rel="noreferrer"
              className="btn-chip flex h-[38px] w-fit items-center gap-1.5 rounded-[9px] px-3.5 font-medium"
            >
              <Plus className="size-3.5" />
              {t("roadmap.suggest")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
