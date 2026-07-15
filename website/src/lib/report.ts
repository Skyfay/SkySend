import { z } from "zod";

export const REPORT_API_BASE = "https://report.skysend.app";
export const REPORT_INSTANCES_URL = `${REPORT_API_BASE}/instances`;

export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";

export const REPORT_REASONS = [
  "Spam, phishing or malware",
  "Violence or hate speech",
  "Harassment, intimidation or threats",
  "Human rights violation",
  "Copyright / Intellectual Property Infringement",
  "Illegal activities",
  "Other",
] as const;

const ReportContactSchema = z
  .object({
    abuse: z.union([z.boolean(), z.string()]).optional(),
    url: z.string().optional(),
    label: z.string().optional(),
  })
  .passthrough();

export const ReportInstanceSchema = z.object({
  name: z.string(),
  country: z.string(),
  url: z.string(),
  flag: z.string(),
  contact: ReportContactSchema.optional(),
});

export const ReportInstancesResponseSchema = z.array(ReportInstanceSchema);

export type ReportInstance = z.infer<typeof ReportInstanceSchema>;

export const ReportFormSchema = z.object({
  reason: z.array(z.enum(REPORT_REASONS)).min(1, "Select at least one reason."),
  comment: z.string().trim().min(10, "Please provide at least 10 characters."),
  url: z.string().url("Enter a valid SkySend link."),
  token: z.string().min(1, "Please complete the captcha."),
  replyEmail: z.string().trim().email().nullable(),
});

export function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function hasAbuseSupport(instance: ReportInstance | undefined): boolean {
  return !!instance?.contact?.abuse;
}
