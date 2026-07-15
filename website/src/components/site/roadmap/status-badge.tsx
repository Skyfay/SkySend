import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import type { RoadmapStatus } from "@/lib/roadmap";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

const STATUS_CONFIG: Record<RoadmapStatus, { label: string; variant: BadgeVariant }> = {
  idea: { label: "Idea", variant: "secondary" },
  planned: { label: "Planned", variant: "outline" },
  "in-progress": { label: "In Progress", variant: "default" },
};

export function StatusBadge({ status }: { status: RoadmapStatus }) {
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
