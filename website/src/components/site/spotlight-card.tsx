"use client";

import type { ComponentProps, ElementType } from "react";
import { cn } from "@/lib/utils";

type Props<T extends ElementType> = {
  as?: T;
  /** The tint of the light under the mouse, as an `r g b` triple. */
  rgb?: string;
  /** The radius of the light in px. */
  reach?: number;
} & ComponentProps<T>;

/**
 * A card with a soft light that follows the mouse. The position goes into
 * CSS variables, so moving the mouse never re-renders React.
 */
export function SpotlightCard<T extends ElementType = "div">({
  as,
  rgb = "70 200 157",
  reach = 460,
  className,
  style,
  onMouseMove,
  ...props
}: Props<T>) {
  const Comp: ElementType = as ?? "div";
  return (
    <Comp
      {...props}
      onMouseMove={(e: React.MouseEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
        onMouseMove?.(e);
      }}
      style={{ "--spot-rgb": rgb, "--spot-reach": `${reach}px`, ...style }}
      className={cn("spotlight panel fx-lift relative min-w-0 overflow-hidden", className)}
    />
  );
}
