import { z } from "zod";

/** The list of public instances, the same the website shows. */
export const INSTANCES_URL = "https://instances.skysend.app/";

const instanceSchema = z.object({
  name: z.string().min(1).max(100),
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "Only HTTPS instances are listed"),
  country: z.string().max(60).optional().catch(undefined),
  online: z.boolean().catch(false),
  version: z.string().max(30).optional().catch(undefined),
  fileMaxSize: z.number().nonnegative().optional().catch(undefined),
  fileMaxExpiry: z.number().nonnegative().optional().catch(undefined),
  fileUploadQuotaBytes: z.number().nonnegative().optional().catch(undefined),
});

export type PublicInstance = z.infer<typeof instanceSchema>;

const listSchema = z.object({ instances: z.array(z.unknown()) });

/**
 * The public instances that are online, or an empty list when the registry cannot be reached.
 * An entry that does not parse is left out instead of failing the whole list.
 */
export async function fetchPublicInstances(
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<PublicInstance[]> {
  try {
    const res = await fetchFn(INSTANCES_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const { instances } = listSchema.parse(await res.json());
    return instances.flatMap((entry) => {
      const parsed = instanceSchema.safeParse(entry);
      return parsed.success && parsed.data.online ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}
