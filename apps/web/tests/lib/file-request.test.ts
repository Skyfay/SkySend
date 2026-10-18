import { describe, expect, it } from "vitest";
import { openInboxLink } from "@skysend/transfer";
import { requestOutlived } from "../../src/lib/file-request.js";
import { hashWasmArgon2 } from "../../src/lib/argon2.js";
import frozen from "../fixtures/frozen-passwords.json";

// Creating a request and opening its inbox are tested in packages/transfer. Here stays what
// only this browser does, and the inbox link of v3.0 opened with the Argon2id of the page.

describe("an inbox link people kept", () => {
  it("still opens an inbox link with a password from v3.0, with the real Argon2id", async () => {
    const { fragment, password, inboxToken, ownerToken } = frozen.inbox;
    const access = await openInboxLink(fragment, password, hashWasmArgon2);
    expect(access.inboxToken).toBe(inboxToken);
    expect(access.ownerToken).toBe(ownerToken);
  }, 30_000);

});

describe("requestOutlived", () => {
  const DAY = 24 * 60 * 60_000;
  const closesAt = "2026-10-01T00:00:00.000Z";
  const closed = Date.parse(closesAt);

  it("forgets a request only a day after its last upload ran out", () => {
    const retention = 7 * 24 * 3600;
    expect(requestOutlived(closesAt, retention, closed + 8 * DAY)).toBe(false);
    expect(requestOutlived(closesAt, retention, closed + 8 * DAY + 1)).toBe(true);
    expect(requestOutlived(closesAt, retention, closed - DAY)).toBe(false);
  });

  it("forgets nothing without the retention or with a date it cannot read", () => {
    expect(requestOutlived(closesAt, undefined, closed + 365 * DAY)).toBe(false);
    // A server that sends no retention reads as 0 through the config schema.
    expect(requestOutlived(closesAt, 0, closed + 365 * DAY)).toBe(false);
    expect(requestOutlived("not a date", 604_800, closed + 365 * DAY)).toBe(false);
  });
});
