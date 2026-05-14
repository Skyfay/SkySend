// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast, toast } from "../../src/hooks/useToast.js";

// useToast uses module-level state (memoryState, listeners, toastTimeouts).
// Fake timers let us control TOAST_REMOVE_DELAY (3 s) deterministically and
// also flush leftover toasts between tests so state doesn't leak.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Advance past both TOAST_REMOVE_DELAY windows (dismiss + remove queue)
  // so memoryState.toasts is empty before the next test.
  act(() => {
    vi.advanceTimersByTime(7_000);
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useToast", () => {
  it("starts with an empty toast list", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toHaveLength(0);
  });

  it("adds a toast and marks it open", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Hello", description: "World" });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.title).toBe("Hello");
    expect(result.current.toasts[0]?.open).toBe(true);
  });

  it("caps the toast list at TOAST_LIMIT (5)", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      for (let i = 0; i < 7; i++) toast({ title: `Toast ${i}` });
    });

    expect(result.current.toasts.length).toBeLessThanOrEqual(5);
  });

  it("dismiss() via returned handle sets open=false", () => {
    const { result } = renderHook(() => useToast());

    let handle!: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: "Test" });
    });

    act(() => {
      handle.dismiss();
    });

    expect(result.current.toasts[0]?.open).toBe(false);
  });

  it("auto-removes toast from the list after TOAST_REMOVE_DELAY", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Temp" });
    });
    expect(result.current.toasts).toHaveLength(1);

    // Advance past auto-dismiss (3 s) + remove-queue delay (3 s)
    act(() => {
      vi.advanceTimersByTime(6_100);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("update() changes toast properties in place", () => {
    const { result } = renderHook(() => useToast());

    let handle!: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: "Original" });
    });

    act(() => {
      handle.update({ title: "Updated" });
    });

    expect(result.current.toasts[0]?.title).toBe("Updated");
  });

  it("dismiss() from the hook dismisses a toast by id", () => {
    const { result } = renderHook(() => useToast());

    let id!: string;
    act(() => {
      id = toast({ title: "X" }).id;
    });

    act(() => {
      result.current.dismiss(id);
    });

    expect(result.current.toasts[0]?.open).toBe(false);
  });

  it("unmount entfernt Listener \u2192 kein Crash nach Unmount", () => {
    const { result, unmount } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Before unmount" });
    });
    expect(result.current.toasts).toHaveLength(1);

    // Unmounting removes the setState listener from the listeners array
    unmount();

    // Dispatching after unmount must not throw
    expect(() => {
      act(() => {
        toast({ title: "After unmount" });
      });
    }).not.toThrow();
  });
});
