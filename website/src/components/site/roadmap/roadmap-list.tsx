import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { RoadmapItemCard } from "@/components/site/roadmap/roadmap-item-card";
import { ROADMAP_ITEMS, type RoadmapStatus } from "@/lib/roadmap";

const STATUS_TABS: { value: RoadmapStatus; label: string }[] = [
  { value: "in-progress", label: "In Progress" },
  { value: "planned", label: "Planned" },
  { value: "idea", label: "Ideas" },
];

export function RoadmapList() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="What's next"
        title="Active roadmap"
        description="No promised dates - just an honest read on what's actively being built, what's decided, and what's still just an idea."
      />

      <Reveal>
        <Tabs defaultValue="planned" className="mt-16 gap-8">
          <TabsList className="mx-auto">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                <span className="ml-1.5 text-muted-foreground">
                  {ROADMAP_ITEMS.filter((item) => item.status === tab.value).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {STATUS_TABS.map((tab) => {
            const items = ROADMAP_ITEMS.filter((item) => item.status === tab.value);
            return (
              <TabsContent key={tab.value} value={tab.value}>
                {items.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {items.map((item) => (
                      <RoadmapItemCard key={item.slug} item={item} />
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nothing in this category right now.
                  </p>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </Reveal>
    </div>
  );
}
