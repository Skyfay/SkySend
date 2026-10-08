import type { CSSProperties } from "react";
import Image from "next/image";
import type { PostCover, PostTone } from "@/lib/blog";
import { cn } from "@/lib/utils";

export const TONE_RGB: Record<PostTone, string> = {
  green: "70 200 157",
  blue: "96 165 250",
  violet: "167 139 250",
  cyan: "34 211 238",
  amber: "251 191 36",
};

const FALLBACK: PostCover = { badge: "SS", tone: "green", snippet: "" };

/**
 * The artwork on top of a post card: its illustration when it has one, else a
 * glow, the badge tile and a terminal line.
 */
export function PostCoverArt({
  cover = FALLBACK,
  image,
  className,
}: {
  cover?: PostCover;
  image?: string | null;
  className?: string;
}) {
  const color = `var(--tone-${cover.tone})`;
  if (image) {
    return (
      <span aria-hidden="true" className={cn("relative block h-[180px] overflow-hidden border-b border-border bg-[#0a0a0b]", className)}>
        <Image src={image} alt="" fill sizes="(min-width: 1024px) 440px, (min-width: 768px) 50vw, 100vw" className="object-cover" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn("relative block h-[180px] overflow-hidden border-b border-border bg-surface dark:bg-[#0c0d0e]", className)}
    >
      <span className="bg-dot-grid absolute inset-0 [background-size:16px_16px]" />
      <span
        className="fx-glow absolute -top-[60px] left-1/2 -ml-[130px] h-[180px] w-[260px] rounded-full"
        style={
          { "--glow": color, "--glow-blur": "50px", opacity: "calc(0.35 * var(--glow-strength))" } as CSSProperties
        }
      />
      {cover.snippet && (
        <span className="absolute inset-x-[18px] bottom-[18px] overflow-hidden rounded-[10px] border border-border-strong bg-surface-2/85 px-3 py-2.5 font-mono text-xs leading-[1.7] whitespace-pre text-subtle">
          {cover.snippet}
        </span>
      )}
      <PostBadge cover={cover} className="absolute top-[18px] left-[18px]" />
    </span>
  );
}

export function PostBadge({ cover = FALLBACK, className }: { cover?: PostCover; className?: string }) {
  const rgb = TONE_RGB[cover.tone];
  return (
    <span
      className={cn("flex size-11 items-center justify-center rounded-xl text-[11px] font-bold", className)}
      style={{
        background: `rgb(${rgb} / 0.16)`,
        color: `var(--tone-${cover.tone})`,
        boxShadow: `0 0 24px rgb(${rgb} / 0.35)`,
      }}
    >
      {cover.badge}
    </span>
  );
}
