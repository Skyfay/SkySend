"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { BrowserFrame } from "@/components/site/browser-frame";
import { SectionHeading } from "@/components/site/section-heading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface Screenshot {
  id: string;
  label: string;
  src: string;
  lightSrc?: string;
}

const SCREENSHOTS: Screenshot[] = [
  {
    id: "overview",
    label: "Overview",
    src: "/screenshots/overview.png",
    lightSrc: "/screenshots/overview-light.png",
  },
  {
    id: "uploads",
    label: "Uploads",
    src: "/screenshots/uploads.png",
  },
  {
    id: "code",
    label: "Code Snippets",
    src: "/screenshots/code.png",
  },
  {
    id: "password",
    label: "Passwords",
    src: "/screenshots/password.png",
  },
  {
    id: "ssh",
    label: "SSH Keys",
    src: "/screenshots/ssh.png",
  },
  {
    id: "text",
    label: "Text Notes",
    src: "/screenshots/text.png",
  },
];

const AUTO_ADVANCE_MS = 5000;

export function ProductTour() {
  const { resolvedTheme } = useTheme();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const sectionRef = useRef<HTMLElement | null>(null);

  const goTo = useCallback((i: number) => {
    setIndex(((i % SCREENSHOTS.length) + SCREENSHOTS.length) % SCREENSHOTS.length);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Depending on `index` here means every slide change - whether from the
  // timer tick below or a manual click via goTo() - clears and restarts this
  // interval, which is exactly "reset the timer on manual interaction" with
  // no extra state needed.
  useEffect(() => {
    if (paused || reducedMotion || !inView) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SCREENSHOTS.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [index, paused, reducedMotion, inView]);

  return (
    <section
      ref={sectionRef}
      className="relative mx-auto hidden max-w-7xl px-6 py-24 sm:block"
    >
      <SectionHeading
        eyebrow="Product tour"
        title="See it in action"
        description="A quick look at file uploads, encrypted notes, code snippets, passwords, and SSH keys in the web app."
      />

      <div
        className="relative mt-16"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
        }}
      >
        <Tabs
          value={SCREENSHOTS[index].id}
          onValueChange={(value) => {
            const i = SCREENSHOTS.findIndex((shot) => shot.id === value);
            if (i !== -1) goTo(i);
          }}
          className="mx-auto mb-4 w-fit max-w-full"
        >
          <TabsList className="flex-wrap justify-center">
            {SCREENSHOTS.map((shot) => (
              <TabsTrigger key={shot.id} value={shot.id} aria-label={`Show ${shot.label} screenshot`}>
                {shot.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <BrowserFrame>
          <div className="relative aspect-[2/1] overflow-hidden">
            {SCREENSHOTS.map((shot, i) => (
              <Image
                key={shot.id}
                src={resolvedTheme === "light" && shot.lightSrc ? shot.lightSrc : shot.src}
                alt={`SkySend ${shot.label} screenshot`}
                fill
                sizes="(min-width: 1024px) 1152px, 100vw"
                priority={i === 0}
                loading={i === 0 ? undefined : "eager"}
                className={cn(
                  // Scaled up slightly to mask sub-pixel rounding gaps that object-cover
                  // can leave at certain viewport widths (e.g. exactly 1920px).
                  "scale-[1.02] object-cover object-top transition-opacity duration-500 motion-reduce:transition-none",
                  i === index ? "opacity-100" : "opacity-0"
                )}
              />
            ))}
          </div>
        </BrowserFrame>
      </div>
    </section>
  );
}
