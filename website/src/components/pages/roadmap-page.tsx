import { PageBackdrop } from "@/components/site/page-backdrop";
import { Eyebrow } from "@/components/site/fx";
import { NowSection } from "@/components/site/roadmap/now-section";
import { RoadmapTimeline, type ResolvedItem, type ResolvedShipped } from "@/components/site/roadmap/timeline";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { CHANGELOG_URL } from "@/lib/content";
import { findRelease, getReleases } from "@/lib/releases";
import { MILESTONES, ROADMAP_ITEMS, SHIPPED_ITEMS } from "@/lib/roadmap";
import { pageMetadata } from "@/lib/seo";
import { formatDate } from "@/lib/utils";

export function roadmapMetadata(locale: Locale) {
  const t = createTranslator(locale);
  return pageMetadata(locale, "/roadmap/", {
    title: t("meta.roadmapTitle"),
    description: t("meta.roadmapDescription"),
  });
}

export function RoadmapPage({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  // A long month, since a short German one ends in a period of its own.
  const dayOf = new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", day: "numeric", timeZone: "UTC" });

  // Text from the messages, dates and links of releases from the changelog at build time.
  const shipped: ResolvedShipped[] = SHIPPED_ITEMS.map(({ highlights, ...item }) => {
    const release = findRelease(item.version);
    const date = item.releaseDate ?? release?.date ?? null;
    const key = `roadmap.shipped.${item.slug}` as const;
    return {
      ...item,
      title: t(`${key}.title`),
      description: t(`${key}.description`),
      highlights: highlights?.map((h) => t(h)),
      dateLabel: date ? formatDate(date, locale) : t("roadmap.new"),
      href: item.link ?? release?.href ?? CHANGELOG_URL,
    };
  });
  const items: ResolvedItem[] = ROADMAP_ITEMS.map((item) => ({
    ...item,
    title: t(`roadmap.items.${item.slug}.title`),
    description: t(`roadmap.items.${item.slug}.description`),
  }));
  const reached = SHIPPED_ITEMS.flatMap((s) =>
    s.stars !== undefined && s.releaseDate ? [{ value: s.stars, day: dayOf.format(new Date(s.releaseDate)) }] : []
  ).sort((a, b) => a.value - b.value);

  return (
    <div className="relative">
      <PageBackdrop />

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col items-center gap-5 px-4 pt-[124px] text-center sm:px-6 sm:pt-[164px]">
        <Eyebrow>{t("roadmap.eyebrow")}</Eyebrow>
        <h1 className="text-[40px] leading-[1.04] font-semibold tracking-[-0.045em] sm:text-[64px]">
          {t.rich("roadmap.title", { shine: (c) => <span className="fx-shine">{c}</span> })}
        </h1>
        <p className="max-w-[640px] text-lg leading-relaxed text-muted-foreground">{t("roadmap.lead")}</p>
      </section>

      <NowSection
        locale={locale}
        latest={shipped.find((s) => s.stars === undefined)}
        inProgress={items.filter((i) => i.status === "in-progress")}
        milestone={MILESTONES[0]}
        reached={reached}
      />
      <RoadmapTimeline
        shipped={shipped}
        ahead={items.filter((i) => i.status !== "in-progress")}
        releaseCount={getReleases().filter((r) => r.date).length}
        changelogUrl={CHANGELOG_URL}
      />
    </div>
  );
}
