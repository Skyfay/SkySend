"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InstanceCard } from "@/components/site/instances/instance-card";
import { fetchWithCache } from "@/lib/github";
import {
  INSTANCES_API_URL,
  InstancesResponseSchema,
  isOfficialInstance,
  type Instance,
} from "@/lib/instances";
import { INSTANCES_DOCS_URL } from "@/lib/content";

const CACHE_KEY = "skysend-instances";
const CACHE_TTL_MS = 5 * 60 * 1000;

type State =
  | { status: "loading" }
  | { status: "ready"; instances: Instance[]; lastUpdated: string | null }
  | { status: "error" };

type Filter = "all" | "file" | "note";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-border bg-card/50 p-6">
      <div className="flex items-start gap-4">
        <div className="size-12 shrink-0 rounded-xl bg-muted" />
        <div className="flex-1">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="mt-2 h-3 w-40 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-4 h-6 w-24 rounded-full bg-muted" />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="mt-5 h-9 rounded-full bg-muted" />
    </div>
  );
}

export function InstancesSection() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<unknown>(CACHE_KEY, INSTANCES_API_URL, CACHE_TTL_MS)
      .then((raw) => {
        if (cancelled) return;
        const parsed = InstancesResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setState({ status: "error" });
          return;
        }
        setState({
          status: "ready",
          instances: parsed.data.instances,
          lastUpdated: parsed.data.lastUpdated,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    const list =
      filter === "all"
        ? state.instances
        : state.instances.filter((inst) => inst.enabledServices.includes(filter));
    return [...list].sort((a, b) => {
      const aOff = isOfficialInstance(a.url) ? 0 : 1;
      const bOff = isOfficialInstance(b.url) ? 0 : 1;
      return aOff - bOff;
    });
  }, [state, filter]);

  return (
    <section id="instances" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="Server Instances"
        title="Public SkySend instances"
        description="SkySend is self-hostable - here are community and official instances you can use right away, with their live limits."
      />

      <Reveal>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="file">Files</TabsTrigger>
              <TabsTrigger value="note">Notes</TabsTrigger>
            </TabsList>
          </Tabs>
          {state.status === "ready" && state.lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {relativeTime(state.lastUpdated)}
            </span>
          )}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {state.status === "loading" &&
            Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}

          {state.status === "error" && (
            <div className="col-span-full flex flex-col items-center gap-3 rounded-xl border border-border bg-card/50 py-12 text-center text-sm text-muted-foreground">
              <AlertTriangle className="size-5 text-destructive" />
              Instances could not be loaded right now.
              <a
                href={INSTANCES_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                Learn more about instances
              </a>
            </div>
          )}

          {state.status === "ready" && filtered.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
              No instances found for this filter.
            </p>
          )}

          {state.status === "ready" &&
            filtered.map((instance) => <InstanceCard key={instance.url} instance={instance} />)}
        </div>
      </Reveal>
    </section>
  );
}
