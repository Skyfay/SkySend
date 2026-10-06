// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { highlightAs, highlightCode } from "../../src/lib/highlight";

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
});
