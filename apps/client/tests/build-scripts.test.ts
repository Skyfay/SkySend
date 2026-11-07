import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("compiled binary", () => {
  // A binary from `bun build --compile` reads bunfig.toml and .env from the folder it runs in,
  // and a bunfig.toml can preload a script. Downloads land in that folder under the sender's
  // name, so a received bunfig.toml and script ran on the next start of skysend there.
  it("never reads bunfig.toml or .env from the current folder", () => {
    const compiles = Object.entries(pkg.scripts).filter(([, script]) => script.includes("--compile"));
    expect(compiles.length).toBeGreaterThan(0);
    for (const [, script] of compiles) {
      expect(script).toContain("--no-compile-autoload-bunfig");
      expect(script).toContain("--no-compile-autoload-dotenv");
    }
  });
});
