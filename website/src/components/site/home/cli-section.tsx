"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Eyebrow } from "@/components/site/fx";
import { useCopy, useTick } from "@/components/site/home/hooks";
import { CLI_URL, INSTALL_COMMANDS } from "@/lib/content";
import { cn } from "@/lib/utils";

const COMMAND = "skysend upload ./q3-board-pack.pdf -e 7d -d 5";
const URL_BASE = "https://ch.skysend.app/file/aB3kQ9xZ";
const URL_SECRET = "#Zk3vT0qL8mWc2HxR9bN4yJ6sPa1eFgUd7tKiVo5nC3w";
/** Ticks of one round of the terminal. The last one shows it finished. */
const ROUND = 70;

type Part = { text: string; tone: "prompt" | "text" | "muted" | "bar" | "rest" | "secret" };

const TONE: Record<Part["tone"], string> = {
  prompt: "text-tone-green",
  text: "text-foreground",
  muted: "text-muted-foreground",
  bar: "text-tone-green",
  rest: "text-input",
  secret: "text-tone-green",
};

/** The lines of the terminal at step `t` of a round: the command typed, the upload, the link. */
function linesAt(t: number): { parts: Part[]; cursor?: boolean }[] {
  const lines: { parts: Part[]; cursor?: boolean }[] = [
    { parts: [{ text: "$ ", tone: "prompt" }, { text: COMMAND.slice(0, t * 4), tone: "text" }], cursor: t < 12 },
  ];
  if (t >= 13 && t < 33) {
    const pct = Math.min(100, ((t - 13) / 19) * 100);
    const fill = Math.round((pct / 100) * 30);
    const loaded = (12.4 * pct) / 100;
    lines.push({
      parts: [
        { text: "Uploading ", tone: "muted" },
        { text: "█".repeat(fill), tone: "bar" },
        { text: "░".repeat(30 - fill), tone: "rest" },
        { text: ` ${pct.toFixed(1)}% ${loaded >= 10 ? loaded.toFixed(1) : loaded.toFixed(2)} MB/12.4 MB 41.8 MB/s`, tone: "muted" },
      ],
    });
  }
  if (t >= 33) lines.push({ parts: [{ text: "Upload complete.", tone: "text" }] });
  if (t >= 35) {
    lines.push({ parts: [] });
    lines.push({
      parts: [
        { text: "Share URL: ", tone: "muted" },
        { text: URL_BASE, tone: "text" },
        { text: URL_SECRET, tone: "secret" },
      ],
    });
    lines.push({
      parts: [{ text: "Files: 1 | Size: 12.4 MB | Expires: 7 days | Downloads: 5 | Avg speed: 41.8 MB/s", tone: "muted" }],
    });
  }
  if (t >= 38) lines.push({ parts: [{ text: "$ ", tone: "prompt" }], cursor: true });
  return lines;
}

const POINTS = [
  "Linux, macOS and Windows, one binary each",
  "A JSON flag on the commands for scripts",
  "Signs in through OIDC when your instance asks",
];

export function CliSection() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTick(200, ref, ROUND - 1);
  const [os, setOs] = useState<(typeof INSTALL_COMMANDS)[number]["id"]>("unix");
  const { copied, copy } = useCopy();
  const install = INSTALL_COMMANDS.find((c) => c.id === os) ?? INSTALL_COMMANDS[0];

  return (
    <section className="mx-auto grid max-w-[1248px] items-center gap-10 px-4 pt-28 sm:px-6 sm:pt-[140px] lg:grid-cols-[5fr_7fr] lg:gap-14">
      <div className="flex min-w-0 flex-col gap-[18px]">
        <Eyebrow>CLI and terminal UI</Eyebrow>
        <h2 className="text-[32px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[46px]">
          Same encryption, from your terminal.
        </h2>
        <p className="text-base leading-relaxed text-muted-foreground">
          Upload, download and write notes from a shell or a script. Run{" "}
          <code className="font-mono text-[14px] text-foreground">skysend</code> without arguments for the
          interactive terminal UI.{" "}
          <a href={CLI_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            Read the CLI guide
          </a>
          .
        </p>
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Platform" className="flex gap-1">
            {INSTALL_COMMANDS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === os}
                onClick={() => setOs(c.id)}
                className={cn(
                  "h-8 rounded-lg px-3 text-[13px] font-medium transition-colors",
                  c.id === os ? "bg-accent text-foreground shadow-[var(--chip-shadow)]" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex h-12 items-center gap-3 rounded-[10px] border border-input bg-surface pr-1.5 pl-4 font-mono text-[13px]">
            <span className="shrink-0 text-tone-green select-none">{install.prompt}</span>
            <span className="min-w-0 grow truncate">{install.command}</span>
            <button
              type="button"
              aria-label={copied === "install" ? "Copied" : "Copy the install command"}
              onClick={() => copy("install", install.command)}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                copied === "install" ? "bg-tone-green/16 text-tone-green" : "bg-accent text-subtle"
              )}
            >
              {copied === "install" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </div>
        <ul className="flex flex-col gap-2.5 text-subtle">
          {POINTS.map((p) => (
            <li key={p} className="flex items-center gap-2.5">
              <Check className="size-4 shrink-0 text-tone-green" strokeWidth={2.2} />
              {p}
            </li>
          ))}
        </ul>
      </div>

      <div
        ref={ref}
        className="dark min-w-0 overflow-hidden rounded-2xl border border-border bg-[#0c0d0e] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_40px_80px_-30px_rgb(0_0_0/0.9),0_40px_100px_-50px_rgb(23_163_122/0.45)]"
      >
        <div className="grid h-10 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-card px-3.5">
          <span aria-hidden="true" className="flex gap-[7px]">
            <span className="size-[11px] rounded-full bg-input" />
            <span className="size-[11px] rounded-full bg-input" />
            <span className="size-[11px] rounded-full bg-input" />
          </span>
          <span className="text-xs text-muted-foreground">Terminal</span>
        </div>
        <div
          aria-label="A terminal uploading a file with the SkySend CLI"
          role="img"
          className="h-[340px] overflow-hidden px-5 py-[18px] font-mono text-[12.5px] leading-[1.75] break-all sm:text-[13px]"
        >
          {linesAt(tick % ROUND).map((line, i) => (
            <div key={i} className="min-h-[22px]">
              {line.parts.map((p, j) => (
                <span key={j} className={TONE[p.tone]}>
                  {p.text}
                </span>
              ))}
              {line.cursor && <span className="fx-blink ml-0.5 inline-block h-4 w-2 bg-tone-green align-[-3px]" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
