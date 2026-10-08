import { z } from "zod";

export const INSTANCES_API_URL = "https://instances.skysend.app";

const ContactSchema = z
  .object({
    label: z.string(),
    url: z.string(),
  })
  .passthrough();

export const InstanceSchema = z.object({
  name: z.string(),
  url: z.url({ protocol: /^https$/ }),
  country: z.string(),
  flag: z.string(),
  contact: ContactSchema,
  online: z.boolean(),
  version: z.string().nullable(),
  enabledServices: z.array(z.string()),
  fileMaxSize: z.number().nullable(),
  fileMaxFilesPerUpload: z.number().nullable(),
  fileMaxExpiry: z.number().nullable(),
  fileMaxDownloads: z.number().nullable(),
  fileUploadQuotaBytes: z.number().nullable(),
  fileUploadQuotaWindow: z.number().nullable(),
  noteMaxSize: z.number().nullable(),
  noteMaxExpiry: z.number().nullable(),
  noteMaxViews: z.number().nullable(),
});

export const InstancesResponseSchema = z.object({
  instances: z.array(InstanceSchema),
  lastUpdated: z.string().nullable(),
});

/**
 * Reads the response of the instances worker. Every instance is checked on its
 * own, so one instance that reports something odd is left out instead of
 * emptying the whole list.
 */
export function parseInstancesResponse(raw: unknown): InstancesResponse | null {
  const outer = z.object({ instances: z.array(z.unknown()), lastUpdated: z.string().nullable() }).safeParse(raw);
  if (!outer.success) return null;
  const instances = outer.data.instances.flatMap((item) => {
    const parsed = InstanceSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return { instances, lastUpdated: outer.data.lastUpdated };
}

export type Instance = z.infer<typeof InstanceSchema>;
export type InstancesResponse = z.infer<typeof InstancesResponseSchema>;

export function isOfficialInstance(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "skysend.app" || host.endsWith(".skysend.app");
  } catch {
    return false;
  }
}
