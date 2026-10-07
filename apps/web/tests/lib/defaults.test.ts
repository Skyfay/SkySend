// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../../src/lib/api.js";
import {
  fileStart,
  noteStart,
  pickOption,
  readDefaults,
  requestSizeOptions,
  requestStart,
  subscribeDefaults,
  writeDefaults,
} from "../../src/lib/defaults.js";

const GIB = 1024 ** 3;
const config = {
  fileExpireOptions: [3600, 86_400, 604_800],
  fileDefaultExpire: 86_400,
  fileDownloadOptions: [1, 5, 10],
  fileDefaultDownload: 1,
  noteExpireOptions: [3600, 86_400],
  noteDefaultExpire: 3600,
  noteViewOptions: [0, 1, 5],
  noteDefaultViews: 1,
  fileRequestExpireOptions: [86_400, 259_200],
  fileRequestDefaultExpire: 86_400,
  fileRequestMaxUploads: 20,
  fileRequestMaxSize: 10 * GIB,
  forceFilePassword: false,
  forceNotePassword: false,
} as ServerConfig;

const KEY = "skysend-defaults";

// This jsdom build ships localStorage without its methods, so it is a Map here.
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  writeDefaults({ file: {}, note: {}, request: {} });
  store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pickOption", () => {
  it("keeps a value the server offers and falls back to its default otherwise", () => {
    expect(pickOption([1, 5], 5, 1)).toBe(5);
    expect(pickOption([1, 5], 3, 1)).toBe(1);
    expect(pickOption([1, 5], undefined, 1)).toBe(1);
  });
});

describe("the starts of the forms", () => {
  it("start from the server's defaults while this browser keeps none", () => {
    expect(fileStart(config, {})).toEqual({ expireSec: 86_400, limit: 1, password: false });
    expect(noteStart(config, {})).toEqual({ expireSec: 3600, limit: 1, password: false });
    expect(requestStart(config, {})).toEqual({
      expireSec: 86_400,
      sends: 10,
      maxSize: 10 * GIB,
      password: false,
    });
  });

  it("start from this browser's defaults within what the server offers", () => {
    expect(fileStart(config, { expireSec: 604_800, limit: 10, password: true })).toEqual({
      expireSec: 604_800,
      limit: 10,
      password: true,
    });
    // Unlimited views stay unlimited, never turn into the next smaller option.
    expect(noteStart(config, { limit: 0 }).limit).toBe(0);
    expect(noteStart({ ...config, noteViewOptions: [1, 5] }, { limit: 0 }).limit).toBe(1);
    expect(requestStart(config, { sends: 50, maxSize: 2 * GIB })).toMatchObject({
      sends: 20,
      maxSize: 2 * GIB,
    });
    expect(requestStart(config, { maxSize: 3 * GIB }).maxSize).toBe(10 * GIB);
  });

  it("keep a password the server asks for on, whatever this browser says", () => {
    const forced = { ...config, forceFilePassword: true, forceNotePassword: true };
    expect(fileStart(forced, { password: false }).password).toBe(true);
    expect(noteStart(forced, { password: false }).password).toBe(true);
    expect(requestStart(forced, { password: false }).password).toBe(true);
  });

  it("offer the size steps below the server's largest, and the largest itself", () => {
    expect(requestSizeOptions(1.5 * GIB).at(-1)).toBe(1.5 * GIB);
    expect(requestSizeOptions(1.5 * GIB)).toContain(GIB);
    expect(requestSizeOptions(1.5 * GIB)).not.toContain(2 * GIB);
  });
});

describe("the store of this browser", () => {
  it("keeps what was written, and tells who listens", () => {
    const listener = vi.fn();
    const stop = subscribeDefaults(listener);
    writeDefaults({ file: { limit: 5 }, note: {}, request: {} });
    expect(listener).toHaveBeenCalledOnce();
    expect(JSON.parse(store.get(KEY)!)).toEqual({
      file: { limit: 5 },
      note: {},
      request: {},
    });
    expect(readDefaults().file.limit).toBe(5);
    stop();
    writeDefaults({ file: {}, note: {}, request: {} });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("reads what another tab wrote", () => {
    const listener = vi.fn();
    const stop = subscribeDefaults(listener);
    const written = JSON.stringify({ file: {}, note: { limit: 5 }, request: {} });
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: written }));
    expect(listener).toHaveBeenCalledOnce();
    expect(readDefaults().note.limit).toBe(5);
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "x" }));
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it("reads a stored text as untrusted and keeps the sections that read", () => {
    const send = (text: string) =>
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: text }));
    const stop = subscribeDefaults(() => {});
    send("not json");
    expect(readDefaults()).toEqual({ file: {}, note: {}, request: {} });
    send(JSON.stringify({ file: { limit: -1 }, note: { password: true }, request: "x" }));
    expect(readDefaults()).toEqual({ file: {}, note: { password: true }, request: {} });
    send(JSON.stringify({ file: { limit: 5, password: "yes" }, note: {}, request: {} }));
    expect(readDefaults().file).toEqual({});
    stop();
  });

  it("keeps the defaults for this page where the browser refuses to store them", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    writeDefaults({ file: { limit: 10 }, note: {}, request: {} });
    expect(readDefaults().file.limit).toBe(10);
  });
});

describe("the first read of a page", () => {
  it("reads what an earlier visit stored, and keeps none where reading fails", async () => {
    store.set(KEY, JSON.stringify({ file: { limit: 5 }, note: {}, request: {} }));
    vi.resetModules();
    const fresh = await import("../../src/lib/defaults.js");
    expect(fresh.readDefaults().file.limit).toBe(5);

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    vi.resetModules();
    const refused = await import("../../src/lib/defaults.js");
    expect(refused.readDefaults()).toEqual({ file: {}, note: {}, request: {} });
  });
});
