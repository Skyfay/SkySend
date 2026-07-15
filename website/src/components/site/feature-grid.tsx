import {
  Cloud,
  Code2,
  Fingerprint,
  KeyRound,
  Smartphone,
  ShieldCheck,
  Sparkles,
  TimerOff,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { FEATURES } from "@/lib/content";

const FEATURE_ICONS: Record<string, LucideIcon> = {
  "Zero-Knowledge Encryption": ShieldCheck,
  "Files & Notes": Code2,
  "Self-Destructing Links": TimerOff,
  "Password Protection": KeyRound,
  "No Accounts, No Tracking": UserX,
  "Storage Flexibility": Cloud,
  "CLI & TUI Client": Fingerprint,
  "Progressive Web App": Smartphone,
  "Designed for Simplicity": Sparkles,
};

export function FeatureGrid() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="Features"
        title="Everything a private share needs"
        description="One tool for encrypting, sharing, and expiring files and notes, without asking you to trust the server."
      />

      <Reveal>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = FEATURE_ICONS[feature.title] ?? Sparkles;
            return (
              <Card
                key={feature.title}
                className="group relative overflow-hidden transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
              >
                <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-40" />
                <CardHeader className="relative">
                  <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/15 transition-transform group-hover:scale-110">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <CardTitle className="mt-3 text-lg font-semibold tracking-tight">
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative text-sm text-muted-foreground">
                  {feature.description}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Reveal>
    </section>
  );
}
