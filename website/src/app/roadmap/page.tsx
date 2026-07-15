import { SectionHeading } from "@/components/site/section-heading";
import { MilestonesSection } from "@/components/site/roadmap/milestones-section";
import { RoadmapList } from "@/components/site/roadmap/roadmap-list";
import { ShippedTimeline } from "@/components/site/roadmap/shipped-timeline";

export const metadata = {
  title: "Roadmap",
  description:
    "What's shipped, what's actively being built, and what's on the wishlist for SkySend.",
  alternates: {
    canonical: "/roadmap",
  },
};

export default function RoadmapPage() {
  return (
    <div>
      <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-24">
        <SectionHeading
          as="h1"
          eyebrow="Roadmap"
          title="What's next for SkySend"
          description="Ideas, active work, and shipped history - no promised dates, just an honest status."
        />
      </div>
      <MilestonesSection />
      <RoadmapList />
      <ShippedTimeline />
    </div>
  );
}
