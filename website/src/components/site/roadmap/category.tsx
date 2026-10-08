import { Activity, Code, HardDrive, Share2, Shield, type LucideIcon } from "lucide-react";
import { ROADMAP_CATEGORIES, type RoadmapCategory } from "@/lib/roadmap";

const CATEGORY_ICON: Record<RoadmapCategory, LucideIcon> = {
  "core-sharing": Share2,
  storage: HardDrive,
  monitoring: Activity,
  security: Shield,
  "developer-experience": Code,
};

const CATEGORY_LABEL = Object.fromEntries(ROADMAP_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  RoadmapCategory,
  string
>;

export function CategoryPill({ category }: { category: RoadmapCategory }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-input px-2 text-xs font-medium whitespace-nowrap text-subtle">
      <Icon className="size-3" />
      {CATEGORY_LABEL[category]}
    </span>
  );
}
