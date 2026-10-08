"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import type { Heading } from "@/lib/blog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

/** A thin bar on top of the window that fills while the article is read. */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      setProgress(Math.min(1, Math.max(0, -r.top / Math.max(total, 1))));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [targetId]);

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 z-50 h-[3px] bg-gradient-to-r from-post to-post-2 shadow-[0_0_12px_color-mix(in_srgb,var(--post-tone)_80%,transparent)]"
      style={{ width: `${progress * 100}%` }}
    />
  );
}

export function CopyLinkButton() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t("blog.linkCopied") : t("blog.copyLink")}
      className={cn(
        "flex size-10 items-center justify-center gap-1.5 rounded-full border font-medium transition-all duration-200 sm:h-[34px] sm:w-auto sm:rounded-lg sm:px-3",
        copied ? "border-post/35 bg-post/10 text-post" : "btn-chip"
      )}
    >
      {copied ? <Check className="size-4 sm:size-3.5" strokeWidth={2.4} /> : <Link2 className="size-4 sm:size-3.5" />}
      <span className="hidden sm:inline">{copied ? t("blog.linkCopied") : t("blog.copyLink")}</span>
    </button>
  );
}

/** The table of contents beside the article, marking the heading being read. */
export function TableOfContents({ headings }: { headings: Heading[] }) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);

  useEffect(() => {
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current = 0;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top < line) current = i;
      });
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <div className="panel rounded-2xl p-4">
      <div className="px-2 pb-2.5 text-[13px] font-medium text-faint">{t("blog.onThisPage")}</div>
      <nav aria-label={t("blog.onThisPage")} className="relative flex flex-col gap-0.5">
        <span aria-hidden="true" className="absolute top-1 bottom-1 left-0 w-0.5 rounded-sm bg-border" />
        {headings.map((h, i) => {
          const on = i === active;
          const past = i < active;
          return (
            <a
              key={h.id}
              href={`#${h.id}`}
              aria-current={on ? "location" : undefined}
              className={cn(
                "relative flex items-center rounded-lg py-[7px] pr-2.5 pl-4 text-[13px] font-medium transition-all duration-200",
                on ? "bg-post/8 text-foreground" : past ? "text-muted-foreground" : "text-faint hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-sm transition-colors duration-200",
                  on && "bg-post shadow-[0_0_8px_var(--post-tone)]",
                  past && "bg-input"
                )}
              />
              {h.text}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
