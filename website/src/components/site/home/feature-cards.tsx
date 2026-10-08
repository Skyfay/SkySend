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

const BLOCKS: { id: BlockId; label: string; sub: string; title: string; icon: LucideIcon; tone: string }[] = [
  { id: "text", label: "Text", sub: "Plain or Markdown", title: "Message", icon: Type, tone: "blue" },
  { id: "password", label: "Password", sub: "With a generator", title: "Server access", icon: KeyRound, tone: "amber" },
  { id: "code", label: "Code", sub: "With highlighting", title: "nginx.conf", icon: Code, tone: "violet" },
  { id: "ssh", label: "SSH key", sub: "Paste or generate", title: "Deploy key", icon: SquareTerminal, tone: "cyan" },
];

function BlockBody({ id }: { id: BlockId }) {
  const [shown, setShown] = useState(false);
  if (id === "text") {
    return (
      <p className="leading-normal text-subtle">
        Here is the access to the staging box. This note deletes itself once you have read it.
      </p>
    );
  }
  if (id === "password") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="w-[76px] text-xs text-muted-foreground">Username</span>
          deploy
        </div>
        <div className="flex items-center gap-2.5">
          <span className="w-[76px] text-xs text-muted-foreground">Password</span>
          <span className="font-mono text-[13px]">{shown ? "K7#mq2-vLp9!xR" : "••••••••••••••"}</span>
          <button
            type="button"
            aria-label={shown ? "Hide the password" : "Show the password"}
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
  const [picked, setPicked] = useState<BlockId[]>(["text", "password", "code"]);

  function toggle(id: BlockId) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((b) => b !== id) : [...cur, id]));
  }

  return (
    <SpotlightCard className={cn("flex flex-col gap-5 rounded-[22px] p-5 sm:p-7", className)}>
      <CardHead
        large
        title="Notes made of blocks"
        text="Text, passwords, code and SSH keys in one note, in any order. Whoever opens it gets a copy button on every block."
      />
      <div className="relative grid min-h-0 grow gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted-foreground">Click to add or remove</span>
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
                    <span className="font-semibold">{b.label}</span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">{b.sub}</span>
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
            <span className="font-semibold">Access for Mara</span>
            <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full bg-tone-amber/14 px-2.5 text-xs font-medium text-tone-amber">
              <Flame className="size-3" />
              Burn after reading
            </span>
          </div>
          {picked.length === 0 && (
            <div className="flex grow items-center justify-center rounded-xl border border-dashed border-input text-faint">
              Add a block to start the note.
            </div>
          )}
          {picked.map((id) => {
            const b = BLOCKS.find((x) => x.id === id)!;
            return (
              <div key={id} className="fx-in flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="size-2 rounded-[3px]" style={{ background: `var(--tone-${b.tone})` }} />
                  {b.title}
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

const ARRIVALS: { name: string; size: string; icon: LucideIcon; tone: string }[] = [
  { name: "contract-signed.pdf", size: "2.1 MB", icon: File, tone: "blue" },
  { name: "Wi-Fi access", size: "Note with 3 fields", icon: NotebookText, tone: "amber" },
  { name: "id-front.jpg", size: "840 KB", icon: ImageIcon, tone: "violet" },
];

export function RequestsCard({ className }: { className?: string }) {
  const [count, setCount] = useState(1);
  const arrived = ARRIVALS.slice(0, count).reverse();
  const full = count >= ARRIVALS.length;

  return (
    <SpotlightCard rgb="34 211 238" className={cn("flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]", className)}>
      <div className="relative flex items-center gap-2.5">
        <IconTile icon={Inbox} tone="cyan" />
        <span className="inline-flex h-6 items-center rounded-full bg-tone-green/16 px-2.5 text-xs font-medium text-tone-green">
          New in 3.0
        </span>
      </div>
      <CardHead
        large
        title="File and note requests"
        text="Hand someone an upload link. What they send is encrypted for you alone, and the server cannot open the inbox."
      />
      <div className="relative flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-3">
        <span className="font-semibold">Signed contract and ID</span>
        <span className="text-xs text-muted-foreground">Open for 3 days · up to 5 sends</span>
        <span className="truncate font-mono text-xs text-subtle">
          ch.skysend.app/request/Hx2k9PqL<span className="text-tone-green">#BKz8…</span>
        </span>
      </div>
      <div className="relative flex items-center gap-2">
        <span className="font-semibold">Inbox</span>
        {count > 0 && (
          <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-tone-green/16 px-[7px] text-xs font-medium text-tone-green tabular-nums">
            <span className="size-1.5 rounded-full bg-tone-green" />
            {count} new
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" />
          Only you can open these
        </span>
      </div>
      <div aria-live="polite" className="relative flex min-h-[164px] grow flex-col gap-1.5">
        {count === 0 && (
          <div className="flex h-[52px] items-center justify-center rounded-[10px] border border-dashed border-input text-faint">
            Nothing arrived yet
          </div>
        )}
        {arrived.map((a, i) => (
          <div key={a.name} className="fx-in flex h-[50px] items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 pr-3 pl-2">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: tint(a.tone, 14), color: `var(--tone-${a.tone})` }}
            >
              <a.icon className="size-[15px]" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">
                {a.size} · {i === 0 ? "just now" : `${i * 4} min ago`}
              </span>
            </span>
            {i === 0 && <span className="ml-auto size-[7px] shrink-0 rounded-full bg-tone-green shadow-[0_0_8px_var(--tone-green)]" />}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setCount(full ? 0 : count + 1)}
        className="btn-chip relative flex h-[42px] items-center justify-center gap-2 rounded-[10px] font-medium"
      >
        {full ? <RotateCcw className="size-[15px]" /> : <Upload className="size-[15px]" />}
        {full ? "Empty the inbox" : "Send one as someone else"}
      </button>
      <span className="relative text-xs text-faint">HPKE (RFC 9180) with P-256 and AES-256-GCM</span>
    </SpotlightCard>
  );
}

// Shares that delete themselves.

const EXPIRY = ["1 hour", "1 day", "7 days", "30 days"];
const DOWNLOADS = [1, 5, 20, 0];

export function ExpiryCard({ className }: { className?: string }) {
  const [exp, setExp] = useState(2);
  const [dl, setDl] = useState(1);
  const limit = DOWNLOADS[dl];
  const slots = limit === 0 ? 24 : limit;
  const sentence =
    limit === 0
      ? `This share is deleted in ${EXPIRY[exp]}.`
      : limit === 1
        ? `This share is deleted in ${EXPIRY[exp]} or right after the first download.`
        : `This share is deleted in ${EXPIRY[exp]} or after ${limit} downloads, whichever comes first.`;

  return (
    <SpotlightCard rgb="251 191 36" className={cn("flex flex-col gap-6 rounded-[22px] p-5 sm:p-[26px] lg:flex-row", className)}>
      <div className="relative flex shrink-0 flex-col gap-2 lg:w-[300px]">
        <IconTile icon={Clock} tone="amber" className="mb-2" />
        <CardHead
          large
          title="Shares that delete themselves"
          text="An expiry time and a download limit on every share. Whichever runs out first, the ciphertext is gone."
        />
      </div>
      <div className="relative flex min-w-0 grow flex-col justify-center gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap gap-2 text-[13px] font-medium">
          <button
            type="button"
            onClick={() => setExp((exp + 1) % EXPIRY.length)}
            className="btn-chip flex h-[34px] items-center gap-1.5 rounded-full px-3"
          >
            <Clock className="size-3.5 text-muted-foreground" />
            Expires in {EXPIRY[exp]}
          </button>
          <button
            type="button"
            onClick={() => setDl((dl + 1) % DOWNLOADS.length)}
            className="btn-chip flex h-[34px] items-center gap-1.5 rounded-full px-3"
          >
            <Download className="size-3.5 text-muted-foreground" />
            {limit === 0 ? "No download limit" : limit === 1 ? "1 download" : `${limit} downloads`}
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
  const [shown, setShown] = useState(false);
  return (
    <SpotlightCard rgb="167 139 250" className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={Lock} tone="violet" />
      <CardHead title="A password on top" text="Optional and derived with Argon2id. The link alone then opens nothing." />
      <div className="relative mt-auto flex flex-col gap-2">
        <div className="flex h-[42px] items-center gap-2 rounded-[10px] border border-input bg-surface pr-1.5 pl-3">
          <span className="grow font-mono text-[13px]">{shown ? "sunflower-orbit-42" : "••••••••••••••••••"}</span>
          <button
            type="button"
            aria-label={shown ? "Hide the password" : "Show the password"}
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
          <span className="ml-2 text-xs font-medium text-tone-green">Strong</span>
        </div>
      </div>
    </SpotlightCard>
  );
}

const STORES = [
  { id: "fs", label: "Local disk", path: "/uploads/aB3kQ9xZ.bin", note: "A folder on the host, mounted into the container." },
  { id: "s3", label: "S3 bucket", path: "s3://my-bucket/aB3kQ9xZ.bin", note: "AWS S3, Cloudflare R2, MinIO or any S3-compatible store." },
];

export function StorageCard() {
  const [store, setStore] = useState("fs");
  const current = STORES.find((s) => s.id === store) ?? STORES[0];
  return (
    <SpotlightCard rgb="96 165 250" className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={HardDrive} tone="blue" />
      <CardHead title="Your disk, or any S3" text="Either way, the storage only ever holds ciphertext." />
      <div className="relative mt-auto flex flex-col gap-2.5">
        <div role="radiogroup" aria-label="Storage" className="flex h-10 rounded-[11px] border border-border bg-surface p-[3px]">
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
                {s.label}
              </button>
            );
          })}
        </div>
        <div key={current.id} className="fx-in flex flex-col gap-1">
          <span className="truncate font-mono text-[13px] text-tone-green">{current.path}</span>
          <span className="text-xs text-muted-foreground">{current.note}</span>
        </div>
      </div>
    </SpotlightCard>
  );
}

const SWITCHES = ["Sign in to share files and notes", "Sign in to create requests"];

export function AccountsCard() {
  const [on, setOn] = useState([false, true]);
  return (
    <SpotlightCard className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={UsersRound} tone="green" />
      <CardHead title="No accounts" text="My Links lives in your browser. An optional OIDC sign-in decides who may share." />
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
            <span>{label}</span>
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
  const [theme, setTheme] = useState("graphite");
  return (
    <SpotlightCard rgb="240 85 90" className="flex flex-col gap-3.5 rounded-[22px] p-5 sm:p-[26px]">
      <IconTile icon={Languages} tone="red" />
      <CardHead
        title="Three themes, 13 languages"
        text="Graphite, Aurora and Midnight, each light and dark, plus your own accent color."
      />
      <div className="relative mt-auto grid grid-cols-3 gap-2">
        {THEMES.map((t) => {
          const on = t.id === theme;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex flex-col gap-[7px] rounded-xl border px-1.5 pt-1.5 pb-2 transition-colors",
                on ? "border-tone-green/60 shadow-[0_0_0_3px_color-mix(in_srgb,var(--tone-green)_12%,transparent)]" : "border-border"
              )}
            >
              <span className={cn("flex h-[58px] items-end rounded-lg p-2", t.page)}>
                <span className={cn("flex w-full flex-col gap-[5px] rounded-md p-1.5", t.card)}>
                  <span className="h-1 w-3/5 rounded-sm bg-white/30" />
                  <span className="h-2 w-full rounded-[3px] bg-[#46c89d]" />
                </span>
              </span>
              <span className="text-xs font-medium">{t.label}</span>
            </button>
          );
        })}
      </div>
    </SpotlightCard>
  );
}
