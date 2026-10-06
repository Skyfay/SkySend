// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ReadBlock } from "@skysend/note-format";
import { HIGHLIGHT_BUDGET, MAX_HIGHLIGHT_LENGTH, highlightAs, highlightCode, highlightedBlocks } from "../../src/lib/highlight";

describe("highlightAs", () => {
  it("highlights a language highlight.js knows", () => {
    const html = highlightAs("const answer = 42;", "javascript");
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it("returns null for a language it does not know", () => {
    expect(highlightAs("x", "no-such-language")).toBeNull();
    expect(highlightAs("x", "__proto__")).toBeNull();
  });
});

describe("highlightCode", () => {
  it("keeps the language the block was set to", () => {
    expect(highlightCode("SELECT 1;", "sql").language).toBe("sql");
  });

  it("detects the language for auto", () => {
    const result = highlightCode('{ "name": "skysend", "private": true }', "auto");
    expect(result.language).not.toBe("auto");
    expect(result.html).toContain("<span");
  });

  it("calls code without a detectable language plain text", () => {
    expect(highlightCode("", "auto")).toEqual({ html: "", language: "plaintext" });
  });

  it("falls back to detection for an unknown language and still shows its name", () => {
    const result = highlightCode("echo hi", "klingon");
    expect(result.language).toBe("klingon");
    expect(result.html).toContain("echo");
  });

  it("never lets markup from the note through", () => {
    const code = '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">y</a>';
    for (const language of ["auto", "html", "javascript", "plaintext"]) {
      const { html } = highlightCode(code, language);
      const container = document.createElement("div");
      container.innerHTML = html;
      expect(container.querySelector("script, img, a, [onerror], [href]")).toBeNull();
      expect([...container.querySelectorAll("*")].every((el) => el.tagName === "SPAN")).toBe(true);
      expect(container.textContent).toBe(code);
    }
  });

  it("shows code above the length limit escaped and without highlighting", () => {
    // Repeated quotes make highlight.js take seconds. Above the limit it never runs.
    const code = `<b>${'"'.repeat(MAX_HIGHLIGHT_LENGTH)}</b>`;
    const started = performance.now();
    expect(highlightAs(code, "csharp")).toBeNull();
    const result = highlightCode(code, "auto");
    expect(performance.now() - started).toBeLessThan(200);
    expect(result.language).toBe("plaintext");
    expect(result.html.startsWith("&lt;b&gt;")).toBe(true);
    expect(highlightCode(code, "bash").language).toBe("bash");
  });

  it("shows code plain when the note has no highlighting left for it", () => {
    expect(highlightCode("a < b && c", "auto", false)).toEqual({ html: "a &lt; b &amp;&amp; c", language: "plaintext" });
  });

  it("copes with a language name from a crafted note", () => {
    for (const name of ["__proto__", "constructor"]) {
      expect(highlightCode("echo hi", name).html).toContain("echo");
    }
  });
});

describe("highlightedBlocks", () => {
  const code = (length: number): ReadBlock => ({ type: "code", title: "", language: "auto", code: "x".repeat(length) });
  const markdown = (length: number): ReadBlock => ({ type: "text", format: "markdown", text: "x".repeat(length) });

  it("highlights code and Markdown while the note's budget lasts", () => {
    const half = HIGHLIGHT_BUDGET / 2;
    expect(highlightedBlocks([code(half), markdown(half), code(1)])).toEqual([true, true, false]);
  });

  it("skips a block above the limit and keeps the budget for the others", () => {
    expect(highlightedBlocks([code(MAX_HIGHLIGHT_LENGTH + 1), code(10)])).toEqual([false, true]);
  });

  it("never highlights blocks without code", () => {
    const blocks: ReadBlock[] = [
      { type: "text", format: "plain", text: "plain" },
      { type: "password", entries: [] },
      { type: "unsupported" },
      code(0),
    ];
    expect(highlightedBlocks(blocks)).toEqual([false, false, false, false]);
  });
});
