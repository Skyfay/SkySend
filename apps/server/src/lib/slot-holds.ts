import { randomBytes } from "node:crypto";

/** How long the second slot of a submission waits once its first part arrived. */
export const SLOT_HOLD_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

/** The token of a held slot, 16 random bytes as base64url. */
export const SLOT_HOLD_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** A hold an upload took, with the time it runs out. */
export interface SlotHold {
  token: string;
  expiresAt: number;
}

/**
 * Slots held for the second part of a submission. Files and a note sent together take two
 * slots, and the files reserve both, so the note still finds its slot when other senders
 * fill the request meanwhile. In memory, like upload sessions, since a restart resets every
 * reservation anyway. A hold nobody takes runs out and gives its slot back.
 */
export function createSlotHolds(onExpire: (requestId: string) => void, ttlMs = SLOT_HOLD_TTL_MS) {
  const holds = new Map<string, { requestId: string; expiresAt: number }>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [token, hold] of holds) {
      if (hold.expiresAt > now) continue;
      holds.delete(token);
      onExpire(hold.requestId);
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();

  return {
    /** Holds a slot of the request under a new token, for the time a hold lasts. */
    hold(requestId: string): string {
      const token = randomBytes(16).toString("base64url");
      holds.set(token, { requestId, expiresAt: Date.now() + ttlMs });
      return token;
    },
    /**
     * Takes the slot behind the token, if it is still held for this request. Returns the hold,
     * so an upload that does not finish can give it back as it was.
     */
    take(token: string, requestId: string): SlotHold | null {
      const hold = holds.get(token);
      if (!hold || hold.requestId !== requestId || hold.expiresAt <= Date.now()) return null;
      holds.delete(token);
      return { token, expiresAt: hold.expiresAt };
    },
    /** Gives a hold back with the time it had left, so giving it back never extends it. */
    giveBack(requestId: string, hold: SlotHold): void {
      holds.set(hold.token, { requestId, expiresAt: hold.expiresAt });
    },
  };
}
