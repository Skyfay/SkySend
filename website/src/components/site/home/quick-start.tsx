"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Copy, Globe } from "lucide-react";
import { Eyebrow } from "@/components/site/fx";
import { useCopy } from "@/components/site/home/hooks";
import { COMPOSE_SNIPPET, DOCKER_RUN_SNIPPET, ENV_VARS_URL, REVERSE_PROXY_URL, S3_URL } from "@/lib/content";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

type Token = { text: string; kind: "key" | "value" | "string" | "punct" };

const KIND: Record<Token["kind"], string> = {
  key: "text-tone-green",
  value: "text-foreground",
  string: "text-tone-amber",
  punct: "text-faint",
};

/** Colors a line of the compose file: keys, quoted strings, list dashes and env assignments. */
function tokenizeYaml(line: string): Token[] {
  const m = line.match(/^(\s*)(- )?(.*)$/);
  if (!m) return [{ text: line, kind: "value" }];
  const [, indent, dash, rest] = m;
  const tokens: Token[] = [{ text: indent, kind: "value" }];
  if (dash) tokens.push({ text: dash, kind: "punct" });
  const key = rest.match(/^([A-Za-z_]+)(:)(\s?)(.*)$/);
  const env = rest.match(/^([A-Z_]+)(=)(.*)$/);
  if (key) {
    tokens.push({ text: key[1], kind: "key" }, { text: key[2] + key[3], kind: "punct" });
    if (key[4]) tokens.push({ text: key[4], kind: key[4].includes(":") || key[4].startsWith('"') ? "string" : "value" });
  } else if (env) {
    tokens.push({ text: env[1], kind: "key" }, { text: env[2], kind: "punct" }, { text: env[3], kind: "string" });
  } else {
    tokens.push({ text: rest, kind: rest.startsWith('"') ? "string" : "value" });
  }
  return tokens;
}

/** Colors a line of the docker run command: flags, values, env assignments and the image. */
function tokenizeShell(line: string): Token[] {
  return line.split(/(\s+)/).map((word): Token => {
    if (word === "\\" || /^-{1,2}[a-z]/.test(word)) return { text: word, kind: "punct" };
    if (/^[A-Z_]+=/.test(word)) return { text: word, kind: "key" };
    if (word.includes("/") && word.includes(":") && !word.startsWith(".")) return { text: word, kind: "string" };
    return { text: word, kind: "value" };
  });
}

const FILES = {
  compose: {
    tab: "docker-compose.yml",
    snippet: COMPOSE_SNIPPET,
    tokenize: tokenizeYaml,
    run: "docker compose up -d",
    result: "Container skysend  Started",
  },
  run: {
    tab: "docker run",
    snippet: DOCKER_RUN_SNIPPET,
    tokenize: tokenizeShell,
    run: "docker ps --filter name=skysend",
    result: "skysend  Up 6 seconds  0.0.0.0:3000->3000/tcp",
  },
};

type FileId = keyof typeof FILES;

const STEPS: { title: MessageKey; text: MessageKey }[] = [
  { title: "start.step1", text: "start.step1Text" },
  { title: "start.step2", text: "start.step2Text" },
  { title: "start.step3", text: "start.step3Text" },
];

const LINKS: { href: string; label: MessageKey }[] = [
  { href: ENV_VARS_URL, label: "start.envVars" },
  { href: REVERSE_PROXY_URL, label: "start.reverseProxy" },
  { href: S3_URL, label: "start.s3" },
];

const RING = "border-tone-green/55 shadow-[0_0_0_3px_color-mix(in_srgb,var(--tone-green)_10%,transparent)]";

export function QuickStart() {
  const { t } = useI18n();
  const [file, setFile] = useState<FileId>("compose");
  const [step, setStep] = useState(1);
  const { copied, copy } = useCopy();
  const current = FILES[file];

  return (
    <section id="start" className="mx-auto flex max-w-[1248px] flex-col gap-10 px-4 pt-28 sm:px-6 sm:pt-[140px]">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <Eyebrow>{t("start.eyebrow")}</Eyebrow>
        <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">
          {t.rich("start.title", { shine: (c) => <span className="fx-shine">{c}</span> })}
        </h2>
        <p className="max-w-[600px] text-base leading-relaxed text-muted-foreground">{t("start.lead")}</p>
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-[4fr_7fr]">
        <div className="flex flex-col gap-2.5">
          {STEPS.map((s, i) => {
            const on = step === i;
            return (
              <button
                key={s.title}
                type="button"
                aria-pressed={on}
                onClick={() => setStep(i)}
                className={cn(
                  "flex w-full items-start gap-3.5 rounded-2xl border p-[18px] text-left transition-colors",
                  on ? "panel border-input" : "border-border hover:bg-foreground/[0.02]"
                )}
              >
                <span
                  className={cn(
                    "flex size-[30px] shrink-0 items-center justify-center rounded-full font-semibold transition-colors",
                    on ? "bg-primary text-primary-foreground" : "bg-accent text-subtle"
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-base font-semibold">{t(s.title)}</span>
                  <span className="leading-[1.55] text-muted-foreground">{t(s.text)}</span>
                </span>
              </button>
            );
          })}
          <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1.5 px-1 pt-1 text-[13px] text-muted-foreground">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 transition-colors hover:text-foreground"
              >
                {t(l.label)}
                <ArrowUpRight className="size-3" />
              </a>
            ))}
          </div>
        </div>

        <div className="dark flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-border bg-[#0c0d0e] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_40px_80px_-30px_rgb(0_0_0/0.9)]">
          <div className="flex h-11 items-center gap-1.5 border-b border-border bg-card pr-2 pl-3.5">
            {(Object.keys(FILES) as FileId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={file === id}
                onClick={() => setFile(id)}
                className={cn(
                  "h-[30px] rounded-[7px] px-3 font-mono text-xs transition-colors",
                  file === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {FILES[id].tab}
              </button>
            ))}
            <button
              type="button"
              onClick={() => copy(file, current.snippet)}
              className={cn(
                "ml-auto flex h-[30px] items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-medium transition-colors",
                copied === file ? "bg-tone-green/16 text-tone-green" : "bg-accent text-subtle"
              )}
            >
              {copied === file ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied === file ? t("start.copied") : t("start.copy")}
            </button>
          </div>

          <div
            className={cn(
              "m-3 min-h-[312px] grow overflow-x-auto rounded-xl border border-transparent py-3.5 pr-4 font-mono text-[13px] leading-[1.7] transition-[border-color,box-shadow]",
              step === 0 && RING
            )}
          >
            {current.snippet.split("\n").map((line, i) => (
              <div key={`${file}-${i}`} className="flex min-h-[22px]">
                <span aria-hidden="true" className="w-[34px] shrink-0 pr-4 text-right text-fainter select-none">
                  {i + 1}
                </span>
                <span className="whitespace-pre">
                  {current.tokenize(line).map((tok, j) => (
                    <span key={j} className={KIND[tok.kind]}>
                      {tok.text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>

          <div
            className={cn(
              "mx-3 overflow-x-auto rounded-xl border border-border bg-[#08090a] px-4 py-3 font-mono text-[13px] leading-[1.7] whitespace-nowrap transition-[border-color,box-shadow]",
              step === 1 && RING
            )}
          >
            <div>
              <span className="text-tone-green select-none">$ </span>
              {current.run}
            </div>
            <div className="flex items-center gap-2 text-subtle">
              <Check className="size-3.5 shrink-0 text-tone-green" strokeWidth={2.4} />
              {current.result}
            </div>
          </div>

          <div
            className={cn(
              "m-3 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[13px] text-subtle transition-[border-color,box-shadow]",
              step === 2 && RING
            )}
          >
            <Globe className="size-3.5" />
            {t("start.open")}
            <span className="font-mono text-foreground">http://localhost:3000</span>
            <span className="text-muted-foreground sm:ml-auto">{t("start.httpsFirst")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
