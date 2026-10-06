import { describe, expect, it } from "vitest";
import { findPrivateKey } from "../src/index.js";

// The regex notes before v3 and the CLI client used. findPrivateKey() must match it exactly.
const V2_REGEX = /(-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----)/;

const regexMatch = (text: string) => text.match(V2_REGEX)?.[1];

const OPENSSH = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";
const PKCS8 = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIFHzBJBgkqhkiG9w0BBQ0w\n-----END ENCRYPTED PRIVATE KEY-----";

// A small deterministic generator, so a failure names a seed that reproduces it.
function random(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % max;
  };
}

// Two sets: one close to real keys that matches often, one with stray fragments.
const PIECE_SETS = [
  ["-----BEGIN", "-----END", "PRIVATE KEY-----", "PRIVATE KEY-----", "\n", " x", "-----"],
  ["-----BEGIN", "-----END", "PRIVATE KEY-----", " RSA ", "-", "\n", "x", " ", "KEY", "-----"],
];

describe("findPrivateKey", () => {
  it("finds the key in the forms SSH keys are shared", () => {
    expect(findPrivateKey(`ssh-ed25519 AAAA user@host\n\n${OPENSSH}`)).toBe(OPENSSH);
    expect(findPrivateKey(`${PKCS8}\n\nPassphrase: s3cret`)).toBe(PKCS8);
    expect(findPrivateKey("ssh-ed25519 AAAA user@host")).toBeUndefined();
    expect(findPrivateKey("")).toBeUndefined();
  });

  it("returns what the regex of v2 matched, for every input", () => {
    const cases = [
      `${OPENSSH}\n${OPENSSH}`,
      "-----BEGIN PRIVATE KEY-----END PRIVATE KEY-----",
      "-----BEGIN PRIVATE KEY----- PRIVATE KEY-----\n-----END PRIVATE KEY----- PRIVATE KEY-----",
      "-----BEGIN PRIVATE KEY-----\n-----BEGIN PRIVATE KEY-----\n-----END x\n-----END PRIVATE KEY-----",
      "-----BEGIN PRIVATE KEY-----x-----END PRIVATE KEY----- PRIVATE KEY-----",
      "-----BEGIN-----END PRIVATE KEY-----",
      "------BEGIN PRIVATE KEY-----\n------END PRIVATE KEY-----",
    ];
    for (const text of cases) expect(findPrivateKey(text), JSON.stringify(text)).toBe(regexMatch(text));

    let matched = 0;
    for (const pieces of PIECE_SETS) {
      for (let seed = 1; seed <= 30000; seed += 1) {
        const next = random(seed);
        const text = Array.from({ length: 2 + next(12) }, () => pieces[next(pieces.length)]).join("");
        const expected = regexMatch(text);
        if (expected !== undefined) matched += 1;
        expect(findPrivateKey(text), `seed ${seed}: ${JSON.stringify(text)}`).toBe(expected);
      }
    }
    // Enough of the inputs hold a key that the matching path is exercised, not only misses.
    expect(matched).toBeGreaterThan(1000);
  });

  it("stays fast on a crafted megabyte that makes the regex run for days", () => {
    const begins = "-----BEGIN PRIVATE KEY-----".repeat(40000);
    const ends = `-----BEGIN PRIVATE KEY-----\n${"-----END ".repeat(110000)}`;
    const lines = "-----BEGIN PRIVATE KEY-----\n".repeat(38000);
    const started = performance.now();
    expect(findPrivateKey(begins)).toBeUndefined();
    expect(findPrivateKey(ends)).toBeUndefined();
    expect(findPrivateKey(lines)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
