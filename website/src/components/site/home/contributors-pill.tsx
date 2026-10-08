"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { z } from "zod";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_REPO, GITHUB_URL } from "@/lib/content";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

const ContributorsSchema = z.array(
  z.object({
    login: z.string().min(1).max(39),
    avatar_url: z.string().startsWith("https://avatars.githubusercontent.com/"),
    type: z.string(),
  })
);

type Contributor = z.infer<typeof ContributorsSchema>[number];

const CACHE_KEY = "skysend-gh-contributors";
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_AVATARS = 7;
/** A phone shows fewer faces, so the pill keeps to one line beside its text. */
const MOBILE_AVATARS = 5;

/**
 * The people behind SkySend beside the main button of the hero. The avatars
 * fan out on hover and name the one under the mouse. Bots are left out, and
 * without the GitHub API the pill still links to the repository.
 */
export function ContributorsPill() {
  const { t } = useI18n();
  const [people, setPeople] = useState<Contributor[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<unknown>(
      CACHE_KEY,
      `https://api.github.com/repos/${GITHUB_REPO}/contributors?per_page=100`,
      CACHE_TTL_MS
    )
      .then((raw) => {
        const parsed = ContributorsSchema.safeParse(raw);
        if (!cancelled) setPeople(parsed.success ? parsed.data.filter((c) => c.type === "User") : []);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = (people ?? []).slice(0, MAX_AVATARS);

  return (
    <a
      href={`${GITHUB_URL}/graphs/contributors`}
      target="_blank"
      rel="noreferrer"
      className="group flex h-[46px] items-center gap-3 rounded-[10px] border border-input bg-surface-2/75 pr-3.5 pl-2 text-[13px] transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--input),var(--foreground)_15%)]"
    >
      <span className="flex items-center">
        {people === null &&
          Array.from({ length: 4 }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={cn("size-[30px] animate-pulse rounded-full bg-muted shadow-[0_0_0_2px_var(--surface-2)]", i > 0 && "-ml-2.5")}
            />
          ))}
        {shown.map((c, i) => (
          <span
            key={c.login}
            className={cn(
              "group/av relative z-[var(--z)] rounded-full shadow-[0_0_0_2px_var(--surface-2)] transition-[margin,transform] duration-200 hover:z-20 hover:-translate-y-[3px] hover:scale-110",
              i > 0 && "-ml-2.5 group-hover:-ml-0.5",
              i >= MOBILE_AVATARS ? "hidden sm:block" : "block"
            )}
            style={{ "--z": shown.length - i } as CSSProperties}
          >
            <Image
              src={`${c.avatar_url}${c.avatar_url.includes("?") ? "&" : "?"}s=64`}
              alt={c.login}
              width={30}
              height={30}
              className="block size-[30px] rounded-full"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 translate-y-1 rounded-md border border-input bg-popover px-2 py-1 text-xs font-medium whitespace-nowrap text-foreground opacity-0 shadow-[0_10px_20px_-10px_rgb(0_0_0/0.5)] transition-[opacity,transform] duration-150 group-hover/av:translate-y-0 group-hover/av:opacity-100"
            >
              {c.login}
            </span>
          </span>
        ))}
      </span>
      <span className="flex flex-col items-start text-left leading-tight whitespace-nowrap">
        <span className="font-medium text-foreground">
          {people && people.length > 0 ? t("hero.contributors", { count: people.length }) : t("hero.openSource")}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:block">{t("hero.builtInTheOpen")}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-[3px]" />
    </a>
  );
}
