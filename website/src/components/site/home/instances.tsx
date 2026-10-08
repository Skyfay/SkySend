"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ChevronRight, Flag, Plus, RotateCcw } from "lucide-react";
import { Eyebrow, Glow } from "@/components/site/fx";
import { fetchWithCache } from "@/lib/github";
import { formatBytes, formatCount, formatDuration, formatWindow, plural } from "@/lib/format";
import { CountryFlag } from "@/components/site/country-flag";
import { INSTANCES_API_URL, isOfficialInstance, parseInstancesResponse, type Instance } from "@/lib/instances";
import { INSTANCES_DOCS_URL } from "@/lib/content";
import { cn } from "@/lib/utils";

const CACHE_KEY = "skysend-instances";
const CACHE_TTL_MS = 5 * 60 * 1000;
/** How often the instances worker checks every instance, set by its cron. */
const CHECK_EVERY = "every 30 minutes";

type State =
  | { status: "loading" }
  | { status: "ready"; instances: Instance[]; lastUpdated: string | null }
  | { status: "error" };

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

/** The limits of an instance as the table and the cards show them. */
function limitsOf(inst: Instance) {
  const quota = inst.fileUploadQuotaBytes === 0 ? "No limit" : formatBytes(inst.fileUploadQuotaBytes);
  const quotaWindow =
    inst.fileUploadQuotaBytes && inst.fileUploadQuotaWindow ? formatWindow(inst.fileUploadQuotaWindow) : "";
  const noteParts = [formatDuration(inst.noteMaxExpiry), inst.noteMaxViews === null ? null : `${formatCount(inst.noteMaxViews)} views`]
    .filter((p) => p && p !== "-")
    .join(", ");
  return {
    maxSize: formatBytes(inst.fileMaxSize),
    perUpload: inst.fileMaxFilesPerUpload ? `${formatCount(inst.fileMaxFilesPerUpload)} files per upload` : "",
    expiry: formatDuration(inst.fileMaxExpiry),
    downloads: formatCount(inst.fileMaxDownloads),
    quota: inst.fileUploadQuotaBytes === null ? "-" : quota,
    quotaWindow,
    noteSize: formatBytes(inst.noteMaxSize),
    noteMeta: noteParts,
  };
}

function Kind({ official }: { official: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-[7px] text-[11px] font-medium",
        official ? "bg-tone-green/16 text-tone-green" : "bg-accent text-subtle"
      )}
    >
      {official ? "Official" : "Community"}
    </span>
  );
}

function Status({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1.5 rounded-full px-[9px] text-xs font-medium",
        online ? "bg-tone-green/14 text-tone-green" : "bg-tone-red/14 text-tone-red"
      )}
    >
      <span className="relative size-[7px]">
        {online && <span className="fx-ping absolute inset-0 rounded-full bg-tone-green" />}
        <span className={cn("absolute inset-0 rounded-full", online ? "bg-tone-green" : "bg-tone-red")} />
      </span>
      {online ? "Online" : "Offline"}
    </span>
  );
}

const COLUMNS =
  "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.25fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_88px] items-center gap-3";

function Value({ online, main, sub }: { online: boolean; main: string; sub?: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-[3px]">
      <span className={cn("text-[15px] font-medium tabular-nums", online ? "text-foreground" : "text-fainter")}>{main}</span>
      {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
    </span>
  );
}

function TableRow({ inst }: { inst: Instance }) {
  const l = limitsOf(inst);
  const official = isOfficialInstance(inst.url);
  return (
    <div className={cn(COLUMNS, "h-20 border-b border-border px-5")}>
      <span className="flex min-w-0 items-center gap-3">
        <CountryFlag country={inst.country} emoji={inst.flag} />
        <span className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-semibold">{inst.name}</span>
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            {inst.country}
            <Kind official={official} />
          </span>
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <Status online={inst.online} />
        <span className="truncate text-xs text-muted-foreground">
          {inst.online ? (inst.version ? `v${inst.version}` : "") : "No answer at the last check"}
        </span>
      </span>
      <Value online={inst.online} main={l.maxSize} sub={l.perUpload} />
      <Value online={inst.online} main={l.expiry} />
      <Value online={inst.online} main={l.downloads} />
      <Value online={inst.online} main={l.quota} sub={l.quotaWindow} />
      <Value online={inst.online} main={l.noteSize} sub={l.noteMeta} />
      <a
        href={inst.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${inst.name}`}
        className={cn("btn-chip flex h-[34px] items-center gap-1.5 justify-self-end rounded-lg px-3 font-medium", !inst.online && "opacity-50")}
      >
        Open
        <ArrowUpRight className="size-3" />
      </a>
    </div>
  );
}

function InstanceCard({ inst }: { inst: Instance }) {
  const l = limitsOf(inst);
  const stats = [
    [l.maxSize, "Max file size"],
    [l.expiry, "Kept up to"],
    [l.downloads, "Downloads"],
    [l.quota, l.quotaWindow ? `Upload quota ${l.quotaWindow}` : "Upload quota"],
  ];
  return (
    <div className="panel flex flex-col gap-3.5 rounded-[18px] p-4">
      <div className="flex items-center gap-3">
        <CountryFlag country={inst.country} emoji={inst.flag} size={40} />
        <span className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-semibold">{inst.name}</span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {inst.country}
            <Kind official={isOfficialInstance(inst.url)} />
          </span>
        </span>
        <span className="ml-auto shrink-0">
          <Status online={inst.online} />
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {stats.map(([value, label]) => (
          <div key={label} className="flex flex-col-reverse gap-0.5 bg-surface px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={cn("text-base font-semibold tabular-nums", !inst.online && "text-fainter")}>{value}</dd>
          </div>
        ))}
      </dl>
      <span className="text-[13px] leading-normal text-muted-foreground">
        {inst.online
          ? `Notes up to ${l.noteSize}${l.noteMeta ? `, ${l.noteMeta}` : ""}${inst.version ? ` · v${inst.version}` : ""}`
          : "No answer at the last check"}
      </span>
      <a
        href={inst.url}
        target="_blank"
        rel="noreferrer"
        className="btn-chip flex h-11 items-center justify-center gap-1.5 rounded-[11px] font-medium"
      >
        Open {inst.name}
        <ArrowUpRight className="size-3.5" />
      </a>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="panel animate-pulse rounded-[18px] p-5">
      <div className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-[38px] rounded-[10px] bg-muted" />
            <div className="flex flex-col gap-2">
              <div className="h-3.5 w-40 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Instances() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<unknown>(CACHE_KEY, INSTANCES_API_URL, CACHE_TTL_MS)
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseInstancesResponse(raw);
        setState(
          parsed && parsed.instances.length > 0
            ? { status: "ready", instances: parsed.instances, lastUpdated: parsed.lastUpdated }
            : { status: "error" }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Online first, the official one first among those.
  const sorted = useMemo(() => {
    if (state.status !== "ready") return [];
    return [...state.instances].sort(
      (a, b) =>
        Number(b.online) - Number(a.online) ||
        Number(isOfficialInstance(b.url)) - Number(isOfficialInstance(a.url))
    );
  }, [state]);

  const online = sorted.filter((i) => i.online).length;

  return (
    <section id="instances" className="mx-auto flex max-w-[1248px] flex-col gap-10 px-4 pt-28 sm:px-6 sm:pt-[140px]">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <Eyebrow>Public instances</Eyebrow>
        <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">
          No server? Share on a public one.
        </h2>
        <p className="max-w-[640px] text-base leading-relaxed text-muted-foreground">
          Run by the community on the same open code, with their status and limits checked {CHECK_EVERY}. The key
          never reaches them either.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {state.status === "loading" && <Skeleton />}

        {state.status === "error" && (
          <div className="panel flex flex-col items-center gap-3 rounded-[18px] px-6 py-12 text-center text-muted-foreground">
            <AlertTriangle className="size-5 text-tone-red" />
            The list of instances could not be loaded right now.
            <a
              href={INSTANCES_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              See the instances in the docs
            </a>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[13px] text-muted-foreground lg:hidden">
              <span
                className={cn(
                  "size-2 rounded-full",
                  online === sorted.length ? "bg-tone-green shadow-[0_0_8px_var(--tone-green)]" : "bg-tone-amber"
                )}
              />
              <span className="font-medium text-foreground">
                {online === sorted.length ? `All ${sorted.length} online` : `${online} of ${sorted.length} online`}
              </span>
              {state.lastUpdated && <span>· checked {relativeTime(state.lastUpdated)}</span>}
            </div>

            <div className="panel hidden overflow-hidden rounded-[18px] lg:block">
              <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    online === sorted.length ? "bg-tone-green shadow-[0_0_8px_var(--tone-green)]" : "bg-tone-amber shadow-[0_0_8px_var(--tone-amber)]"
                  )}
                />
                <span className="font-semibold">
                  {online === sorted.length
                    ? `All ${sorted.length} instances online`
                    : `${online} of ${sorted.length} instances online`}
                </span>
                {state.lastUpdated && (
                  <span className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <RotateCcw className="size-[13px]" />
                    Checked {relativeTime(state.lastUpdated)}, {CHECK_EVERY}
                  </span>
                )}
              </div>
              <div className={cn(COLUMNS, "h-10 border-b border-border px-5 text-xs text-muted-foreground")}>
                <span>Instance</span>
                <span>Status</span>
                <span>Max file size</span>
                <span>Kept up to</span>
                <span>Downloads</span>
                <span>Upload quota</span>
                <span>Notes</span>
                <span />
              </div>
              {sorted.map((inst) => (
                <TableRow key={inst.url} inst={inst} />
              ))}
              <a
                href={INSTANCES_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="flex h-[60px] items-center gap-3 px-5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="flex size-[38px] items-center justify-center rounded-[10px] border border-dashed border-input">
                  <Plus className="size-3.5" />
                </span>
                Run your own instance and add it to the list
                <ChevronRight className="ml-auto size-3.5" />
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {sorted.map((inst) => (
                <InstanceCard key={inst.url} inst={inst} />
              ))}
              <a
                href={INSTANCES_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[52px] items-center gap-2.5 rounded-[14px] border border-dashed border-input px-3.5 text-muted-foreground sm:col-span-2"
              >
                <Plus className="size-[15px]" />
                Add your own instance to the list
              </a>
            </div>
          </>
        )}

        <div className="panel relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[18px] px-5 py-[18px]">
          <Glow color="#f0555a" opacity={0.1} blur={60} className="-top-20 -left-16 h-[180px] w-[220px]" />
          <span className="relative flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-tone-red/14 text-tone-red">
            <Flag className="size-[19px]" />
          </span>
          <span className="relative flex min-w-[220px] grow basis-0 flex-col gap-[3px]">
            <span className="text-base font-semibold">Found something that should not be there?</span>
            <span className="text-muted-foreground">
              Report a link to the instance that hosts it. The report goes to its abuse contact, who can delete the share.
            </span>
          </span>
          <Link href="/report" className="btn-chip relative flex h-10 shrink-0 items-center rounded-[10px] px-4 font-medium">
            Report a link
          </Link>
        </div>
      </div>
    </section>
  );
}
