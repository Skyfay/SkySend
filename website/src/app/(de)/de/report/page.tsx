import { ReportPage, reportMetadata } from "@/components/pages/report-page";

export const metadata = reportMetadata("de");

export default function Report() {
  return <ReportPage locale="de" />;
}
