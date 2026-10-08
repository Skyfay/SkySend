import { Flag, Inbox, Link2, Mail, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { ReportForm } from "@/components/site/report/report-form";
import { DotGrid, Eyebrow, Glow } from "@/components/site/fx";

export const metadata = {
  title: "Report a link",
  description:
    "Report a SkySend file, note or request link to the instance that hosts it. Its operator gets the report and can delete the share.",
  alternates: {
    canonical: "/report",
  },
};

const FLOW: { icon: LucideIcon; tone: string; title: string; text: string }[] = [
  { icon: UserRound, tone: "subtle", title: "You", text: "Paste the link and say what is wrong." },
  { icon: ShieldCheck, tone: "green", title: "A spam check", text: "Cloudflare Turnstile keeps bots out." },
  { icon: Flag, tone: "red", title: "The operator", text: "Its abuse contact gets an email." },
];

const NOTES: { icon: LucideIcon; tone: string; title: string; text: string }[] = [
  {
    icon: Link2,
    tone: "green",
    title: "Paste the whole link",
    text: "The part after the # lets the operator open the share and judge it. Without it they only see ciphertext.",
  },
  {
    icon: Inbox,
    tone: "amber",
    title: "Inbox links are refused",
    text: "Their key would open everything ever sent to a request. Report the upload link instead.",
  },
  {
    icon: Mail,
    tone: "subtle",
    title: "Your email stays optional",
    text: "Leave one only if the operator may write back to you.",
  },
];

function toneColor(tone: string) {
  return tone === "subtle" ? "var(--subtle)" : `var(--tone-${tone})`;
}

export default function ReportPage() {
  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[700px] overflow-hidden">
        <Glow color="#17a37a" opacity={0.2} drift={1} className="-top-16 left-[8%] h-[460px] w-[520px]" />
        <Glow color="#f0555a" opacity={0.12} drift={2} className="top-5 right-[6%] h-[420px] w-[480px]" />
        <DotGrid mask="radial-gradient(ellipse 60% 60% at 50% 20%, #000, transparent 75%)" />
      </div>

      <div className="relative mx-auto grid max-w-[1248px] items-start gap-10 px-4 pt-[124px] sm:px-6 sm:pt-[172px] lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div className="flex flex-col gap-[22px]">
          <Eyebrow>Report a link</Eyebrow>
          <h1 className="text-[36px] leading-[1.06] font-semibold tracking-[-0.045em] sm:text-[56px] sm:leading-[1.05]">
            Found a link that <span className="fx-shine">should not be there?</span>
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground sm:text-[17px]">
            Report a file, note or request link to the instance that hosts it. Its operator gets the report and can
            delete the share.
          </p>

          <div className="panel flex flex-col gap-4 rounded-[18px] p-5">
            <span className="font-semibold">Where a report goes</span>
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
                  <span className="text-[13px] font-semibold">{step.title}</span>
                  <span className="text-xs leading-[1.45] text-muted-foreground">{step.text}</span>
                </li>
              ))}
            </ol>
          </div>

          <ul className="flex flex-col overflow-hidden rounded-[18px] border border-border">
            {NOTES.map((note) => (
              <li key={note.title} className="flex gap-3 border-b border-border px-[18px] py-4 last:border-b-0">
                <note.icon className="mt-0.5 size-[18px] shrink-0" style={{ color: toneColor(note.tone) }} />
                <span className="flex flex-col gap-[3px]">
                  <span className="font-semibold">{note.title}</span>
                  <span className="leading-[1.55] text-muted-foreground">{note.text}</span>
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
