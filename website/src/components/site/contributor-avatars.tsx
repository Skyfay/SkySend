"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_REPO } from "@/lib/content";

interface Contributor {
  login: string;
  avatar_url: string;
}

const CACHE_KEY = "skysend-gh-contributors";
const CACHE_TTL_MS = 30 * 60 * 1000;

export function ContributorAvatars() {
  const [contributors, setContributors] = useState<Contributor[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<Contributor[]>(
      CACHE_KEY,
      `https://api.github.com/repos/${GITHUB_REPO}/contributors?per_page=6`,
      CACHE_TTL_MS
    )
      .then((data) => {
        if (!cancelled) setContributors(data);
      })
      .catch(() => {
        // Silently hide the strip if the GitHub API is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (contributors.length === 0) return null;

  return (
    <Link
      href={`https://github.com/${GITHUB_REPO}/graphs/contributors`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-3 rounded-full border border-border bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
    >
      <div className="flex -space-x-2">
        {contributors.map((c) => (
          <Avatar key={c.login} size="sm" className="ring-2 ring-background">
            <AvatarImage src={c.avatar_url} alt={c.login} />
            <AvatarFallback>{c.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        ))}
      </div>
      and more contributors
    </Link>
  );
}
