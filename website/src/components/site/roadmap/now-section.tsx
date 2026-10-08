import Image from "next/image";
import { ArrowUpRight, Code, Inbox, LayoutGrid, Palette, Star, Type, type LucideIcon } from "lucide-react";
import { SpinBorder } from "@/components/site/fx";
import { CategoryPill } from "@/components/site/roadmap/category";
import { StarMilestone, type ReachedStep } from "@/components/site/roadmap/star-milestone";
import type { Milestone } from "@/lib/roadmap";
import type { ResolvedItem, ResolvedShipped } from "@/components/site/roadmap/timeline";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";

const CONIC_NOW =
  "conic-gradient(from 0deg, transparent 0deg 250deg, #46c89d 290deg, #22d3ee 320deg, #60a5fa 345deg, transparent 360deg)";

// The tiles beside the highlights of the latest release, in their order.
const HIGHLIGHT_TILES: { icon: LucideIcon; tone: string }[] = [
  { icon: LayoutGrid, tone: "blue" },
  { icon: Inbox, tone: "cyan" },
  { icon: Type, tone: "amber" },
  { icon: Palette, tone: "violet" },
  { icon: Code, tone: "green" },
];

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`flex items-center gap-2 text-[13px] font-medium ${className ?? ""}`}>{children}</span>;
}

/** The top of the spine: the latest release, what is being built and the next goal. */
export function NowSection({
  locale,
  latest,
  inProgress,
  milestone,
  reached,
}: {
  locale: Locale;
  latest: ResolvedShipped | undefined;
  inProgress: ResolvedItem[];
  milestone: Milestone | undefined;
  reached: ReachedStep[];
}) {
  const t = createTranslator(locale);
  return (
    <section aria-label={t("roadmap.now")} className="relative z-[2] mx-auto mt-16 flex max-w-[1248px] flex-col items-center px-4 sm:px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[90px] left-1/2 -ml-[430px] h-[440px] w-[860px] rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgb(70 200 157 / 0.4), rgb(34 211 238 / 0.16), transparent)",
          filter: "blur(30px)",
          opacity: "var(--glow-strength)",
        }}
      />
      <span className="relative flex size-14 items-center justify-center rounded-full border border-[#7ee6c1]/55 bg-[radial-gradient(circle_at_50%_30%,#c6f3e2,#ffffff_70%)] shadow-[0_0_0_6px_rgb(70_200_157/0.12),0_0_40px_rgb(70_200_157/0.5)] dark:bg-[radial-gradient(circle_at_50%_30%,#0f5a46,#0c0d0e_70%)]">
        <Image src="/logo.svg" alt="" width={30} height={30} />
      </span>
      <span className="relative mt-2.5 rounded-full bg-tone-green/16 px-2.5 py-0.5 text-xs font-semibold text-tone-green">{t("roadmap.now")}</span>
      <span
        aria-hidden="true"
        className="relative h-7 w-0.5"
        style={{ background: "linear-gradient(var(--tone-green), color-mix(in srgb, var(--tone-green) 30%, transparent))" }}
      />

      <SpinBorder
        conic={CONIC_NOW}
        size={1400}
        speed="normal"
        radius={22}
        className="w-full shadow-[0_40px_100px_-40px_rgb(23_163_122/0.6)]"
        innerClassName="grid bg-card md:grid-cols-3"
      >
        {latest && (
          <div className="flex flex-col gap-3 border-b border-border p-6 md:border-r md:border-b-0">
            <Label className="text-muted-foreground">
              <span className="size-2 rounded-full bg-tone-blue" />
              {t("roadmap.latestRelease")}
            </Label>
            <span className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="text-[28px] font-semibold tracking-[-0.03em] tabular-nums">{latest.version}</span>
              <span className="text-muted-foreground">{latest.dateLabel}</span>
            </span>
            {latest.highlights ? (
              <ul className="flex flex-col gap-2">
                {latest.highlights.map((text, i) => {
                  const tile = HIGHLIGHT_TILES[i % HIGHLIGHT_TILES.length];
                  return (
                    <li key={text} className="flex items-center gap-2.5 text-subtle">
                      <span
                        className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px]"
                        style={{
                          background: `color-mix(in srgb, var(--tone-${tile.tone}) 14%, transparent)`,
                          color: `var(--tone-${tile.tone})`,
                        }}
                      >
                        <tile.icon className="size-[13px]" />
                      </span>
                      {text}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="leading-[1.55] text-subtle">{latest.description}</p>
            )}
            <a
              href={latest.href}
              target="_blank"
              rel="noreferrer"
              className="mt-auto flex w-fit items-center gap-1.5 font-medium text-tone-blue-soft"
            >
              {t("roadmap.readChangelog")}
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        )}

        <div className="flex flex-col gap-3 border-b border-border bg-[radial-gradient(420px_circle_at_50%_0%,rgb(70_200_157/0.1),transparent_70%)] p-6 md:border-r md:border-b-0">
          <Label className="text-tone-green">
            <span className="relative size-2">
              {inProgress.length > 0 && <span className="fx-ping absolute inset-0 rounded-full bg-tone-green" />}
              <span className="absolute inset-0 rounded-full bg-tone-green" />
            </span>
            {t("roadmap.beingBuilt")}
          </Label>
          {inProgress.map((item) => (
            <div key={item.slug} className="flex flex-col gap-2 rounded-xl border border-tone-green/30 bg-tone-green/6 px-3.5 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="grow text-base font-semibold">{item.title}</span>
                <CategoryPill category={item.category} />
              </span>
              <span className="text-[13px] leading-normal text-muted-foreground">{item.description}</span>
            </div>
          ))}
          {inProgress.length === 0 && (
            <>
              <span className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{t("roadmap.nothingInProgress")}</span>
              <span className="leading-[1.55] text-muted-foreground">{t("roadmap.nothingInProgressText")}</span>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 p-6">
          <Label className="text-tone-amber">
            <Star className="size-[13px] fill-current" />
            {t("roadmap.nextGoal")}
          </Label>
          {milestone && <StarMilestone milestone={milestone} reached={reached} />}
        </div>
      </SpinBorder>
    </section>
  );
}
