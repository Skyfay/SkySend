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
  url: z.string(),
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

export type Instance = z.infer<typeof InstanceSchema>;
export type InstancesResponse = z.infer<typeof InstancesResponseSchema>;

export function isOfficialInstance(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("skysend.app");
  } catch {
    return false;
  }
}
