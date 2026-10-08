import { Hero } from "@/components/site/home/hero";
import { Features } from "@/components/site/home/features";
import { KeyBand } from "@/components/site/home/key-band";
import { CliSection } from "@/components/site/home/cli-section";
import { QuickStart } from "@/components/site/home/quick-start";
import { Instances } from "@/components/site/home/instances";
import { Faq } from "@/components/site/home/faq";
import { CtaBand } from "@/components/site/home/cta-band";
import { JsonLd } from "@/components/site/json-ld";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { FAQ_KEYS } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export function homeMetadata(locale: Locale) {
  return pageMetadata(locale, "/");
}

export function HomePage({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);

  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SkySend",
    description: t("meta.tagline"),
    url: `${SITE_URL}${localePath(locale, "/")}`,
    inLanguage: locale,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Linux, Docker",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: locale,
    mainEntity: FAQ_KEYS.map((faq) => ({
      "@type": "Question",
      name: t(faq.q),
      acceptedAnswer: { "@type": "Answer", text: t(faq.a) },
    })),
  };

  return (
    <>
      <JsonLd data={softwareJsonLd} />
      <JsonLd data={faqJsonLd} />
      <Hero locale={locale} />
      <Features locale={locale} />
      <KeyBand />
      <CliSection />
      <QuickStart />
      <Instances />
      <Faq />
      <CtaBand locale={locale} />
    </>
  );
}
