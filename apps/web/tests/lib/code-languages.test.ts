import { describe, expect, it } from "vitest";
import { CODE_LANGUAGES, languageLabel } from "../../src/lib/code-languages";

describe("languageLabel", () => {
  it("names a language from the list", () => {
    expect(languageLabel("typescript")).toBe("TypeScript");
    expect(languageLabel("csharp")).toBe("C#");
  });

  it("keeps a name that is not in the list as it is", () => {
    expect(languageLabel("klingon")).toBe("klingon");
  });

  it("keeps a name from a crafted note that matches an object property as it is", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(languageLabel(name)).toBe(name);
    }
  });

  it("offers auto detection first", () => {
    expect(CODE_LANGUAGES[0]?.value).toBe("auto");
  });
});
