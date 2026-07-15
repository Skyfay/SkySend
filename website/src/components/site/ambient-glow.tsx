import { cn } from "@/lib/utils";

export function AmbientGlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-hero-glow bg-grain absolute inset-x-0 top-0 -z-10 [mask-image:linear-gradient(to_bottom,black,transparent)]",
        className
      )}
    />
  );
}
