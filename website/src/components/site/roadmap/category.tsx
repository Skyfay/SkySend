"use client";

import { Activity, Code, HardDrive, Share2, Shield, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import type { RoadmapCategory } from "@/lib/roadmap";

const CATEGORY_ICON: Record<RoadmapCategory, LucideIcon> = {
  "core-sharing": Share2,
  storage: HardDrive,
  monitoring: Activity,
  security: Shield,
  "developer-experience": Code,
};

export function CategoryPill({ category }: { category: RoadmapCategory }) {
  const { t } = useI18n();
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-input px-2 text-xs font-medium whitespace-nowrap text-subtle">
      <Icon className="size-3" />
      {t(`roadmap.category.${category}`)}
    </span>
  );
}
