import { Lock } from "lucide-react";
import { TrafficLights } from "@/components/site/traffic-lights";
import { cn } from "@/lib/utils";

export function BrowserFrame({
  url = "app.skysend.example",
  children,
  className,
}: {
  url?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20 ring-1 ring-white/10 ring-inset",
        className
      )}
    >
      <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
        <TrafficLights />
        <div className="mx-auto flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground">
          <Lock className="size-3" />
          {url}
        </div>
      </div>
      {children}
    </div>
  );
}
