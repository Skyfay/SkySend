import { DotGrid, Glow, Stars } from "@/components/site/fx";

/**
 * The glows, dots and stars behind the head of the blog and roadmap pages. The
 * glows take the color of the post on a post page and are green elsewhere.
 */
export function PageBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[700px] overflow-hidden">
      <Glow color="var(--post-glow)" opacity={0.22} drift={1} className="-top-20 left-[10%] h-[460px] w-[520px]" />
      <Glow
        color="var(--post-glow-2)"
        opacity={0.2}
        drift={1}
        className="-top-10 right-[8%] h-[420px] w-[460px]"
        style={{ animationDelay: "-8s" }}
      />
      <DotGrid mask="radial-gradient(ellipse 60% 60% at 50% 20%, #000, transparent 75%)" />
      <Stars count={20} height={600} seed={5} />
    </div>
  );
}
