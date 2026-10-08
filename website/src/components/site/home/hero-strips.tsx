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
import type { MessageKey, Translator } from "@/i18n/translate";

const COUNTERS: { value: string; unit?: MessageKey; label: MessageKey }[] = [
  { value: "256", unit: "counters.bitsUnit", label: "counters.bits" },
  { value: "0", label: "counters.accounts" },
  { value: "13", label: "counters.languages" },
  { value: "1", label: "counters.container" },
];

export function Counters({ t }: { t: Translator }) {
  return (
    <div className="relative z-[2] mx-auto mt-10 max-w-[1248px] px-4 sm:mt-[72px] sm:px-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        {COUNTERS.map((c) => (
          <div key={c.label} className="flex flex-col-reverse bg-card px-4 py-4 text-left sm:px-6 sm:py-[22px]">
            <dt className="mt-0.5 text-[13px] leading-snug text-muted-foreground sm:text-sm">{t(c.label)}</dt>
            <dd className="text-[30px] font-semibold tracking-[-0.03em] tabular-nums sm:text-[40px]">
              {c.value}
              {c.unit && <span className="text-sm font-normal text-faint sm:text-base">{t(c.unit)}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// A name is a product name and stays as it is, a key is translated.
type Chip = [string | { key: MessageKey }, LucideIcon];

const CRYPTO: Chip[] = [
  ["AES-256-GCM", Lock],
  ["HKDF-SHA256", KeyRound],
  ["HMAC-SHA256", ShieldCheck],
  [{ key: "marquee.argon" }, Lock],
  ["HPKE, RFC 9180", KeyRound],
  [{ key: "marquee.keyPairs" }, KeyRound],
  [{ key: "marquee.records" }, Box],
  ["Web Crypto API", ShieldCheck],
  [{ key: "marquee.fragment" }, Link2],
  [{ key: "marquee.zeroKnowledge" }, ShieldCheck],
];

const PLATFORMS: Chip[] = [
  [{ key: "marquee.dockerAmd" }, Box],
  [{ key: "marquee.dockerArm" }, Box],
  [{ key: "marquee.localDisk" }, HardDrive],
  [{ key: "marquee.anyS3" }, Cloud],
  ["AWS S3", Cloud],
  ["Cloudflare R2", Cloud],
  ["MinIO", Cloud],
  [{ key: "marquee.oidc" }, UserRound],
  [{ key: "marquee.installable" }, Smartphone],
  [{ key: "marquee.cliLinux" }, SquareTerminal],
  [{ key: "marquee.cliMac" }, SquareTerminal],
  [{ key: "marquee.cliWindows" }, SquareTerminal],
  [{ key: "marquee.languages" }, Globe],
];

function Row({ items, reverse, accent, t }: { items: Chip[]; reverse?: boolean; accent?: boolean; t: Translator }) {
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
          {typeof name === "string" ? name : t(name.key)}
        </span>
      ))}
    </div>
  );
}

/** The primitives and the platforms, as two belts running in opposite directions. */
export function CryptoMarquee({ t }: { t: Translator }) {
  return (
    <div
      className="relative z-[2] mt-10 flex flex-col gap-3 overflow-hidden sm:mt-14"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)",
      }}
    >
      <Row items={CRYPTO} accent t={t} />
      <Row items={PLATFORMS} reverse t={t} />
    </div>
  );
}
