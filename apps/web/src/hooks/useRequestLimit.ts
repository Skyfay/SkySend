import { useEffect, useState } from "react";
import { fetchRequestLimit, type RequestLimit } from "@/lib/api";

/**
 * How many new file requests the caller has left today, asked again whenever `refresh`
 * changes, after one was created for example. Null until the server answered, or where it
 * did not.
 */
export function useRequestLimit(enabled: boolean, refresh: unknown): RequestLimit | null {
  const [limit, setLimit] = useState<RequestLimit | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchRequestLimit()
      .then((next) => {
        if (live) setLimit(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, refresh]);
  return limit;
}
