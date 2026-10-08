"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import Image from "next/image";
import {
  ChevronsLeftRight,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  Folder,
  Link2,
  Lock,
  QrCode,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Type,
  X,
  ArrowRight,
} from "lucide-react";
import { CONIC, SpinBorder } from "@/components/site/fx";
import { useTick } from "@/components/site/home/hooks";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import { INTL_LOCALE } from "@/i18n/config";
import type { MessageKey } from "@/i18n/translate";

const HEX = "0123456789abcdef";

/** Ciphertext that changes with every tick, so the server side looks alive. */
function hexAt(seed: number, length: number) {
  let cs = seed;
  let out = "";
  for (let i = 0; i < length; i++) {
    cs = (cs * 1103515245 + 12345) % 2147483648;
    out += HEX[cs % 16];
    if (i % 4 === 3 && i < length - 1) out += " ";
  }
  return out;
}

const LINK_BASE = "https://ch.skysend.app/file/aB3kQ9xZ";
const LINK_SECRET = "#Zk3vT0qL8mWc2HxR9bN4yJ6sPa1eFgUd7tKiVo5nC3w";

const FILES = [
  { name: "q3-board-pack.pdf", size: 12.4, icon: File, tone: "blue" },
  { name: "contract-signed.pdf", size: 2.1, icon: File, tone: "blue" },
  { name: "site-photos", size: 169.8, note: "lens.folderFiles", icon: Folder, tone: "amber" },
] as const;

const LINK_FACTS: { icon: typeof Clock; text: MessageKey }[] = [
  { icon: Clock, text: "lens.expiresOn" },
  { icon: Download, text: "lens.downloadsUsed" },
  { icon: Lock, text: "lens.passwordElsewhere" },
];

// Where the two cards sit in the window from lg on, in percent of its width,
// so the layout of the canvas holds at every desktop width.
const LEFT_CARD = "lg:absolute lg:top-[92px] lg:left-[4.7%] lg:h-[404px] lg:w-[51%]";
const RIGHT_CARD = "lg:absolute lg:top-[92px] lg:left-[57.6%] lg:h-[404px] lg:w-[37.7%]";

function Tile({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-lg"
      style={{
        background: `color-mix(in srgb, var(--tone-${tone}) 14%, transparent)`,
        color: `var(--tone-${tone})`,
      }}
    >
      {children}
    </span>
  );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
        className
      )}
    >
      {children}
    </span>
  );
}

/** The share page of the app, the way the person sharing sees it. */
function YouLayer() {
  const { t, locale } = useI18n();
  const mb = (n: number) => `${new Intl.NumberFormat(INTL_LOCALE[locale]).format(n)} MB`;
  return (
    <div className="relative flex flex-col gap-3 bg-background bg-dot-grid p-3 sm:p-5 lg:block lg:h-full lg:p-0">
      <div className="absolute top-5 left-1/2 -ml-[280px] hidden h-[52px] w-[560px] items-center gap-3.5 rounded-[14px] border border-[var(--header-border)] bg-[var(--header-bg)] pr-2 pl-3.5 shadow-[inset_0_1px_0_var(--highlight)] lg:flex">
        <span className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="" width={22} height={22} />
          SkySend
        </span>
        <span className="ml-2.5 flex gap-0.5 text-[13px] font-medium text-muted-foreground">
          <span className="flex h-8 items-center rounded-lg bg-accent px-3 text-foreground shadow-[var(--chip-shadow)]">
            {t("lens.tabShare")}
          </span>
          <span className="flex h-8 items-center px-3">{t("lens.tabRequest")}</span>
          <span className="flex h-8 items-center gap-1.5 px-3">
            {t("lens.tabMyLinks")}
            <span className="size-1.5 rounded-full bg-tone-green" />
          </span>
        </span>
        <SlidersHorizontal className="mr-2 ml-auto size-4 text-muted-foreground" />
      </div>

      <div className={cn("panel flex flex-col gap-3.5 rounded-2xl p-4 shadow-[var(--lift-shadow)] sm:p-5", LEFT_CARD)}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex h-9 rounded-[10px] border border-border bg-surface p-[3px] text-[13px] font-medium">
            <span className="flex items-center gap-1.5 rounded-[7px] bg-accent px-3.5 shadow-[var(--chip-shadow)]">
              <File className="size-3.5" />
              {t("lens.file")}
            </span>
            <span className="flex items-center gap-1.5 px-3.5 text-muted-foreground">
              <Type className="size-3.5" />
              {t("lens.note")}
            </span>
          </span>
          <span className="text-[13px] text-muted-foreground">{t("lens.items")}</span>
        </div>
        <div className="rounded-xl border border-border bg-surface">
          {FILES.map((f, i) => (
            <div
              key={f.name}
              className={cn("flex h-[52px] items-center gap-3 pr-3.5 pl-2.5", i < FILES.length - 1 && "border-b border-border")}
            >
              <Tile tone={f.tone}>
                <f.icon className="size-4" />
              </Tile>
              <span className="min-w-0 truncate font-medium">{f.name}</span>
              {"note" in f && <span className="hidden text-muted-foreground sm:inline">{t(f.note)}</span>}
              <span className="ml-auto text-muted-foreground tabular-nums">{mb(f.size)}</span>
              <X className="size-3.5 shrink-0 text-faint" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill className="btn-chip">
            <Clock className="size-3.5 text-muted-foreground" />
            {t("lens.days7")}
          </Pill>
          <Pill className="btn-chip">
            <Download className="size-3.5 text-muted-foreground" />
            {t("lens.downloads5")}
          </Pill>
          <Pill className="border-tone-green/50 bg-tone-green/16 text-tone-green">
            <Lock className="size-3.5" />
            {t("lens.password")}
          </Pill>
        </div>
        <p className="text-[13px] text-muted-foreground">{t("lens.deletedSentence")}</p>
        <span className="btn-primary mt-auto flex h-11 items-center justify-center gap-2 rounded-[10px] font-semibold">
          {t("lens.shareItems")}
          <ArrowRight className="size-4" />
        </span>
      </div>

      <div className={cn("panel flex flex-col gap-3.5 rounded-2xl p-4 shadow-[var(--lift-shadow)] sm:p-5", RIGHT_CARD)}>
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-tone-green/16 text-tone-green">
            <Check className="size-[18px]" strokeWidth={2.4} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-semibold">{t("lens.linkReady")}</span>
            <span className="text-[13px] text-muted-foreground">{t("lens.encryptedHere")}</span>
          </span>
        </div>
        <div className="rounded-xl border border-border bg-surface px-3.5 py-3 font-mono text-[13px] leading-[1.65] break-all">
          <span>{LINK_BASE}</span>
          <span className="text-tone-green">{LINK_SECRET}</span>
        </div>
        <div className="flex gap-2">
          <span className="btn-primary flex h-10 grow items-center justify-center gap-2 rounded-[10px] font-semibold">
            <Copy className="size-[15px]" />
            {t("lens.copyLink")}
          </span>
          <span className="btn-chip flex size-10 items-center justify-center rounded-[10px] text-subtle">
            <QrCode className="size-4" />
          </span>
        </div>
        <div className="hidden flex-col text-[13px] text-subtle sm:flex">
          {LINK_FACTS.map((fact) => (
            <div key={fact.text} className="flex h-9 items-center gap-2.5 border-t border-border">
              <fact.icon className="size-[15px] text-muted-foreground" />
              {t(fact.text)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The same share, as the server stores it. It stays dark in both themes. Its
 * ciphertext ticks only while it is on screen, hidden behind the other tab it
 * stands still.
 */
function ServerLayer() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTick(220, ref, 0);
  const dashed = "border border-dashed border-tone-green/35 bg-[#0e1010]/92";
  return (
    <div ref={ref} className="dark relative flex flex-col gap-3 bg-[#0b0c0c] bg-[radial-gradient(rgb(70_200_157/0.13)_1px,transparent_1.5px)] bg-[length:22px_22px] p-3 text-[#f2f2f3] sm:p-5 lg:block lg:h-full lg:p-0">
      <div className="absolute top-5 left-1/2 -ml-[280px] hidden h-[52px] w-[560px] items-center gap-3 rounded-[14px] border border-dashed border-tone-green/40 bg-[#0e1010]/90 pr-4 pl-2.5 lg:flex">
        <span className="flex size-8 items-center justify-center rounded-lg bg-tone-green/14 text-tone-green">
          <Server className="size-4" />
        </span>
        <span className="font-mono text-[13px]">uploads/aB3kQ9xZ.bin</span>
        <span className="ml-auto text-[13px] text-[#9c9ca4]">{t("lens.ciphertext")}</span>
      </div>

      <div className={cn("flex flex-col gap-3.5 rounded-2xl p-4 sm:p-5", dashed, LEFT_CARD)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex h-9 items-center gap-2 rounded-[10px] bg-tone-green/10 px-3.5 text-[13px] font-medium text-tone-green">
            <Lock className="size-3.5" />
            {t("lens.oneBlob")}
          </span>
          <span className="text-[13px] text-[#9c9ca4]">{t("lens.noPerFile")}</span>
        </div>
        <div className="rounded-xl border border-tone-green/18 bg-[#0b0c0c]">
          <div className="flex h-[52px] items-center gap-3 border-b border-tone-green/14 px-3.5">
            <span className="w-[70px] shrink-0 text-[13px] text-[#9c9ca4]">{t("lens.blob")}</span>
            <span className="truncate font-mono text-[13px]">aB3kQ9xZ.bin</span>
            <span className="ml-auto text-[#9c9ca4] tabular-nums">184.3 MB</span>
          </div>
          <div className="flex h-[52px] items-center gap-3 border-b border-tone-green/14 px-3.5">
            <span className="w-[70px] shrink-0 text-[13px] text-[#9c9ca4]">{t("lens.metadata")}</span>
            <span className="overflow-hidden font-mono text-[13px] whitespace-nowrap text-tone-green">{hexAt(tick * 7 + 3, 44)}</span>
          </div>
          <div className="flex h-[52px] items-center gap-3 px-3.5">
            <span className="w-[70px] shrink-0 text-[13px] text-[#9c9ca4]">{t("lens.nonce")}</span>
            <span className="overflow-hidden font-mono text-[13px] whitespace-nowrap text-tone-green">{hexAt(tick * 13 + 5, 24)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[#c8c8cd]">
          <Pill className="border-dashed border-[#36363b]">{t("lens.deleteAfter")}</Pill>
          <Pill className="border-dashed border-[#36363b]">{t("lens.downloadsAtMost")}</Pill>
          <Pill className="border-dashed border-[#36363b]">{t("lens.passwordCheck")}</Pill>
        </div>
        <p className="text-[13px] text-[#9c9ca4]">{t("lens.limitsKnown")}</p>
        <span className="mt-auto flex h-11 items-center justify-center gap-2 rounded-[10px] border border-dashed border-tone-green/35 bg-[repeating-linear-gradient(135deg,rgb(70_200_157/0.05)_0_8px,transparent_8px_16px)] font-medium text-[#9c9ca4]">
          <EyeOff className="size-4" />
          {t("lens.notHere")}
        </span>
      </div>

      <div className={cn("flex flex-col gap-3.5 rounded-2xl p-4 sm:p-5", dashed, RIGHT_CARD)}>
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-tone-green/10 text-tone-green">
            <Link2 className="size-[18px]" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-semibold">{t("lens.givesAway")}</span>
            <span className="text-[13px] text-[#9c9ca4]">{t("lens.beforeHash")}</span>
          </span>
        </div>
        <div className="rounded-xl border border-tone-green/18 bg-[#0b0c0c] px-3.5 py-3 font-mono text-[13px] leading-[1.65]">
          <div className="break-all">{LINK_BASE}</div>
          <div className="flex items-center gap-2">
            <span className="text-[#9c9ca4]">#</span>
            <span className="h-3 grow rounded-[3px] bg-[repeating-linear-gradient(135deg,#2a2a2e_0_6px,#1b1b1e_6px_12px)]" />
            <span className="font-sans text-xs text-tone-green">{t("lens.neverSent")}</span>
          </div>
        </div>
        <div className="flex flex-col text-[13px]">
          {(
            [
              ["authToken", "hT9xLq2…Qa2w", "lens.authTokenNote"],
              ["ownerToken", "Qe4mZr8…v8Kd", "lens.ownerTokenNote"],
            ] as const
          ).map(([name, value, note]) => (
            <div key={name} className="flex h-11 items-center gap-2.5 border-t border-tone-green/14">
              <span className="w-24 shrink-0 font-mono text-[#c8c8cd]">{name}</span>
              <span className="hidden font-mono text-[#9c9ca4] sm:inline">{value}</span>
              <span className="ml-auto text-right text-[#9c9ca4]">{t(note)}</span>
            </div>
          ))}
          <div className="flex h-11 items-center gap-2.5 border-t border-tone-green/14">
            <span className="text-[#c8c8cd]">{t("lens.secretKeys")}</span>
            <span className="ml-auto flex items-center gap-1.5 font-medium text-tone-green">
              <ShieldCheck className="size-3.5" />
              {t("lens.neverServer")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const VIEWS = [
  { id: "you", label: "lens.you", icon: Eye },
  { id: "server", label: "lens.server", icon: Server },
] as const;

/**
 * The window of the hero: the app with a share ready, and over it a lens that
 * shows the same share the way the server stores it. From lg on the cut sweeps
 * on its own and follows the mouse, below lg two tabs switch the view.
 */
export function Lens() {
  // The split lives in a CSS variable written straight to the window, so the
  // mouse never re-renders the layers. State only knows whether the mouse is in.
  const { t } = useI18n();
  const [manual, setManual] = useState(false);
  const [view, setView] = useState<"you" | "server">("you");

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0) return;
    const pct = Math.max(3, Math.min(97, ((e.clientX - r.left) / r.width) * 100));
    e.currentTarget.style.setProperty("--lens-split", `${pct.toFixed(2)}%`);
    setManual(true);
  }

  function onLeave(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.style.removeProperty("--lens-split");
    setManual(false);
  }

  return (
    <div className="relative z-[2] mx-auto mt-14 max-w-[1248px] px-4 sm:mt-[72px] sm:px-6">
      <SpinBorder
        conic={CONIC.hero}
        size={1700}
        radius={22}
        className="bg-foreground/10 shadow-[var(--hero-shadow),var(--deep-shadow)]"
        innerClassName="overflow-hidden bg-surface"
      >
        <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-card px-4">
          <span aria-hidden="true" className="flex gap-[7px]">
            <span className="size-[11px] rounded-full bg-input" />
            <span className="size-[11px] rounded-full bg-input" />
            <span className="size-[11px] rounded-full bg-input" />
          </span>
          <span className="flex h-7 w-[min(380px,52vw)] items-center justify-center gap-2 rounded-lg border border-border bg-surface text-[13px] text-muted-foreground">
            <Lock className="size-3" />
            ch.skysend.app
          </span>
          <span className="hidden items-center justify-self-end gap-1.5 text-xs text-faint lg:flex [@media(hover:none)]:hidden">
            <ChevronsLeftRight className="size-3.5" />
            {t("lens.hint")}
          </span>
        </div>

        <div role="group" aria-label={t("lens.pointOfView")} className="flex gap-1 border-b border-border bg-card p-2 lg:hidden">
          {VIEWS.map((v) => {
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                onClick={() => setView(v.id)}
                className={cn(
                  "flex h-10 grow items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-medium transition-colors",
                  on
                    ? v.id === "server"
                      ? "bg-tone-green/16 text-tone-green"
                      : "bg-accent text-foreground shadow-[var(--chip-shadow)]"
                    : "text-muted-foreground"
                )}
              >
                <v.icon className="size-3.5" />
                {t(v.label)}
              </button>
            );
          })}
        </div>

        <div
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          className={cn("relative text-left lg:h-[528px] lg:cursor-ew-resize lg:overflow-hidden", !manual && "lens-auto")}
          style={{ touchAction: "pan-y" }}
        >
          <div className={cn("lg:absolute lg:inset-0", view === "server" && "hidden lg:block")}>
            <YouLayer />
          </div>
          <div className={cn("lens-clip lg:absolute lg:inset-0 lg:z-[2] lg:overflow-hidden", view === "you" && "hidden lg:block")}>
            <div className="lens-clip-inner lg:absolute lg:inset-0">
              <ServerLayer />
            </div>
          </div>

          <div aria-hidden="true" className="lens-handle pointer-events-none absolute inset-0 z-[3] hidden lg:block">
            <span className="absolute inset-y-0 left-0 -ml-px w-0.5 bg-[#46c89d] shadow-[0_0_18px_rgb(70_200_157/0.8)]" />
            <span className="absolute top-1/2 left-0 -mt-5 -ml-5 flex size-10 items-center justify-center rounded-full border border-[#46c89d]/60 bg-[#1e1e21] text-[#46c89d] shadow-[0_10px_24px_-8px_rgb(0_0_0/0.8),0_0_0_4px_rgb(70_200_157/0.12)]">
              <ChevronsLeftRight className="size-[18px]" />
            </span>
          </div>

          <span className="absolute top-7 left-4 z-[4] hidden h-7 items-center gap-1.5 rounded-full border border-border bg-background/85 px-2.5 text-xs font-medium text-subtle lg:flex">
            <Eye className="size-[13px]" />
            {t("lens.you")}
          </span>
          <span className="absolute top-7 right-4 z-[4] hidden h-7 items-center gap-1.5 rounded-full border border-[#46c89d]/45 bg-[#0b0c0c]/90 px-2.5 text-xs font-medium text-[#46c89d] lg:flex">
            <Server className="size-[13px]" />
            {t("lens.server")}
          </span>
        </div>
      </SpinBorder>
    </div>
  );
}
