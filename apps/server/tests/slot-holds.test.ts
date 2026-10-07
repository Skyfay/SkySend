import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlotHolds, SLOT_HOLD_PATTERN, SLOT_HOLD_TTL_MS } from "../src/lib/slot-holds.js";

describe("createSlotHolds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands out a token that only its request can take, once", () => {
    const holds = createSlotHolds(() => {});
    const token = holds.hold("request-a");
    expect(token).toMatch(SLOT_HOLD_PATTERN);
    expect(holds.take(token, "request-b")).toBeNull();
    expect(holds.take(token, "request-a")).toMatchObject({ token });
    expect(holds.take(token, "request-a")).toBeNull();
  });

  it("takes a hold given back again, with the time it had left", () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const holds = createSlotHolds((id) => expired.push(id), 10 * 60_000);
    const token = holds.hold("request-a");
    vi.advanceTimersByTime(6 * 60_000);
    const taken = holds.take(token, "request-a")!;
    holds.giveBack("request-a", taken);
    expect(holds.take(token, "request-a")).toEqual(taken);
    holds.giveBack("request-a", taken);
    // Giving it back did not start its time again.
    vi.advanceTimersByTime(5 * 60_000);
    expect(expired).toEqual(["request-a"]);
    expect(holds.take(token, "request-a")).toBeNull();
  });

  it("gives the slot of a hold nobody takes back to its request", () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const holds = createSlotHolds((id) => expired.push(id));
    const token = holds.hold("request-a");
    holds.hold("request-b");
    vi.advanceTimersByTime(SLOT_HOLD_TTL_MS + 60_000);
    expect(expired.sort()).toEqual(["request-a", "request-b"]);
    expect(holds.take(token, "request-a")).toBeNull();
  });

  it("refuses a hold that ran out before the sweep reached it", () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const holds = createSlotHolds((id) => expired.push(id), 1000);
    const token = holds.hold("request-a");
    vi.setSystemTime(Date.now() + 1001);
    expect(holds.take(token, "request-a")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(expired).toEqual(["request-a"]);
  });
});
