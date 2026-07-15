import { ShieldAlert } from "lucide-react";
import { ReportForm } from "@/components/site/report/report-form";
import { SectionHeading } from "@/components/site/section-heading";

export const metadata = {
  title: "Report Abuse",
  description:
    "Report a SkySend file or note link that violates our policies - spam, malware, illegal content, or copyright infringement.",
  alternates: {
    canonical: "/report",
  },
};

export default function ReportPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2 lg:items-start">
      <div>
        <SectionHeading
          as="h1"
          eyebrow="Report Abuse"
          title="Found a link that shouldn't be there?"
          description="Help us keep SkySend safe for everyone. Reports are reviewed by the operator of the instance the link belongs to."
          align="left"
          className="max-w-none"
        />

        <div className="mt-8 flex items-start gap-4 rounded-3xl border border-border bg-card p-6">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <ShieldAlert className="size-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Why report?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every report is reviewed. Because of SkySend&apos;s zero-knowledge encryption, only
              metadata like the link and expiry are visible to operators - reporting the exact
              link is the only way to flag a specific share.
            </p>
          </div>
        </div>
      </div>

      <ReportForm />
    </div>
  );
}
