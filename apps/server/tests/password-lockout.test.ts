import { describe, it, expect, vi, afterEach } from "vitest";
import { createPasswordLockout } from "../src/lib/password-lockout.js";

describe("password lockout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("check() returns { locked: false } once the lockout period has expired (lazy cleanup on read)", () => {
    vi.useFakeTimers();
    // 2 attempts, 1 s lockout
    const lockout = createPasswordLockout(2, 1000);

    lockout.recordFailure("upload:abc", "1.2.3.4");
    lockout.recordFailure("upload:abc", "1.2.3.4"); // triggers lockout

    expect(lockout.check("upload:abc", "1.2.3.4").locked).toBe(true);

    // Advance the clock past the lockout period
    vi.advanceTimersByTime(1001);

    // check() should detect the expired entry, remove it, and return not locked
    const result = lockout.check("upload:abc", "1.2.3.4");
    expect(result.locked).toBe(false);
  });

  it("cleanup interval removes stale locked entries from the store", () => {
    vi.useFakeTimers();
    // 2 attempts, 1 s lockout - cleanup runs every lockoutMs * 2 = 2 s
    const lockout = createPasswordLockout(2, 1000);

    lockout.recordFailure("upload:abc", "1.2.3.4");
    lockout.recordFailure("upload:abc", "1.2.3.4"); // triggers lockout

    // Advance past the cleanup interval (1000 * 2 + 1 ms)
    vi.advanceTimersByTime(2001);

    // The cleanup interval fired and deleted the stale entry.
    // check() returns not locked because the entry is gone.
    const result = lockout.check("upload:abc", "1.2.3.4");
    expect(result.locked).toBe(false);
  });
});
