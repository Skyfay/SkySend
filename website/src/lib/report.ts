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
  "Copyright or intellectual property",
  "Illegal activities",
  "Other",
] as const;

const ReportContactSchema = z
  .object({
    abuse: z.union([z.boolean(), z.string()]).optional(),
    url: z.url({ protocol: /^(https|mailto)$/ }).optional(),
    label: z.string().optional(),
  })
  .passthrough();

export const ReportInstanceSchema = z.object({
  name: z.string(),
  country: z.string(),
  url: z.url({ protocol: /^https$/ }),
  flag: z.string(),
  contact: ReportContactSchema.optional(),
});

export type ReportInstance = z.infer<typeof ReportInstanceSchema>;

export const ReportFormSchema = z.object({
  url: z.url({ protocol: /^https$/, error: "Paste the whole link of the share." }),
  reason: z.array(z.enum(REPORT_REASONS)).min(1, "Pick at least one reason."),
  comment: z.string().trim().min(10, "Describe what is wrong in at least 10 characters."),
  replyEmail: z.email("Enter a valid email or leave the field empty.").nullable(),
  token: z.string().min(1, "Wait for the spam check to finish."),
});

export type LinkKind = "file" | "note" | "request" | "inbox" | "other";

/**
 * What a pasted link points to. An inbox link is refused, its key would open
 * everything ever sent to the request, so only the other three are reportable.
 */
export function getLinkKind(url: string): LinkKind | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  // The same rules as the report Worker: an inbox anywhere in the path is
  // refused, and the share has to be the last segment of the path.
  if (/\/inbox\//i.test(path)) return "inbox";
  const match = path.match(/\/(file|note|request)\/[^/]+\/?$/i);
  return match ? (match[1].toLowerCase() as LinkKind) : "other";
}

/** Reads the instance list of the report Worker, dropping any entry that does not parse. */
export function parseReportInstances(raw: unknown): ReportInstance[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item) => {
    const parsed = ReportInstanceSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

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
