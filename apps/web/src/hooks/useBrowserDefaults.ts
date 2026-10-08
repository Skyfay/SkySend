import { useCallback, useSyncExternalStore } from "react";
import {
  readDefaults,
  subscribeDefaults,
  writeDefaults,
  type BrowserDefaults,
} from "@/lib/defaults";

/** The defaults of this browser for the forms, and changing them. */
export function useBrowserDefaults() {
  const defaults = useSyncExternalStore(subscribeDefaults, readDefaults, readDefaults);

  /** Changes some defaults of one section. A value of undefined goes back to the server's. */
  const update = useCallback(
    <K extends keyof BrowserDefaults>(section: K, patch: BrowserDefaults[K]) => {
      const current = readDefaults();
      writeDefaults({ ...current, [section]: { ...current[section], ...patch } });
    },
    [],
  );

  /** Gives a section back to the defaults of the server. */
  const reset = useCallback((section: keyof BrowserDefaults) => {
    writeDefaults({ ...readDefaults(), [section]: {} });
  }, []);

  return { defaults, update, reset };
}
