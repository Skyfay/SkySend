import { describe, expect, it } from "vitest";
import { forTerminal } from "../../src/lib/terminal.js";

describe("forTerminal", () => {
  it("keeps text, tabs and line breaks", () => {
    expect(forTerminal("line one\n\tline two")).toBe("line one\n\tline two");
    expect(forTerminal("windows\r\nline")).toBe("windows\nline");
  });

  it("makes escape sequences and bidirectional overrides visible instead of running them", () => {
    expect(forTerminal("safe\x1b[8mhidden\x1b[0m")).toBe("safe\uFFFD[8mhidden\uFFFD[0m");
    expect(forTerminal("\x1b]8;;https://evil.example\x07link")).toBe(
      "\uFFFD]8;;https://evil.example\uFFFDlink",
    );
    expect(forTerminal("a\rb\bc\x7fd\x9be")).toBe("a\uFFFDb\uFFFDc\uFFFDd\uFFFDe");
    expect(forTerminal("rm -rf /\u202Etxt.exe")).toBe("rm -rf /\uFFFDtxt.exe");
  });

  it("disarms a clipboard write and a line rewrite hidden in a file name", () => {
    const name = "report.pdf\x1b]52;c;Y3VybCBldmlsLnNofHNo\x07\r\x1b[2KInnocent.pdf";
    const shown = forTerminal(name);
    // eslint-disable-next-line no-control-regex
    expect(shown).not.toMatch(/[\x00-\x1F\x7F-\x9F]/);
    expect(shown).toBe(
      "report.pdf\uFFFD]52;c;Y3VybCBldmlsLnNofHNo\uFFFD\uFFFD\uFFFD[2KInnocent.pdf",
    );
  });
});
