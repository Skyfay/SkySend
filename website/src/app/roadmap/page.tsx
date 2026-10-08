import { PageBackdrop } from "@/components/site/page-backdrop";
import { Eyebrow } from "@/components/site/fx";
import { NowSection } from "@/components/site/roadmap/now-section";
import { RoadmapTimeline, type ResolvedShipped } from "@/components/site/roadmap/timeline";
import { CHANGELOG_URL } from "@/lib/content";
import { findRelease, getReleases } from "@/lib/releases";
import { MILESTONES, ROADMAP_ITEMS, SHIPPED_ITEMS } from "@/lib/roadmap";
import { formatDate } from "@/lib/utils";

export const metadata = {
  title: "Roadmap",
  description: "What shipped, what is being built and what is on the wishlist for SkySend. No promised dates, just an honest status.",
  alternates: {
    canonical: "/roadmap",
  },
};

export default function RoadmapPage() {
  // Dates and links of releases come from the changelog at build time.
  const shipped: ResolvedShipped[] = SHIPPED_ITEMS.map((item) => {
    const release = findRelease(item.version);
    const date = item.releaseDate ?? release?.date ?? null;
    return {
      ...item,
      dateLabel: date ? formatDate(date) : "New",
      href: item.link ?? release?.href ?? CHANGELOG_URL,
    };
  });
  const reached = SHIPPED_ITEMS.flatMap((s) =>
    s.stars !== undefined && s.releaseDate
      ? [{ value: s.stars, day: formatDate(s.releaseDate).replace(/, \d{4}$/, "") }]
      : []
  ).sort((a, b) => a.value - b.value);

  return (
    <div className="relative">
      <PageBackdrop />

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col items-center gap-5 px-4 pt-[124px] text-center sm:px-6 sm:pt-[164px]">
        <Eyebrow>Roadmap</Eyebrow>
        <h1 className="text-[40px] leading-[1.04] font-semibold tracking-[-0.045em] sm:text-[64px]">
          From what shipped
          <br />
          <span className="fx-shine">to what comes next.</span>
        </h1>
        <p className="max-w-[640px] text-lg leading-relaxed text-muted-foreground">
          One line through SkySend&apos;s releases and plans, from the first stable release to the ideas ahead. No
          promised dates, just an honest status.
        </p>
      </section>

      <NowSection
        latest={shipped.find((s) => s.stars === undefined)}
        inProgress={ROADMAP_ITEMS.filter((i) => i.status === "in-progress")}
        milestone={MILESTONES[0]}
        reached={reached}
      />
      <RoadmapTimeline
        shipped={shipped}
        ahead={ROADMAP_ITEMS.filter((i) => i.status !== "in-progress")}
        releaseCount={getReleases().filter((r) => r.date).length}
        changelogUrl={CHANGELOG_URL}
      />
    </div>
  );
}
