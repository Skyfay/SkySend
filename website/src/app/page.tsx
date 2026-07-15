import { Hero } from "@/components/site/hero";
import { StatsBand } from "@/components/site/stats-band";
import { InstancesSection } from "@/components/site/instances/instances-section";
// import { ProductTour } from "@/components/site/product-tour";
import { FeatureGrid } from "@/components/site/feature-grid";
import { ZeroKnowledgeSection } from "@/components/site/zero-knowledge-section";
import { AutomationSection } from "@/components/site/automation-section";
import { AccessMethods } from "@/components/site/access-methods";
import { QuickStart } from "@/components/site/quick-start";
import { Faq } from "@/components/site/faq";
import { BlogTeaser } from "@/components/site/blog-teaser";
import { CtaBand } from "@/components/site/cta-band";
import { JsonLd } from "@/components/site/json-ld";
import { SITE_URL } from "@/lib/site";
import { TAGLINE } from "@/lib/content";

const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "SkySend",
  description: TAGLINE,
  url: SITE_URL,
  applicationCategory: "SecurityApplication",
  operatingSystem: "Linux, Docker",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function Home() {
  return (
    <>
      <JsonLd data={SOFTWARE_APPLICATION_JSON_LD} />
      <Hero />
      <StatsBand />
      <ZeroKnowledgeSection />
      {/* ProductTour disabled - the live Server Instances section below lets
          visitors open a real public instance instead of static screenshots. */}
      <InstancesSection />
      <AutomationSection />
      <FeatureGrid />
      <AccessMethods />
      <QuickStart />
      <Faq />
      <BlogTeaser />
      <CtaBand />
    </>
  );
}
