import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Background effects of the dark design: drifting color glows, masked dot
// grids, a receding floor grid, twinkling stars and spinning gradient borders.
// All of them are decorative, hidden from assistive tech, stopped by
// prefers-reduced-motion and kept still on touch screens in globals.css.

/** A seeded random sequence, so stars land on the same spot on the server and the client. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function Glow({
  className,
  color,
  opacity,
  blur = 120,
  drift,
  style,
}: {
  className?: string;
  color: string;
  opacity: number;
  blur?: number;
  drift?: 1 | 2;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-full",
        drift === 1 && "fx-drift",
        drift === 2 && "fx-drift-2",
        className
      )}
      style={{
        background: color,
        opacity: `calc(${opacity} * var(--glow-strength))`,
        filter: `blur(${blur}px)`,
        ...style,
      }}
    />
  );
}

export function DotGrid({
  className,
  mask,
  size = 22,
}: {
  className?: string;
  mask: string;
  size?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 bg-dot-grid", className)}
      style={{
        backgroundSize: `${size}px ${size}px`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

export function Floor({
  className,
  tilt = 700,
  mask = "linear-gradient(transparent, #000 30%, #000 60%, transparent)",
}: {
  className?: string;
  tilt?: number;
  mask?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute -inset-x-52 overflow-hidden", className)}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      <div
        className="absolute inset-0 origin-top overflow-hidden"
        style={{ transform: `perspective(${tilt}px) rotateX(64deg)` }}
      >
        <div className="fx-floor absolute inset-x-0 -top-16 bottom-0" />
      </div>
    </div>
  );
}

/** White sparks that only show on the dark ground. */
export function Stars({
  count,
  height,
  seed = 17,
  className,
}: {
  count: number;
  height: number;
  seed?: number;
  className?: string;
}) {
  const rnd = seeded(seed);
  const stars = Array.from({ length: count }, () => {
    const size = 1 + Math.round(rnd() * 2);
    return {
      size,
      left: rnd() * 100,
      top: Math.round(rnd() * height),
      delay: (rnd() * 4).toFixed(2),
      duration: (2.5 + rnd() * 3).toFixed(2),
    };
  });

  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 hidden dark:block", className)}>
      {stars.map((s, i) => (
        <span
          key={i}
          className="fx-twinkle absolute rounded-full bg-white"
          style={{
            left: `${s.left}%`,
            top: s.top,
            width: s.size,
            height: s.size,
            boxShadow: "0 0 6px rgb(255 255 255 / 0.8)",
            animationDelay: `-${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

/** The spinning border in the color of a post, from the variables `data-post-tone` sets. */
export const POST_CONIC =
  "conic-gradient(from 0deg, transparent 0deg 280deg, var(--post-tone) 330deg, var(--post-tone-2) 355deg, transparent 360deg)";

export const CONIC = {
  green: "conic-gradient(from 0deg, transparent 0deg 280deg, #46c89d 330deg, #22d3ee 355deg, transparent 360deg)",
  hero: "conic-gradient(from 0deg, transparent 0deg 250deg, #46c89d 300deg, #22d3ee 330deg, #60a5fa 350deg, transparent 360deg)",
  cta: "conic-gradient(from 0deg, transparent 0deg 260deg, #46c89d 310deg, #22d3ee 340deg, transparent 360deg)",
  pill: "conic-gradient(from 0deg, transparent 0deg 270deg, #46c89d 320deg, #22d3ee 350deg, transparent 360deg)",
};

/**
 * A one-pixel frame with a light running around it: a large conic gradient
 * spins behind the content, which covers all of it but the frame. The size
 * only has to cover the diagonal of the frame. On touch screens it stands still.
 */
export function SpinBorder({
  conic,
  size = 1600,
  speed = "slow",
  radius,
  className,
  innerClassName,
  children,
}: {
  conic: string;
  size?: number;
  speed?: "normal" | "slow";
  radius: number;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("relative overflow-hidden bg-border p-px", className)}
      style={{ borderRadius: radius }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "fx-border pointer-events-none absolute top-1/2 left-1/2",
          speed === "slow" ? "fx-spin-slow" : "fx-spin"
        )}
        style={{
          width: size,
          height: size,
          margin: `-${size / 2}px 0 0 -${size / 2}px`,
          background: conic,
        }}
      />
      <div className={cn("relative", innerClassName)} style={{ borderRadius: radius - 1 }}>
        {children}
      </div>
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-xs font-medium text-subtle",
        className
      )}
    >
      {children}
    </span>
  );
}
