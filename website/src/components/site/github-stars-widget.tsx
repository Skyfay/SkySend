"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_REPO } from "@/lib/content";

const CACHE_KEY = "skysend-gh-stars";
const CACHE_TTL_MS = 10 * 60 * 1000;

type State =
  | { status: "loading" }
  | { status: "ready"; stars: number }
  | { status: "error" };

export function GithubStarsWidget() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<{ stargazers_count: number }>(
      CACHE_KEY,
      `https://api.github.com/repos/${GITHUB_REPO}`,
      CACHE_TTL_MS
    )
      .then((data) => {
        if (!cancelled) setState({ status: "ready", stars: data.stargazers_count });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a
      href={`https://github.com/${GITHUB_REPO}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
    >
      <Star className="size-3.5" />
      Star on GitHub
      {state.status === "ready" && (
        <span className="text-muted-foreground">
          {new Intl.NumberFormat("en", { notation: "compact" }).format(state.stars)}
        </span>
      )}
    </a>
  );
}
