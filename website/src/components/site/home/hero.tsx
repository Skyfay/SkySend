import Link from "next/link";
import { ArrowRight, ChevronRight, Code, File, Folder, KeyRound, SquareTerminal, type LucideIcon } from "lucide-react";
import { ContributorsPill } from "@/components/site/home/contributors-pill";
import { Lens } from "@/components/site/home/lens";
import { Counters, CryptoMarquee } from "@/components/site/home/hero-strips";
import { CONIC, DotGrid, Floor, Glow, Stars } from "@/components/site/fx";
import { CHANGELOG_URL } from "@/lib/content";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/i18n/translate";

// The rolling word in the headline. The first entry comes again at the end,
// so the loop back to the top cannot be seen.
const TICKER: { label: MessageKey; icon: LucideIcon; tone: string }[] = [
  { label: "hero.tickerFiles", icon: File, tone: "green" },
  { label: "hero.tickerPasswords", icon: KeyRound, tone: "amber" },
  { label: "hero.tickerSshKeys", icon: SquareTerminal, tone: "cyan" },
  { label: "hero.tickerCode", icon: Code, tone: "violet" },
  { label: "hero.tickerFolders", icon: Folder, tone: "blue" },
];

// The box takes the width of the longest word, so every language fits.
function Ticker({ t }: { t: Translator }) {
  return (
    <span className="box-content inline-flex h-[1.158em] overflow-hidden rounded-[0.29em] border border-foreground/15 bg-surface-2/70 text-left shadow-[inset_0_1px_0_var(--highlight),0_20px_50px_-20px_rgb(23_163_122/0.6)]">
      <span className="fx-ticker flex w-max flex-col self-start">
        {[...TICKER, TICKER[0]].map((item, i) => (
          <span
            key={i}
            aria-hidden={i > 0 ? "true" : undefined}
            className="flex h-[1.5714em] shrink-0 items-center gap-[0.29em] pr-[0.36em] pl-[0.25em] text-[0.737em] whitespace-nowrap"
          >
            <span
              className="flex size-[1em] shrink-0 items-center justify-center rounded-[0.25em]"
              style={{
                background: `color-mix(in srgb, var(--tone-${item.tone}) 16%, transparent)`,
                color: `var(--tone-${item.tone})`,
                boxShadow: `0 0 24px color-mix(in srgb, var(--tone-${item.tone}) 35%, transparent)`,
              }}
            >
              <item.icon className="size-[0.5em]" strokeWidth={2.2} />
            </span>
            {t(item.label)}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Hero({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <section aria-label={t("hero.intro")} className="relative overflow-hidden pb-24">
      <Glow color="#17a37a" opacity={0.24} drift={1} className="top-[120px] left-[4%] size-[560px]" />
      <Glow color="#0e7490" opacity={0.26} drift={2} className="top-[40px] right-[3%] size-[540px]" />
      <Glow
        color="#2563eb"
        opacity={0.14}
        drift={1}
        className="top-[760px] left-[35%] h-[420px] w-[520px]"
        style={{ animationDelay: "-8s" }}
      />
      <DotGrid mask="radial-gradient(ellipse 60% 45% at 50% 22%, #000, transparent 75%)" />
      <div
        aria-hidden="true"
        className="fx-border fx-halo fx-spin-slower pointer-events-none absolute -top-[500px] left-1/2 -ml-[700px] size-[1400px] rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, transparent, rgb(70 200 157 / 0.32), transparent 25%, rgb(34 211 238 / 0.26), transparent 50%, rgb(96 165 250 / 0.2), transparent 75%)",
          filter: "blur(80px)",
          opacity: "calc(0.5 * var(--glow-strength))",
        }}
      />
      <Stars count={30} height={1300} />
      <Floor className="top-[640px] h-[700px]" />

      <div className="relative z-[2] mx-auto flex max-w-[1280px] flex-col items-center gap-[26px] px-6 pt-[124px] text-center sm:pt-[172px]">
        <a
          href={CHANGELOG_URL}
          target="_blank"
          rel="noreferrer"
          className="relative inline-flex max-w-full overflow-hidden rounded-full bg-foreground/10 p-px"
        >
          <span
            aria-hidden="true"
            className="fx-border fx-spin absolute top-1/2 left-1/2 -mt-[230px] -ml-[230px] size-[460px]"
            style={{ background: CONIC.pill }}
          />
          <span className="relative inline-flex h-[30px] min-w-0 items-center gap-2 rounded-full bg-card pr-3 pl-1.5 text-[13px] font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-tone-green/16 px-2 py-0.5 text-xs text-tone-green">
              <span className="relative size-1.5">
                <span className="fx-ping absolute inset-0 rounded-full bg-tone-green" />
                <span className="absolute inset-0 rounded-full bg-tone-green" />
              </span>
              {t("hero.new")}
            </span>
            <span className="truncate sm:hidden">{t("hero.newsShort")}</span>
            <span className="hidden truncate sm:inline">{t("hero.news")}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        </a>

        <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.045em] sm:text-[56px] sm:leading-[1.08] lg:text-[76px]">
          <span className="flex flex-wrap items-center justify-center gap-x-[0.26em] gap-y-2">
            {t("hero.share")} <Ticker t={t} />
          </span>
          <span className="fx-shine mt-1 block">{t("hero.line2")}</span>
        </h1>

        <p className="max-w-[660px] text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t("hero.lead")}
        </p>

        <div className="flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
          <Link
            href={localePath(locale, "/#start")}
            className="btn-primary flex h-[50px] items-center justify-center gap-2 rounded-xl px-[22px] text-base font-semibold sm:h-[46px] sm:rounded-[10px] sm:text-[15px] sm:font-medium"
          >
            {t("hero.getStarted")}
            <ArrowRight className="size-4" />
          </Link>
          <ContributorsPill />
        </div>
      </div>

      <Lens />
      <Counters t={t} />
      <CryptoMarquee t={t} />
    </section>
  );
}
