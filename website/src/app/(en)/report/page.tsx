import { ReportPage, reportMetadata } from "@/components/pages/report-page";

export const metadata = reportMetadata("en");

export default function Report() {
  return <ReportPage locale="en" />;
}
