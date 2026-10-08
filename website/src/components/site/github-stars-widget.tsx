"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { z } from "zod";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_URL, GITHUB_REPO } from "@/lib/content";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import { INTL_LOCALE } from "@/i18n/config";

const CACHE_KEY = "skysend-gh-stars";
const CACHE_TTL_MS = 10 * 60 * 1000;

const RepoSchema = z.object({ stargazers_count: z.number().int().nonnegative() });

export function GithubStarsWidget({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<unknown>(CACHE_KEY, `https://api.github.com/repos/${GITHUB_REPO}`, CACHE_TTL_MS)
      .then((raw) => {
        const parsed = RepoSchema.safeParse(raw);
        if (!cancelled && parsed.success) setStars(parsed.data.stargazers_count);
      })
      .catch(() => {
        // Without the GitHub API the widget stays a plain link to the repository.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={t("nav.starLabel")}
      className={cn("btn-chip h-9 items-center gap-1.5 rounded-lg px-3 font-medium", className)}
    >
      <Star className="size-4" />
      <span className="font-normal text-muted-foreground tabular-nums">
        {stars === null ? t("nav.star") : new Intl.NumberFormat(INTL_LOCALE[locale], { notation: "compact" }).format(stars)}
      </span>
    </a>
  );
}
