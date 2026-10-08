"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Star } from "lucide-react";
import { z } from "zod";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_REPO, GITHUB_URL } from "@/lib/content";
import type { Milestone } from "@/lib/roadmap";
import { useI18n } from "@/i18n/provider";
import { INTL_LOCALE } from "@/i18n/config";

// Shared with the stars button in the header, so both read one request.
const CACHE_KEY = "skysend-gh-stars";
const CACHE_TTL_MS = 10 * 60 * 1000;

const RepoSchema = z.object({ stargazers_count: z.number().int().nonnegative() });

/** A goal reached before, with the day it was reached, like "May 10" or "10. Mai". */
export type ReachedStep = { value: number; day: string };

/** The next community goal with the live star count and the goals reached before it. */
export function StarMilestone({ milestone, reached }: { milestone: Milestone; reached: ReachedStep[] }) {
  const { t, locale } = useI18n();
  const [stars, setStars] = useState<number | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<unknown>(CACHE_KEY, `https://api.github.com/repos/${GITHUB_REPO}`, CACHE_TTL_MS)
      .then((raw) => {
        const parsed = RepoSchema.safeParse(raw);
        if (!cancelled) setStars(parsed.success ? parsed.data.stargazers_count : "failed");
      })
      .catch(() => {
        if (!cancelled) setStars("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const count = typeof stars === "number" ? stars : null;
  const at = (value: number) => `${Math.min(100, (value / milestone.target) * 100)}%`;

  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="text-[28px] font-semibold tracking-[-0.03em] tabular-nums">
          {t("roadmap.stars", { count: milestone.target })}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {count !== null
            ? t("roadmap.soFar", { count })
            : stars === "failed"
              ? t("roadmap.countOnGithub")
              : t("roadmap.counting")}
        </span>
      </span>
      <div aria-hidden="true" className="relative mt-2 h-2 rounded-full bg-accent">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#b45309] to-tone-amber shadow-[0_0_14px_rgb(251_191_36/0.45)] transition-[width] duration-700"
          style={{ width: at(count ?? 0) }}
        />
        {reached.map((step) => (
          <span key={step.value} className="absolute -top-[3px] h-3.5 w-0.5 bg-card" style={{ left: at(step.value) }} />
        ))}
      </div>
      <div aria-hidden="true" className="relative h-4 text-xs text-muted-foreground tabular-nums">
        {reached.map((step) => (
          <span key={step.value} className="absolute top-0 -translate-x-1/2" style={{ left: at(step.value) }}>
            {step.value}
          </span>
        ))}
      </div>
      {reached.length > 0 && (
        <p className="text-xs leading-normal text-muted-foreground">
          {t("roadmap.reached", {
            list: new Intl.ListFormat(INTL_LOCALE[locale], { type: "conjunction" }).format(
              reached.map((step) => t("roadmap.reachedItem", { count: step.value, day: step.day }))
            ),
          })}
        </p>
      )}
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-auto flex w-fit items-center gap-1.5 font-medium text-tone-amber"
      >
        <Star className="size-3.5" />
        {t("roadmap.starOnGithub")}
        <ArrowUpRight className="size-3.5" />
      </a>
    </>
  );
}
