// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useFaviconProgress uses canvas and DOM manipulation. jsdom does not support
// canvas rendering natively, so we stub the 2-D context with no-op spy methods.

const mockCtx = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  get strokeStyle() { return ""; },
  set strokeStyle(_v: string) {},
  get fillStyle() { return ""; },
  set fillStyle(_v: string) {},
  get font() { return ""; },
  set font(_v: string) {},
  get textAlign() { return "" as CanvasTextAlign; },
  set textAlign(_v: CanvasTextAlign) {},
  get textBaseline() { return "" as CanvasTextBaseline; },
  set textBaseline(_v: CanvasTextBaseline) {},
  get lineWidth() { return 0; },
  set lineWidth(_v: number) {},
  get lineCap() { return "" as CanvasLineCap; },
  set lineCap(_v: CanvasLineCap) {},
};

beforeEach(() => {
  // Stub getContext so the hook never crashes on missing canvas support
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    mockCtx as unknown as CanvasRenderingContext2D,
  );
  // toDataURL is used to set the favicon href
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,test");

  // Ensure a favicon <link> element exists in the document
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = "https://example.com/original-favicon.ico";
  document.head.appendChild(link);
});

afterEach(() => {
  // Remove the favicon link added in beforeEach
  document.head.querySelectorAll('link[rel*="icon"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe("useFaviconProgress", () => {
  it("does nothing when progress is null", async () => {
    const { useFaviconProgress } = await import("../../src/hooks/useFaviconProgress.js");
    const { result } = renderHook(() => useFaviconProgress(null));

    // Hook renders without error and the favicon is unchanged
    expect(result.current).toBeUndefined();
    const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    expect(link?.href).toContain("original-favicon");
  });

  it("updates the favicon href when progress is active", async () => {
    const { useFaviconProgress } = await import("../../src/hooks/useFaviconProgress.js");
    const { result, rerender } = renderHook(({ p }) => useFaviconProgress(p), {
      initialProps: { p: 50 as number | null },
    });

    const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    expect(link?.href).toBe("data:image/png;base64,test");
    expect(result.current).toBeUndefined();
  });

  it("restores the original favicon when progress becomes null after being active", async () => {
    const { useFaviconProgress } = await import("../../src/hooks/useFaviconProgress.js");
    const { rerender } = renderHook(({ p }) => useFaviconProgress(p), {
      initialProps: { p: 75 as number | null },
    });

    // Confirm progress favicon was applied
    let link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    expect(link?.href).toBe("data:image/png;base64,test");

    // Transition to null (upload done / cancelled)
    act(() => {
      rerender({ p: null });
    });

    link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    expect(link?.href).toContain("original-favicon");
  });
});
