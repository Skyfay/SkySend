import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import {
  ArrowRight,
  Clock,
  Code,
  Database,
  EyeOff,
  FileLock2,
  GitBranch,
  KeyRound,
  Laptop,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  UserX,
  Waves,
  type LucideIcon,
} from "lucide-react";
import {
  computeAuthToken,
  deriveKeys,
  encryptNoteContent,
  generateSalt,
  generateSecret,
  randomBytes,
  toBase64url,
} from "@skysend/crypto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Glow } from "@/components/Glow";
import { cn, formatDuration } from "@/lib/utils";

const accentSpan = <span data-slot="accent" className="text-primary-text" />;

function SectionHeading({ title, text }: { title: string; text?: string }) {
  return (
    <div className="mx-auto mb-8 max-w-2xl text-center">
      <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[32px]">{title}</h2>
      {text && <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{text}</p>}
    </div>
  );
}

function IconTile({ icon: Icon, muted = false }: { icon: LucideIcon; muted?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
        muted ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary-text",
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** A line between two flow nodes with a packet running along it. */
function Connector() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-8 w-px overflow-hidden bg-border sm:h-px sm:w-full">
      <span className="absolute left-0 top-0 h-3 w-px animate-[how-packet-y_1.8s_ease-in-out_infinite] bg-primary motion-reduce:hidden sm:h-px sm:w-5 sm:animate-[how-packet-x_1.8s_ease-in-out_infinite]" />
    </div>
  );
}

function Flow() {
  const { t } = useTranslation();
  const node = (icon: LucideIcon, title: string, text: string, muted = false) => (
    <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-chip sm:flex-col sm:gap-3 sm:p-5 sm:text-center">
      <IconTile icon={icon} muted={muted} />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-[13px] text-muted-foreground">{text}</p>
      </div>
    </div>
  );

  return (
    <figure className="relative mx-auto max-w-4xl sm:pt-24">
      {/* The key's path runs over the server, never through it. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[15%] top-3 hidden h-24 sm:block">
        <svg viewBox="0 0 400 90" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <path
            d="M0 88 C 70 -6, 330 -6, 400 88"
            fill="none"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            className="stroke-primary-line"
          />
          <path
            d="M0 88 C 70 -6, 330 -6, 400 88"
            fill="none"
            strokeWidth="2"
            strokeDasharray="6 10"
            vectorEffect="non-scaling-stroke"
            className="animate-[how-dash_1.4s_linear_infinite] stroke-primary motion-reduce:animate-none"
          />
        </svg>
        <span className="absolute left-1/2 top-0 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary-line bg-card px-3 py-1 text-xs font-medium text-primary-text shadow-chip">
          <KeyRound className="h-3.5 w-3.5" />
          {t("how.flowKeyShort")}
        </span>
      </div>

      <div className="grid items-center gap-2 sm:grid-cols-[1fr_4rem_1fr_4rem_1fr] sm:gap-0">
        {node(Laptop, t("how.flowSender"), t("how.flowSenderText"))}
        <Connector />
        {node(Server, t("how.flowServer"), t("how.flowServerText"), true)}
        <Connector />
        {node(Smartphone, t("how.flowRecipient"), t("how.flowRecipientText"))}
      </div>

      <figcaption className="mx-auto mt-6 flex max-w-lg items-start justify-center gap-2 text-center text-sm text-muted-foreground">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" />
        {t("how.flowKey")}
      </figcaption>
    </figure>
  );
}

interface DemoMaterial {
  id: string;
  secret: Uint8Array;
  salt: Uint8Array;
}

interface DemoResult {
  ciphertext: string;
  token: string;
  bytes: number;
}

function newMaterial(): DemoMaterial {
  return { id: toBase64url(randomBytes(6)), secret: generateSecret(), salt: generateSalt() };
}

function DemoOutput({ label, badge, children }: { label: string; badge: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium">{label}</p>
        {badge}
      </div>
      <div className="rounded-xl border border-border bg-card px-3.5 py-3">{children}</div>
    </div>
  );
}

/**
 * Encrypts what the visitor types with the same functions SkySend uses for notes. It runs
 * in the browser only and sends nothing anywhere.
 */
function Demo() {
  const { t } = useTranslation();
  const supported = typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
  const [text, setText] = useState(() => t("how.demoSample"));
  const [material, setMaterial] = useState<DemoMaterial | null>(() => (supported ? newMaterial() : null));
  const [result, setResult] = useState<DemoResult | null>(null);
  const [failed, setFailed] = useState(!supported);

  useEffect(() => {
    if (!material) return;
    let stale = false;
    void (async () => {
      try {
        const { metaKey, authKey } = await deriveKeys(material.secret, material.salt);
        const [{ ciphertext }, token] = await Promise.all([
          encryptNoteContent(text, metaKey),
          computeAuthToken(authKey),
        ]);
        if (!stale) {
          setResult({ ciphertext: toBase64url(ciphertext), token: toBase64url(token), bytes: ciphertext.length });
        }
      } catch {
        if (!stale) setFailed(true);
      }
    })();
    return () => {
      stale = true;
    };
  }, [text, material]);

  return (
    <section>
      <SectionHeading title={t("how.demoTitle")} text={t("how.demoText")} />
      <Card data-emphasis="main" className="mx-auto grid max-w-5xl overflow-hidden lg:grid-cols-2">
        <div className="space-y-3 p-5 sm:p-6">
          <Label htmlFor="how-demo-input" className="text-[13px]">
            {t("how.demoInput")}
          </Label>
          <Textarea
            id="how-demo-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            className="min-h-36 resize-y bg-well"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              {t("how.demoLocal")}
            </p>
            <Button variant="outline" size="sm" onClick={() => setMaterial(newMaterial())} disabled={failed}>
              <RefreshCw />
              {t("how.demoNewKey")}
            </Button>
          </div>
        </div>

        <div className="space-y-4 border-t border-border bg-well p-5 sm:p-6 lg:border-l lg:border-t-0">
          {failed || !material ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0" />
              {t("how.demoUnavailable")}
            </p>
          ) : (
            <>
              <DemoOutput
                label={t("how.demoLink")}
                badge={<Badge variant="accent">{t("how.badgeLinkOnly")}</Badge>}
              >
                <p className="break-all font-mono text-xs leading-relaxed">
                  <span className="text-muted-foreground">
                    {window.location.origin}/note/{material.id}
                  </span>
                  <span className="font-semibold text-primary-text">#{toBase64url(material.secret)}</span>
                </p>
              </DemoOutput>
              <DemoOutput
                label={t("how.demoCiphertext")}
                badge={<Badge>{t("how.badgeSent")}</Badge>}
              >
                <p className="line-clamp-3 break-all font-mono text-xs leading-relaxed text-muted-foreground">
                  {result?.ciphertext}
                </p>
                <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                  {t("how.demoBytes", { count: result?.bytes ?? 0 })}
                </p>
              </DemoOutput>
              <DemoOutput label={t("how.demoToken")} badge={<Badge>{t("how.badgeSent")}</Badge>}>
                <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">{result?.token}</p>
              </DemoOutput>
            </>
          )}
        </div>
      </Card>
    </section>
  );
}

function Steps() {
  const { t } = useTranslation();
  const steps = [
    { icon: KeyRound, title: t("how.step1Title"), text: t("how.step1Text") },
    { icon: FileLock2, title: t("how.step2Title"), text: t("how.step2Text") },
    { icon: Link2, title: t("how.step3Title"), text: t("how.step3Text") },
    { icon: ShieldCheck, title: t("how.step4Title"), text: t("how.step4Text") },
  ];
  return (
    <section>
      <SectionHeading title={t("how.stepsTitle")} />
      <ol className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(({ icon, title, text }, i) => (
          <li key={title}>
            <Card className="h-full space-y-3 p-5">
              <div className="flex items-center justify-between">
                <IconTile icon={icon} />
                <span className="font-mono text-xs font-semibold text-primary-text">0{i + 1}</span>
              </div>
              <p className="font-semibold leading-snug">{title}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Stands in for an encrypted value without pretending to show one. */
function Redacted({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1">
      <i aria-hidden="true" className="h-2 w-10 rounded-full bg-foreground/15" />
      <i aria-hidden="true" className="h-2 w-6 rounded-full bg-foreground/15" />
      <i aria-hidden="true" className="h-2 w-14 rounded-full bg-foreground/15" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ServerRecord() {
  const { t } = useTranslation();
  const encrypted = <Badge variant="accent">{t("how.recordEncrypted")}</Badge>;
  const rows: Array<{ label: string; value: ReactNode; status: ReactNode }> = [
    {
      label: t("how.recordId"),
      value: <code className="font-mono text-xs">k3Xp9aQ2wLm</code>,
      status: <Badge>{t("how.recordVisible")}</Badge>,
    },
    { label: t("how.recordContent"), value: <Redacted label={t("how.recordEncrypted")} />, status: encrypted },
    { label: t("how.recordName"), value: <Redacted label={t("how.recordEncrypted")} />, status: encrypted },
    {
      label: t("how.recordToken"),
      value: <code className="font-mono text-xs text-muted-foreground">Qm9yZW…</code>,
      status: <Badge variant="accent">{t("how.recordDerived")}</Badge>,
    },
    {
      label: t("how.recordExpiry"),
      value: <span className="text-sm">{formatDuration(86_400)}</span>,
      status: <Badge>{t("how.recordVisible")}</Badge>,
    },
    {
      label: t("how.recordKey"),
      value: <span className="font-mono text-xs text-muted-foreground line-through">#secret</span>,
      status: <Badge variant="accent">{t("how.recordNever")}</Badge>,
    },
  ];

  return (
    <section>
      <SectionHeading title={t("how.recordTitle")} text={t("how.recordText")} />
      <Card className="mx-auto max-w-3xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border bg-well px-5 py-3 font-mono text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          uploads / k3Xp9aQ2wLm
        </div>
        <dl className="divide-y divide-border">
          {rows.map(({ label, value, status }) => (
            <div
              key={label}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-5 py-3 sm:grid-cols-[9rem_1fr_auto]"
            >
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1">{value}</dd>
              <dd className="justify-self-end">{status}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}

function Features() {
  const { t } = useTranslation();
  const tile = (icon: LucideIcon, title: string, text: string, extra?: ReactNode, className?: string) => (
    <Card key={title} className={cn("flex flex-col gap-3 p-5", className)}>
      <IconTile icon={icon} />
      <p className="font-semibold">{title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
      {extra}
    </Card>
  );

  return (
    <section>
      <SectionHeading title={t("how.featuresTitle")} />
      <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tile(
          Clock,
          t("how.featureExpiryTitle"),
          t("how.featureExpiryText"),
          <div aria-hidden="true" className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {[3600, 86_400, 604_800].map((sec, i) => (
              <span
                key={sec}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  i === 1 ? "border-primary-line bg-primary-soft text-primary-text" : "border-border text-muted-foreground",
                )}
              >
                {formatDuration(sec)}
              </span>
            ))}
          </div>,
          "sm:col-span-2",
        )}
        {tile(Lock, t("how.featurePasswordTitle"), t("how.featurePasswordText"))}
        {tile(Code, t("how.featureNotesTitle"), t("how.featureNotesText"))}
        {tile(Waves, t("how.featureStreamTitle"), t("how.featureStreamText"))}
        {tile(UserX, t("how.featurePrivacyTitle"), t("how.featurePrivacyText"))}
        {tile(GitBranch, t("how.featureOpenTitle"), t("how.featureOpenText"), undefined, "sm:col-span-2 lg:col-span-3")}
      </div>
    </section>
  );
}

function Specs() {
  const { t } = useTranslation();
  const specs = [
    [t("how.specSecret"), t("how.specSecretValue")],
    [t("how.specKdf"), t("how.specKdfValue")],
    [t("how.specFiles"), t("how.specFilesValue")],
    [t("how.specNotes"), t("how.specNotesValue")],
    [t("how.specAuth"), t("how.specAuthValue")],
    [t("how.specPassword"), t("how.specPasswordValue")],
  ];
  return (
    <section>
      <SectionHeading title={t("how.specsTitle")} text={t("how.specsText")} />
      <Card className="mx-auto max-w-3xl overflow-hidden">
        <dl className="divide-y divide-border">
          {specs.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="font-mono text-[13px] text-muted-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}

function Faq() {
  const { t } = useTranslation();
  const items = [1, 2, 3, 4].map((n) => ({ q: t(`how.faq${n}Q`), a: t(`how.faq${n}A`) }));
  return (
    <section>
      <SectionHeading title={t("how.faqTitle")} />
      <div className="mx-auto max-w-3xl space-y-2">
        {items.map(({ q, a }) => (
          <details key={q} className="group rounded-2xl border border-border bg-card px-5 py-4 open:shadow-chip">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              {q}
              <Plus className="h-4 w-4 shrink-0 text-primary-text transition-transform group-open:rotate-45 motion-reduce:transition-none" />
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function HowItWorksPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-20 pb-6 sm:space-y-28">
      <section className="relative">
        <Glow />
        <div className="relative mx-auto max-w-2xl text-center">
          <Badge variant="accent" className="mb-5">
            <ShieldCheck />
            {t("how.eyebrow")}
          </Badge>
          <h1
            data-slot="hero-title"
            className="text-[34px] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-[48px]"
          >
            <Trans i18nKey="how.title" components={{ a: accentSpan }} />
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground sm:text-base">{t("how.lead")}</p>
        </div>
        <div className="relative mt-12">
          <Flow />
        </div>
      </section>

      <Demo />
      <Steps />
      <ServerRecord />
      <Features />
      <Specs />
      <Faq />

      <section>
        <Card data-emphasis="main" className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 py-12 text-center">
          <h2 className="text-[26px] font-semibold tracking-[-0.03em]">{t("how.ctaTitle")}</h2>
          <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">{t("how.ctaText")}</p>
          <Button asChild size="lg">
            <Link to="/">
              {t("how.ctaButton")}
              <ArrowRight />
            </Link>
          </Button>
        </Card>
      </section>
    </div>
  );
}
