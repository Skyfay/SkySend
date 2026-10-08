"use client";

import { useState } from "react";
import {
  Check,
  Clock,
  Code,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  Flame,
  HardDrive,
  ImageIcon,
  Inbox,
  KeyRound,
  Languages,
  Lock,
  NotebookText,
  Plus,
  RotateCcw,
  SquareTerminal,
  Type,
  Upload,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

function tint(tone: string, pct: number) {
  return `color-mix(in srgb, var(--tone-${tone}) ${pct}%, transparent)`;
}

function IconTile({ icon: Icon, tone, className }: { icon: LucideIcon; tone: string; className?: string }) {
  return (
    <span
      className={cn("relative flex size-11 shrink-0 items-center justify-center rounded-xl", className)}
      style={{ background: tint(tone, 14), color: `var(--tone-${tone})` }}
    >
      <Icon className="size-5" />
    </span>
  );
}

function CardHead({ title, text, large }: { title: string; text: string; large?: boolean }) {
  return (
    <div className="relative flex flex-col gap-1.5">
      <h3 className={cn("font-semibold tracking-[-0.02em]", large ? "text-xl" : "text-lg")}>{title}</h3>
      <p className="leading-[1.55] text-muted-foreground">{text}</p>
    </div>
  );
}

// Notes made of blocks.

type BlockId = "text" | "password" | "code" | "ssh";

// The code block is titled with its filename, which stays the same in every language.
const BLOCKS: { id: BlockId; label: MessageKey; sub: MessageKey; title: MessageKey | null; icon: LucideIcon; tone: string }[] = [
  { id: "text", label: "features.blockText", sub: "features.blockTextSub", title: "features.blockTextTitle", icon: Type, tone: "blue" },
  { id: "password", label: "features.blockPassword", sub: "features.blockPasswordSub", title: "features.blockPasswordTitle", icon: KeyRound, tone: "amber" },
  { id: "code", label: "features.blockCode", sub: "features.blockCodeSub", title: null, icon: Code, tone: "violet" },
  { id: "ssh", label: "features.blockSsh", sub: "features.blockSshSub", title: "features.blockSshTitle", icon: SquareTerminal, tone: "cyan" },
];

function BlockBody({ id }: { id: BlockId }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  if (id === "text") {
    return <p className="leading-normal text-subtle">{t("features.noteMessage")}</p>;
  }
  if (id === "password") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="w-[76px] text-xs text-muted-foreground">{t("features.username")}</span>
          deploy
        </div>
        <div className="flex items-center gap-2.5">
          <span className="w-[76px] text-xs text-muted-foreground">{t("features.password")}</span>
          <span className="font-mono text-[13px]">{shown ? "K7#mq2-vLp9!xR" : "••••••••••••••"}</span>
          <button
            type="button"
            aria-label={shown ? t("features.hidePassword") : t("features.showPassword")}
            onClick={() => setShown(!shown)}
            className="ml-auto flex size-7 items-center justify-center rounded-md bg-accent text-subtle"
          >
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </div>
    );
  }
  if (id === "code") {
    return (
      <pre className="font-mono text-[12.5px] leading-relaxed text-subtle">
        <span className="text-tone-violet">server</span> {"{\n  "}
        <span className="text-tone-violet">listen</span> <span className="text-tone-amber">443 ssl</span>
        {";\n  "}
        <span className="text-tone-violet">server_name</span> <span className="text-tone-amber">staging.example.com</span>
        {";\n}"}
      </pre>
    );
  }
  return (
    <div className="flex flex-col gap-1 font-mono text-[12.5px]">
      <span className="truncate text-subtle">ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOq3mVZf8kT2pLr9xW4nB7cQe1hJ6sYd0uGa deploy@staging</span>
      <span className="truncate text-faint">SHA256:4kq9Xw2mR7tLp0Zc8vB1nH6yJ3sQe5aFgUd7tKiVo5c</span>
    </div>
  );
}

export function BlocksCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<BlockId[]>(["text", "password", "code"]);

  function toggle(id: BlockId) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((b) => b !== id) : [...cur, id]));
  }

  return (
    <SpotlightCard className={cn("flex flex-col gap-5 rounded-[22px] p-5 sm:p-7", className)}>
      <CardHead
        large
        title={t("features.blocksTitle")}
        text={t("features.blocksText")}
      />
      <div className="relative grid min-h-0 grow gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted-foreground">{t("features.blocksPick")}</span>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {BLOCKS.map((b) => {
              const on = picked.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(b.id)}
                  className="flex h-[60px] items-center gap-3 rounded-xl border pr-3 pl-2.5 text-left transition-colors"
                  style={{
                    borderColor: on ? tint(b.tone, 40) : "var(--border)",
                    background: on ? `linear-gradient(90deg, ${tint(b.tone, 14)}, ${tint(b.tone, 3)})` : "transparent",
                  }}
                >
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
                    style={{ background: tint(b.tone, 14), color: `var(--tone-${b.tone})` }}
                  >
                    <b.icon className="size-[17px]" />
                  </span>
                  <span className="flex min-w-0 grow flex-col">
                    <span className="font-semibold">{t(b.label)}</span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">{t(b.sub)}</span>
                  </span>
                  <span
                    className={cn(
                      "hidden size-[22px] shrink-0 items-center justify-center rounded-full sm:flex",
                      on ? "text-tone-ink" : "border border-input text-muted-foreground"
                    )}
                    style={on ? { background: `var(--tone-${b.tone})` } : undefined}
                  >
                    {on ? <Check className="size-3" strokeWidth={3} /> : <Plus className="size-3" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex min-h-[280px] flex-col gap-2.5 overflow-hidden rounded-2xl border border-border bg-surface p-3.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{t("features.noteTitle")}</span>
            <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full bg-tone-amber/14 px-2.5 text-xs font-medium text-tone-amber">
              <Flame className="size-3" />
              {t("features.burn")}
            </span>
          </div>
          {picked.length === 0 && (
            <div className="flex grow items-center justify-center rounded-xl border border-dashed border-input text-faint">
              {t("features.noteEmpty")}
            </div>
          )}
          {picked.map((id) => {
            const b = BLOCKS.find((x) => x.id === id)!;
            return (
              <div key={id} className="fx-in flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="size-2 rounded-[3px]" style={{ background: `var(--tone-${b.tone})` }} />
                  {b.title ? t(b.title) : "nginx.conf"}
                  <Copy className="ml-auto size-3.5 text-faint" />
                </div>
                <BlockBody id={id} />
              </div>
            );
          })}
        </div>
      </div>
    </SpotlightCard>
  );
}

// File and note requests.

// A file keeps its name and shows its size, a note gets a translated name and a line about its fields.
type Arrival = { id: string; icon: LucideIcon; tone: string } & (
  | { file: string; bytes: number }
  | { note: MessageKey; detail: MessageKey }
);

const ARRIVALS: Arrival[] = [
  { id: "contract", file: "contract-signed.pdf", bytes: 2.1 * 1024 ** 2, icon: File, tone: "blue" },
  { id: "wifi", note: "features.wifiAccess", detail: "features.noteFields", icon: NotebookText, tone: "amber" },
  { id: "id", file: "id-front.jpg", bytes: 840 * 1024, icon: ImageIcon, tone: "violet" },
];

export function RequestsCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const [count, setCount] = useState(1);
  const arrived = ARRIVALS.slice(0, count).reverse();
  const full = count >= ARRIVALS.length;

  return (
    <SpotlightCard rgb="34 211 238" className={cn("flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]", className)}>
      <div className="relative flex items-center gap-2.5">
        <IconTile icon={Inbox} tone="cyan" />
        <span className="inline-flex h-6 items-center rounded-full bg-tone-green/16 px-2.5 text-xs font-medium text-tone-green">
          {t("features.requestsNew")}
        </span>
      </div>
      <CardHead large title={t("features.requestsTitle")} text={t("features.requestsText")} />
      <div className="relative flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-3">
        <span className="font-semibold">{t("features.requestName")}</span>
        <span className="text-xs text-muted-foreground">{t("features.requestMeta")}</span>
        <span className="truncate font-mono text-xs text-subtle">
          ch.skysend.app/request/Hx2k9PqL<span className="text-tone-green">#BKz8…</span>
        </span>
      </div>
      <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{t("features.inbox")}</span>
        {count > 0 && (
          <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-tone-green/16 px-[7px] text-xs font-medium whitespace-nowrap text-tone-green tabular-nums">
            <span className="size-1.5 rounded-full bg-tone-green" />
            {t("features.inboxNew", { count })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
          <Lock className="size-3" />
          {t("features.onlyYou")}
        </span>
      </div>
      <div aria-live="polite" className="relative flex grow flex-col gap-1.5">
        {arrived.map((a, i) => (
          <div key={a.id} className="fx-in flex h-[50px] items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 pr-3 pl-2">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: tint(a.tone, 14), color: `var(--tone-${a.tone})` }}
            >
              <a.icon className="size-[15px]" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{"file" in a ? a.file : t(a.note)}</span>
              <span className="text-xs text-muted-foreground">
                {"file" in a ? formatBytes(a.bytes, t) : t(a.detail)} ·{" "}
                {i === 0 ? t("units.justNow") : t("features.minAgo", { count: i * 4 })}
              </span>
            </span>
            {i === 0 && <span className="ml-auto size-[7px] shrink-0 rounded-full bg-tone-green shadow-[0_0_8px_var(--tone-green)]" />}
          </div>
        ))}
        {/* The slots still open keep their room, so the button below never jumps. */}
        {Array.from({ length: ARRIVALS.length - count }, (_, k) => {
          const empty = count === 0 && k === 0;
          return (
            <div
              key={`slot-${k}`}
              aria-hidden={empty ? undefined : true}
              className="flex h-[50px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-input text-faint"
            >
              {empty && t("features.nothingArrived")}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setCount(full ? 0 : count + 1)}
        className="btn-chip relative flex h-[42px] items-center justify-center gap-2 rounded-[10px] font-medium"
      >
        {full ? <RotateCcw className="size-[15px]" /> : <Upload className="size-[15px]" />}
        {full ? t("features.emptyInbox") : t("features.sendOne")}
      </button>
      <span className="relative text-xs text-faint">{t("features.hpke")}</span>
    </SpotlightCard>
  );
}

// Shares that delete themselves.

// The `in` forms of the units, since German puts a time after "in" in the dative.
const EXPIRY = [
  { unit: "units.inHours", count: 1 },
  { unit: "units.inDays", count: 1 },
  { unit: "units.inDays", count: 7 },
  { unit: "units.inDays", count: 30 },
] as const;
const DOWNLOADS = [1, 5, 20, 0];

export function ExpiryCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const [exp, setExp] = useState(2);
  const [dl, setDl] = useState(1);
  const limit = DOWNLOADS[dl];
  const slots = limit === 0 ? 24 : limit;
  const time = t(EXPIRY[exp].unit, { count: EXPIRY[exp].count });
  const sentence =
    limit === 0
      ? t("features.deletedNoLimit", { time })
      : limit === 1
        ? t("features.deletedFirst", { time })
        : t("features.deletedAfter", { time, count: limit });

  return (
    <SpotlightCard rgb="251 191 36" className={cn("flex flex-col gap-6 rounded-[22px] p-5 sm:p-[26px] lg:flex-row", className)}>
      <div className="relative flex shrink-0 flex-col gap-2 lg:w-[300px]">
        <IconTile icon={Clock} tone="amber" className="mb-2" />
        <CardHead large title={t("features.expiryTitle")} text={t("features.expiryText")} />
      </div>
      <div className="relative flex min-w-0 grow flex-col justify-center gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap gap-2 text-[13px] font-medium">
          <button
            type="button"
            onClick={() => setExp((exp + 1) % EXPIRY.length)}
            className="btn-chip flex h-[34px] items-center gap-1.5 rounded-full px-3"
          >
            <Clock className="size-3.5 text-muted-foreground" />
            {t("features.expiresIn", { time })}
          </button>
          <button
            type="button"
            onClick={() => setDl((dl + 1) % DOWNLOADS.length)}
            className="btn-chip flex h-[34px] items-center gap-1.5 rounded-full px-3"
          >
            <Download className="size-3.5 text-muted-foreground" />
            {limit === 0 ? t("features.noDownloadLimit") : t("features.downloads", { count: limit })}
          </button>
        </div>
        <div aria-hidden="true" className="flex h-2.5 gap-1">
          {Array.from({ length: slots }, (_, k) => (
            <span
              key={k}
              className={cn(
                "grow rounded-[3px]",
                limit === 0 ? "bg-tone-green/18" : k === 0 ? "bg-tone-green" : "bg-border"
              )}
            />
          ))}
        </div>
        <p aria-live="polite" className="text-[15px] leading-normal">
          {sentence}
        </p>
      </div>
    </SpotlightCard>
  );
}

// The smaller cards.

export function PasswordCard() {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <SpotlightCard rgb="167 139 250" className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={Lock} tone="violet" />
      <CardHead title={t("features.passwordTitle")} text={t("features.passwordText")} />
      <div className="relative mt-auto flex flex-col gap-2">
        <div className="flex h-[42px] items-center gap-2 rounded-[10px] border border-input bg-surface pr-1.5 pl-3">
          <span className="grow font-mono text-[13px]">{shown ? "sunflower-orbit-42" : "••••••••••••••••••"}</span>
          <button
            type="button"
            aria-label={shown ? t("features.hidePassword") : t("features.showPassword")}
            onClick={() => setShown(!shown)}
            className="flex size-[30px] items-center justify-center rounded-[7px] bg-accent text-subtle"
          >
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-1 grow rounded-full bg-tone-green" />
          ))}
          <span className="ml-2 text-xs font-medium text-tone-green">{t("features.strong")}</span>
        </div>
      </div>
    </SpotlightCard>
  );
}

const STORES: { id: string; label: MessageKey; path: string; note: MessageKey }[] = [
  { id: "fs", label: "features.storageFs", path: "/uploads/aB3kQ9xZ.bin", note: "features.storageFsNote" },
  { id: "s3", label: "features.storageS3", path: "s3://my-bucket/aB3kQ9xZ.bin", note: "features.storageS3Note" },
];

export function StorageCard() {
  const { t } = useI18n();
  const [store, setStore] = useState("fs");
  const current = STORES.find((s) => s.id === store) ?? STORES[0];
  return (
    <SpotlightCard rgb="96 165 250" className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={HardDrive} tone="blue" />
      <CardHead title={t("features.storageTitle")} text={t("features.storageText")} />
      <div className="relative mt-auto flex flex-col gap-2.5">
        <div role="radiogroup" aria-label={t("features.storage")} className="flex h-10 rounded-[11px] border border-border bg-surface p-[3px]">
          {STORES.map((s) => {
            const on = s.id === store;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setStore(s.id)}
                className={cn(
                  "grow rounded-lg text-[13px] font-medium transition-colors",
                  on ? "bg-card text-foreground shadow-[var(--chip-shadow)] dark:bg-accent" : "text-muted-foreground"
                )}
              >
                {t(s.label)}
              </button>
            );
          })}
        </div>
        <div key={current.id} className="fx-in flex flex-col gap-1">
          <span className="truncate font-mono text-[13px] text-tone-green">{current.path}</span>
          <span className="text-xs text-muted-foreground">{t(current.note)}</span>
        </div>
      </div>
    </SpotlightCard>
  );
}

const SWITCHES: MessageKey[] = ["features.signInShare", "features.signInRequests"];

export function AccountsCard() {
  const { t } = useI18n();
  const [on, setOn] = useState([false, true]);
  return (
    <SpotlightCard className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={UsersRound} tone="green" />
      <CardHead title={t("features.accountsTitle")} text={t("features.accountsText")} />
      <div className="relative mt-auto flex flex-col rounded-xl border border-border text-[13px]">
        {SWITCHES.map((label, i) => (
          <button
            key={label}
            type="button"
            role="switch"
            aria-checked={on[i]}
            onClick={() => setOn((prev) => prev.map((v, j) => (j === i ? !v : v)))}
            className="flex w-full items-center justify-between gap-2.5 p-3 text-left [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
          >
            <span>{t(label)}</span>
            <span className={cn("relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-200", on[i] ? "bg-tone-green" : "bg-input")}>
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full transition-[left] duration-200",
                  on[i] ? "left-4 bg-tone-ink" : "left-0.5 bg-card dark:bg-muted-foreground"
                )}
              />
            </span>
          </button>
        ))}
      </div>
    </SpotlightCard>
  );
}

const THEMES = [
  {
    id: "graphite",
    label: "Graphite",
    page: "bg-[#101012] bg-[radial-gradient(rgb(242_242_243/0.12)_1px,transparent_1.5px)] bg-[length:8px_8px]",
    card: "border border-[#2a2a2e] bg-[linear-gradient(180deg,#222225,#1b1b1e)]",
  },
  {
    id: "aurora",
    label: "Aurora",
    page: "bg-[#0b0d0f] bg-[radial-gradient(70%_60%_at_15%_0%,rgb(70_200_157/0.45),transparent_70%)]",
    card: "border border-white/12 bg-white/7",
  },
  { id: "midnight", label: "Midnight", page: "bg-black", card: "border border-[#1f1f1f] bg-[#0a0a0a]" },
];

export function ThemesCard() {
  const { t } = useI18n();
  const [theme, setTheme] = useState("graphite");
  return (
    <SpotlightCard rgb="240 85 90" className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={Languages} tone="red" />
      <CardHead title={t("features.themesTitle")} text={t("features.themesText")} />
      <div className="relative mt-auto grid grid-cols-3 gap-2">
        {THEMES.map((th) => {
          const on = th.id === theme;
          return (
            <button
              key={th.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTheme(th.id)}
              className={cn(
                "flex flex-col gap-[7px] rounded-xl border px-1.5 pt-1.5 pb-2 transition-colors",
                on ? "border-tone-green/60 shadow-[0_0_0_3px_color-mix(in_srgb,var(--tone-green)_12%,transparent)]" : "border-border"
              )}
            >
              <span className={cn("flex h-[58px] items-end rounded-lg p-2", th.page)}>
                <span className={cn("flex w-full flex-col gap-[5px] rounded-md p-1.5", th.card)}>
                  <span className="h-1 w-3/5 rounded-sm bg-white/30" />
                  <span className="h-2 w-full rounded-[3px] bg-[#46c89d]" />
                </span>
              </span>
              <span className="text-xs font-medium">{th.label}</span>
            </button>
          );
        })}
      </div>
    </SpotlightCard>
  );
}
