"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}

/**
 * A counter that goes up every `ms` while `ref` is on screen. The demos on the
 * home page derive their state from it. With reduced motion it stays at
 * `still`, a frame chosen to show the demo in a finished state.
 */
export function useTick(ms: number, ref: RefObject<Element | null>, still: number) {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el) return;
    let id: number | undefined;
    const start = () => {
      if (id === undefined) id = window.setInterval(() => setTick((t) => t + 1), ms);
    };
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()));
    io.observe(el);
    return () => {
      stop();
      io.disconnect();
    };
  }, [ms, ref, reduced]);

  return reduced ? still : tick;
}

/** Copies text and reports success for a moment, for the copy buttons of the page. */
export function useCopy(resetMs = 1400) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), resetMs);
  }

  return { copied, copy };
}
