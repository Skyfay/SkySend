// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RequestTemplate, TemplateFields } from "../../src/lib/request-templates.js";

const kept = new Map<string, RequestTemplate>();
vi.mock("../../src/lib/upload-store.js", () => ({
  getAllTemplates: vi.fn(async () =>
    [...kept.values()].sort((a, b) => a.name.localeCompare(b.name)),
  ),
  saveTemplate: vi.fn(async (template: RequestTemplate) => {
    kept.set(template.id, template);
  }),
  removeTemplate: vi.fn(async (id: string) => {
    kept.delete(id);
  }),
}));

import * as store from "../../src/lib/upload-store.js";
import { useRequestTemplates } from "../../src/hooks/useRequestTemplates.js";
import { planImport } from "../../src/lib/request-templates.js";

const wlan: TemplateFields = { name: "WLAN", asks: ["note"] };
const files: TemplateFields = {
  name: "Tax",
  asks: ["files"],
  limits: { expireSec: 604_800, sends: 10, maxSize: 2 * 1024 ** 3 },
};

async function ready() {
  const hook = renderHook(() => useRequestTemplates());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  kept.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRequestTemplates", () => {
  it("saves a new template with an ID and a date of its own", async () => {
    const { result } = await ready();
    let saved: RequestTemplate | undefined;
    await act(async () => {
      saved = await result.current.save(wlan);
    });
    expect(saved).toMatchObject({ ...wlan, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(result.current.templates).toEqual([saved]);
  });

  it("replaces a template in place and keeps when it was made and last used", async () => {
    const { result } = await ready();
    let first: RequestTemplate | undefined;
    await act(async () => {
      first = await result.current.save(wlan);
    });
    await act(() => result.current.markUsed(first!.id));
    const used = result.current.templates[0]!;
    expect(used.usedAt).toBeDefined();

    await act(async () => {
      await result.current.save({ ...files, name: "WLAN" }, used);
    });
    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0]).toEqual({
      ...files,
      name: "WLAN",
      id: used.id,
      createdAt: used.createdAt,
      usedAt: used.usedAt,
    });
  });

  it("duplicates a template under a free name and deletes one", async () => {
    const { result } = await ready();
    await act(async () => {
      await result.current.save(wlan);
    });
    await act(async () => {
      await result.current.duplicate(result.current.templates[0]!);
    });
    expect(result.current.templates.map((t) => t.name)).toEqual(["WLAN", "WLAN (2)"]);
    await act(() => result.current.remove(result.current.templates[0]!.id));
    expect(result.current.templates.map((t) => t.name)).toEqual(["WLAN (2)"]);
    expect(store.removeTemplate).toHaveBeenCalledOnce();
  });

  it("imports by replacing a kept template or by keeping both, as chosen", async () => {
    const { result } = await ready();
    await act(async () => {
      await result.current.save(wlan);
      await result.current.save(files);
    });
    const [tax, wlanKept] = result.current.templates;
    const items = planImport(
      [
        { name: "wlan", asks: ["files", "note"] },
        { name: "Tax", asks: ["note"] },
        { name: "New", asks: ["files"] },
        { name: "tax", asks: ["files"] },
      ],
      result.current.templates,
    );
    await act(() => result.current.importItems(items, ["replace", "keep", "keep", "skip"]));

    const byName = Object.fromEntries(result.current.templates.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(["New", "Tax", "Tax (2)", "WLAN"]);
    // The replaced one keeps its name, its ID and its date.
    expect(byName.WLAN).toMatchObject({
      id: wlanKept!.id,
      createdAt: wlanKept!.createdAt,
      asks: ["files", "note"],
    });
    expect(byName.Tax).toEqual(tax);
    expect(byName["Tax (2)"]!.asks).toEqual(["note"]);
  });

  it("shows no templates where the browser keeps none", async () => {
    vi.mocked(store.getAllTemplates).mockRejectedValueOnce(new Error("No IndexedDB"));
    const { result } = await ready();
    expect(result.current.templates).toEqual([]);
  });
});
