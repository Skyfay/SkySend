import { Flag, Inbox, Link2, Mail, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { ReportForm } from "@/components/site/report/report-form";
import { DotGrid, Eyebrow, Glow } from "@/components/site/fx";
import type { Locale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { pageMetadata } from "@/lib/seo";

export function reportMetadata(locale: Locale) {
  const t = createTranslator(locale);
  return pageMetadata(locale, "/report/", {
    title: t("meta.reportTitle"),
    description: t("meta.reportDescription"),
  });
}

const FLOW: { icon: LucideIcon; tone: string; title: MessageKey; text: MessageKey }[] = [
  { icon: UserRound, tone: "subtle", title: "report.flowYou", text: "report.flowYouText" },
  { icon: ShieldCheck, tone: "green", title: "report.flowCheck", text: "report.flowCheckText" },
  { icon: Flag, tone: "red", title: "report.flowOperator", text: "report.flowOperatorText" },
];

const NOTES: { icon: LucideIcon; tone: string; title: MessageKey; text: MessageKey }[] = [
  { icon: Link2, tone: "green", title: "report.noteWhole", text: "report.noteWholeText" },
  { icon: Inbox, tone: "amber", title: "report.noteInbox", text: "report.noteInboxText" },
  { icon: Mail, tone: "subtle", title: "report.noteEmail", text: "report.noteEmailText" },
];

function toneColor(tone: string) {
  return tone === "subtle" ? "var(--subtle)" : `var(--tone-${tone})`;
}

export function ReportPage({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[700px] overflow-hidden">
        <Glow color="#17a37a" opacity={0.2} drift={1} className="-top-16 left-[8%] h-[460px] w-[520px]" />
        <Glow color="#f0555a" opacity={0.12} drift={2} className="top-5 right-[6%] h-[420px] w-[480px]" />
        <DotGrid mask="radial-gradient(ellipse 60% 60% at 50% 20%, #000, transparent 75%)" />
      </div>

      <div className="relative mx-auto grid max-w-[1248px] items-start gap-10 px-4 pt-[124px] sm:px-6 sm:pt-[172px] lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div className="flex flex-col gap-[22px]">
          <Eyebrow>{t("report.eyebrow")}</Eyebrow>
          <h1 className="text-[36px] leading-[1.06] font-semibold tracking-[-0.045em] sm:text-[56px] sm:leading-[1.05]">
            {t.rich("report.title", { shine: (c) => <span className="fx-shine">{c}</span> })}
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground sm:text-[17px]">{t("report.lead")}</p>

          <div className="panel flex flex-col gap-4 rounded-[18px] p-5">
            <span className="font-semibold">{t("report.whereTitle")}</span>
            <ol className="grid gap-2 sm:grid-cols-3">
              {FLOW.map((step) => (
                <li key={step.title} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-3">
                  <span
                    className="flex size-[30px] items-center justify-center rounded-lg"
                    style={{
                      background: `color-mix(in srgb, ${toneColor(step.tone)} 14%, transparent)`,
                      color: toneColor(step.tone),
                    }}
                  >
                    <step.icon className="size-[15px]" />
                  </span>
                  <span className="text-[13px] font-semibold">{t(step.title)}</span>
                  <span className="text-xs leading-[1.45] text-muted-foreground">{t(step.text)}</span>
                </li>
              ))}
            </ol>
          </div>

          <ul className="flex flex-col overflow-hidden rounded-[18px] border border-border">
            {NOTES.map((note) => (
              <li key={note.title} className="flex gap-3 border-b border-border px-[18px] py-4 last:border-b-0">
                <note.icon className="mt-0.5 size-[18px] shrink-0" style={{ color: toneColor(note.tone) }} />
                <span className="flex flex-col gap-[3px]">
                  <span className="font-semibold">{t(note.title)}</span>
                  <span className="leading-[1.55] text-muted-foreground">{t(note.text)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <ReportForm />
      </div>
    </div>
  );
}
