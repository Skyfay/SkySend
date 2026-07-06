export const NEVER_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

/** Convert an expiry duration to a persisted timestamp. A value of 0 means never. */
export function createExpiresAt(expireSec: number, now = new Date()): Date {
  if (expireSec === 0) return NEVER_EXPIRES_AT;
  return new Date(now.getTime() + expireSec * 1000);
}
