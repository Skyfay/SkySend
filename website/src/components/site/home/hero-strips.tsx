import {
  Box,
  Cloud,
  Globe,
  HardDrive,
  KeyRound,
  Link2,
  Lock,
  ShieldCheck,
  Smartphone,
  SquareTerminal,
  UserRound,
  type LucideIcon,
} from "lucide-react";

const COUNTERS = [
  { value: "256", unit: " bit", label: "AES-GCM keys, made in your browser" },
  { value: "0", unit: "", label: "accounts, trackers or analytics" },
  { value: "13", unit: "", label: "languages, three themes" },
  { value: "1", unit: "", label: "Docker container with SQLite" },
];

export function Counters() {
  return (
    <div className="relative z-[2] mx-auto mt-10 max-w-[1248px] px-4 sm:mt-[72px] sm:px-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        {COUNTERS.map((c) => (
          <div key={c.label} className="flex flex-col-reverse bg-card px-4 py-4 text-left sm:px-6 sm:py-[22px]">
            <dt className="mt-0.5 text-[13px] leading-snug text-muted-foreground sm:text-sm">{c.label}</dt>
            <dd className="text-[30px] font-semibold tracking-[-0.03em] tabular-nums sm:text-[40px]">
              {c.value}
              <span className="text-sm font-normal text-faint sm:text-base">{c.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const CRYPTO: [string, LucideIcon][] = [
  ["AES-256-GCM", Lock],
  ["HKDF-SHA256", KeyRound],
  ["HMAC-SHA256", ShieldCheck],
  ["Argon2id passwords", Lock],
  ["HPKE, RFC 9180", KeyRound],
  ["P-256 key pairs", KeyRound],
  ["64 KB encrypted records", Box],
  ["Web Crypto API", ShieldCheck],
  ["Key in the URL fragment", Link2],
  ["Zero knowledge", ShieldCheck],
];

const PLATFORMS: [string, LucideIcon][] = [
  ["Docker on AMD64", Box],
  ["Docker on ARM64", Box],
  ["Local disk", HardDrive],
  ["Any S3 bucket", Cloud],
  ["AWS S3", Cloud],
  ["Cloudflare R2", Cloud],
  ["MinIO", Cloud],
  ["OIDC sign-in", UserRound],
  ["Installable as an app", Smartphone],
  ["CLI for Linux", SquareTerminal],
  ["CLI for macOS", SquareTerminal],
  ["CLI for Windows", SquareTerminal],
  ["13 languages", Globe],
];

function Row({ items, reverse, accent }: { items: [string, LucideIcon][]; reverse?: boolean; accent?: boolean }) {
  return (
    <div className={reverse ? "fx-marquee-rev flex w-max gap-2.5" : "fx-marquee flex w-max gap-2.5"}>
      {[...items, ...items].map(([name, Icon], i) => (
        <span
          key={i}
          aria-hidden={i >= items.length ? "true" : undefined}
          className="inline-flex h-[42px] items-center gap-2.5 rounded-xl border border-border bg-surface pr-4 pl-[7px] font-medium whitespace-nowrap text-subtle"
        >
          <span
            className={
              accent
                ? "flex size-7 items-center justify-center rounded-lg bg-tone-green/12 text-tone-green"
                : "flex size-7 items-center justify-center rounded-lg bg-muted text-subtle"
            }
          >
            <Icon className="size-3.5" />
          </span>
          {name}
        </span>
      ))}
    </div>
  );
}

/** The primitives and the platforms, as two belts running in opposite directions. */
export function CryptoMarquee() {
  return (
    <div
      className="relative z-[2] mt-10 flex flex-col gap-3 overflow-hidden sm:mt-14"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)",
      }}
    >
      <Row items={CRYPTO} accent />
      <Row items={PLATFORMS} reverse />
    </div>
  );
}
