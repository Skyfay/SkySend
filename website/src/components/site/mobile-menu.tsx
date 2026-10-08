"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronRight, Heart, Menu, Monitor, Moon, Sun, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTheme } from "next-themes";
import { DiscordIcon } from "@/components/site/discord-icon";
import { GithubStarsWidget } from "@/components/site/github-stars-widget";
import { NAV_LINKS, useActiveHref, useNavHref } from "@/components/site/nav-links";
import { LocaleFlag, useLanguageChoice } from "@/components/site/language-switcher";
import { useI18n } from "@/i18n/provider";
import { LOCALES } from "@/i18n/config";
import { DISCORD_URL, SPONSOR_URL } from "@/lib/content";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "nav.themeLight", icon: Sun },
  { value: "dark", label: "nav.themeDark", icon: Moon },
  { value: "system", label: "nav.themeSystem", icon: Monitor },
] as const;

/**
 * The menu below lg: a panel that grows out of the header, with a tinted icon
 * and a line of text for every page, the theme, the stars and the calls to
 * action. Radix keeps focus inside and closes it on Escape. The border is a
 * still gradient, since a spinning one is the kind of layer iOS chokes on.
 */
export function MobileMenu({ version }: { version: string | null }) {
  const [open, setOpen] = useState(false);
  const { t, path } = useI18n();
  const active = useActiveHref();
  const hrefOf = useNavHref();
  const { theme, setTheme } = useTheme();
  const { choice, pick } = useLanguageChoice();
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={t("nav.openMenu")}
          className="btn-chip flex size-10 items-center justify-center rounded-[10px] lg:hidden"
        >
          <Menu className="size-[18px]" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fx-drop fixed inset-x-3 top-3 z-50 max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[22px] outline-none sm:top-5 sm:right-4 sm:left-auto sm:w-[400px]"
        >
          <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--tone-green)_75%,transparent),var(--border)_38%,var(--border)_70%,color-mix(in_srgb,var(--tone-cyan)_60%,transparent))] p-px shadow-[0_40px_80px_-20px_rgb(0_0_0/0.6),0_30px_80px_-30px_rgb(23_163_122/0.5)]">
            <div className="relative overflow-hidden rounded-[21px] bg-card">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-20 -right-16 h-[220px] w-[260px] rounded-full bg-[#17a37a]"
                style={{ filter: "blur(60px)", opacity: "calc(0.24 * var(--glow-strength))" }}
              />

              <div className="relative flex h-14 items-center gap-2.5 border-b border-border pr-2 pl-3.5">
                <Image src="/logo.svg" alt="" width={26} height={26} />
                <Dialog.Title className="font-semibold">SkySend</Dialog.Title>
                {version && (
                  <span className="ml-0.5 rounded-full bg-tone-green/16 px-2 py-px text-xs font-medium text-tone-green tabular-nums">
                    {version}
                  </span>
                )}
                <Dialog.Close
                  aria-label={t("nav.closeMenu")}
                  className="btn-chip ml-auto flex size-10 items-center justify-center rounded-[10px]"
                >
                  <X className="size-[18px]" />
                </Dialog.Close>
              </div>

              <nav aria-label={t("nav.main")} className="relative flex flex-col gap-0.5 p-2">
                {NAV_LINKS.map((link, i) => {
                  const on = link.href === active;
                  const color = `var(--tone-${link.tone})`;
                  const tint = (pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
                  const Arrow = link.external ? ArrowUpRight : ChevronRight;
                  return (
                    <Link
                      key={link.href}
                      href={hrefOf(link)}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noreferrer" : undefined}
                      aria-current={on ? "page" : undefined}
                      onClick={close}
                      className={cn(
                        "fx-rise flex min-h-[60px] items-center gap-3.5 rounded-[14px] px-3 py-2.5 transition-[background-color,transform] duration-150 active:scale-[0.98]",
                        !on && "hover:bg-foreground/[0.04]"
                      )}
                      style={
                        {
                          animationDelay: `${0.05 + i * 0.045}s`,
                          ...(on && {
                            background: `linear-gradient(90deg, ${tint(14)}, ${tint(3)})`,
                            boxShadow: `inset 0 0 0 1px ${tint(25)}`,
                          }),
                        } as CSSProperties
                      }
                    >
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          background: tint(14),
                          color,
                          boxShadow: on ? `0 0 20px ${tint(45)}` : undefined,
                        }}
                      >
                        <link.icon className="size-[18px]" />
                      </span>
                      <span className="flex min-w-0 grow flex-col gap-px">
                        <span className="text-[17px] font-semibold tracking-[-0.01em]">{t(link.label)}</span>
                        <span className="truncate text-[13px] text-muted-foreground">{t(link.caption)}</span>
                      </span>
                      {on ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-tone-green">
                          <span className="relative size-1.5">
                            <span className="fx-ping absolute inset-0 rounded-full bg-tone-green" />
                            <span className="absolute inset-0 rounded-full bg-tone-green" />
                          </span>
                          {t("nav.here")}
                        </span>
                      ) : (
                        <Arrow className="size-4 shrink-0 text-fainter" />
                      )}
                    </Link>
                  );
                })}
              </nav>

              <div className="fx-rise relative mx-4 mt-1 flex items-center gap-2 border-t border-border pt-3.5" style={{ animationDelay: "0.3s" }}>
                <div role="radiogroup" aria-label={t("nav.colorScheme")} className="flex h-11 grow rounded-[11px] border border-border bg-surface p-[3px]">
                  {THEMES.map((th) => {
                    const on = theme === th.value;
                    return (
                      <button
                        key={th.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={t(th.label)}
                        onClick={() => setTheme(th.value)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-all duration-250",
                          on ? "grow-[2] bg-card text-foreground shadow-[var(--chip-shadow)] dark:bg-accent" : "grow text-faint"
                        )}
                      >
                        <th.icon className="size-[15px]" />
                        {on && t(th.label)}
                      </button>
                    );
                  })}
                </div>
                <GithubStarsWidget className="flex h-11 rounded-[11px]" />
              </div>

              <div className="fx-rise relative mx-4 mt-2.5" style={{ animationDelay: "0.33s" }}>
                <div role="radiogroup" aria-label={t("lang.label")} className="flex h-11 rounded-[11px] border border-border bg-surface p-[3px]">
                  {(["auto", ...LOCALES] as const).map((c) => {
                    const on = choice === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => pick(c)}
                        className={cn(
                          "flex grow items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors",
                          on ? "bg-card text-foreground shadow-[var(--chip-shadow)] dark:bg-accent" : "text-faint"
                        )}
                      >
                        {c !== "auto" && <LocaleFlag locale={c} />}
                        {c === "auto" ? t("lang.auto") : <span lang={c}>{t(`lang.${c}`)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="fx-rise relative flex flex-col gap-2 px-4 pt-3.5 pb-4" style={{ animationDelay: "0.36s" }}>
                <Link
                  href={path("/#start")}
                  onClick={close}
                  className="btn-primary flex h-[50px] items-center justify-center gap-2 rounded-xl text-base font-semibold"
                >
                  {t("nav.getStarted")}
                  <ArrowRight className="size-[17px]" />
                </Link>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={DISCORD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-11 items-center justify-center gap-2 rounded-xl font-medium text-subtle"
                  >
                    <DiscordIcon className="size-4 text-[#6366f1] dark:text-[#a5b4fc]" />
                    {t("nav.discord")}
                  </a>
                  <a
                    href={SPONSOR_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-11 items-center justify-center gap-2 rounded-xl font-medium text-subtle"
                  >
                    <Heart className="size-4 text-tone-red" />
                    {t("nav.sponsor")}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
