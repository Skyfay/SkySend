import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/site/roadmap/status-badge";
import { GITHUB_REPO } from "@/lib/content";
import { ROADMAP_CATEGORIES, type RoadmapItem } from "@/lib/roadmap";

export function RoadmapItemCard({ item }: { item: RoadmapItem }) {
  const categoryLabel = ROADMAP_CATEGORIES.find((c) => c.value === item.category)?.label;

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          {categoryLabel && (
            <Badge variant="outline" className="text-muted-foreground">
              {categoryLabel}
            </Badge>
          )}
        </div>
        <CardTitle className="mt-1 text-base">{item.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        {item.issueNumber && (
          <a
            href={`https://github.com/${GITHUB_REPO}/issues/${item.issueNumber}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            #{item.issueNumber}
            <ArrowUpRight className="size-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}
