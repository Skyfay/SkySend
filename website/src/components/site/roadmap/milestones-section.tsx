"use client";

import { useEffect, useState } from "react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { MilestoneCard } from "@/components/site/roadmap/milestone-card";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_REPO } from "@/lib/content";
import { MILESTONES } from "@/lib/roadmap";

const STARS_CACHE_KEY = "skysend-gh-stars";
const STARS_CACHE_TTL_MS = 10 * 60 * 1000;

export function MilestonesSection() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<{ stargazers_count: number }>(
      STARS_CACHE_KEY,
      `https://api.github.com/repos/${GITHUB_REPO}`,
      STARS_CACHE_TTL_MS
    )
      .then((data) => {
        if (!cancelled) setStars(data.stargazers_count);
      })
      .catch(() => {
        // keep fallbackCurrent
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="relative border-y border-border/60 bg-card/40 dark:border-transparent dark:bg-card/20">
      <div className="bg-dot-grid absolute inset-0 -z-10 opacity-40" />
      <div className="mx-auto max-w-6xl px-6 py-14 sm:py-16">
        <SectionHeading
          eyebrow="Milestones"
          title="Community goals"
          description="Big-picture targets we're working toward alongside the roadmap."
        />

        <Reveal>
          <div className="mx-auto mt-8 flex max-w-xl flex-col gap-3">
            {MILESTONES.map((milestone) => (
              <MilestoneCard
                key={milestone.slug}
                milestone={milestone}
                current={
                  milestone.liveSource === "github-stars" && stars !== null
                    ? stars
                    : milestone.fallbackCurrent
                }
              />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
