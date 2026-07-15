import { Card } from "@/components/ui/card";
import type { Milestone } from "@/lib/roadmap";

export function MilestoneCard({
  milestone,
  current,
}: {
  milestone: Milestone;
  current: number;
}) {
  const pct = Math.min(100, Math.round((current / milestone.target) * 100));
  const format = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

  return (
    <Card className="flex-row items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{milestone.title}</p>
        <p className="truncate text-xs text-muted-foreground">{milestone.description}</p>
      </div>
      <div className="w-36 shrink-0">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold">{format(current)}</span>
          <span className="text-muted-foreground">
            of {format(milestone.target)} {milestone.unit}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </Card>
  );
}
