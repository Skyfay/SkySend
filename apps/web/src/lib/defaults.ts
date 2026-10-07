import { z } from "zod";
import type { ServerConfig } from "@/lib/api";

/**
 * Defaults a user keeps in this browser for the forms: how long a share or a request stays
 * open, how often it can be opened, how much it takes, and whether a password starts on.
 * Each one is missing while the instance's own default applies. Never a password itself, and
 * the server learns none of it.
 */

const STORAGE_KEY = "skysend-defaults";

const count = z.number().int().nonnegative();
const shareSchema = z
  .object({
    expireSec: count.optional(),
    /** Downloads for a file, views for a note, where 0 means unlimited. */
    limit: count.optional(),
    password: z.boolean().optional(),
  })
  .catch({});
const requestSchema = z
  .object({
    expireSec: count.optional(),
    /** Submissions in a request for files and a note, uploads otherwise. */
    sends: count.optional(),
    maxSize: count.optional(),
    password: z.boolean().optional(),
  })
  .catch({});
const defaultsSchema = z.object({
  file: shareSchema.default({}),
  note: shareSchema.default({}),
  request: requestSchema.default({}),
});

export type ShareDefaults = z.infer<typeof shareSchema>;
export type RequestDefaults = z.infer<typeof requestSchema>;
export type BrowserDefaults = z.infer<typeof defaultsSchema>;

const EMPTY: BrowserDefaults = { file: {}, note: {}, request: {} };

/** The last stored text and what it reads as, so a snapshot only changes with the text. */
let cache: { raw: string | null; value: BrowserDefaults } | null = null;
const listeners = new Set<() => void>();

/** What a stored text holds, as untrusted as anything a page did not write itself. */
function parse(text: string | null): BrowserDefaults {
  if (!text) return EMPTY;
  try {
    const parsed = defaultsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The stored text, or null where the browser refuses to read it. */
function storedText(): string | null | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return undefined;
  }
}

/**
 * The defaults of this browser. The store is read on every call, so what another tab wrote
 * counts even when no page listened for it. A browser that refuses storage keeps none.
 */
export function readDefaults(): BrowserDefaults {
  const raw = storedText();
  if (raw === undefined) return cache?.value ?? EMPTY;
  if (!cache || cache.raw !== raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

export function writeDefaults(next: BrowserDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Kept for this page only, where the browser refuses to store it.
  }
  // Paired with what the store holds now, written or not, so a read keeps what was written.
  cache = { raw: storedText() ?? null, value: next };
  for (const listener of listeners) listener();
}

/** Calls back when the defaults change, here or in another tab. */
export function subscribeDefaults(listener: () => void): () => void {
  // A null key means another tab cleared the whole store.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The option a default names while the server still offers it, the server's own otherwise. */
export function pickOption(
  options: readonly number[],
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && options.includes(value) ? value : fallback;
}

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
/** Sizes a requester can pick, as far as the server allows. */
const SIZE_STEPS = [
  10 * MIB,
  50 * MIB,
  100 * MIB,
  250 * MIB,
  500 * MIB,
  GIB,
  2 * GIB,
  5 * GIB,
  10 * GIB,
  20 * GIB,
  50 * GIB,
  100 * GIB,
];

/** The size steps below the server maximum, and the maximum itself. */
export function requestSizeOptions(max: number): number[] {
  return [...SIZE_STEPS.filter((size) => size < max), max];
}

/** How a file share starts: the browser's defaults within what the server offers. */
export function fileStart(config: ServerConfig, defaults: ShareDefaults = readDefaults().file) {
  return {
    expireSec: pickOption(config.fileExpireOptions, defaults.expireSec, config.fileDefaultExpire),
    limit: pickOption(config.fileDownloadOptions, defaults.limit, config.fileDefaultDownload),
    password: config.forceFilePassword || defaults.password === true,
  };
}

/** How a note starts: the browser's defaults within what the server offers. */
export function noteStart(config: ServerConfig, defaults: ShareDefaults = readDefaults().note) {
  return {
    expireSec: pickOption(config.noteExpireOptions, defaults.expireSec, config.noteDefaultExpire),
    limit: pickOption(config.noteViewOptions, defaults.limit, config.noteDefaultViews),
    password: config.forceNotePassword || defaults.password === true,
  };
}

/** How many sends a request starts with when this browser keeps no number. The server has no default of its own. */
const DEFAULT_SENDS = 10;

/** How a request starts: the browser's defaults within what the server offers. */
export function requestStart(
  config: ServerConfig,
  defaults: RequestDefaults = readDefaults().request,
) {
  const max = config.fileRequestMaxUploads;
  return {
    expireSec: pickOption(
      config.fileRequestExpireOptions,
      defaults.expireSec,
      config.fileRequestDefaultExpire,
    ),
    sends: Math.max(1, Math.min(defaults.sends || DEFAULT_SENDS, max)),
    maxSize: pickOption(
      requestSizeOptions(config.fileRequestMaxSize),
      defaults.maxSize,
      config.fileRequestMaxSize,
    ),
    password: config.forceFilePassword || defaults.password === true,
  };
}
