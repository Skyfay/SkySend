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

  it("offers auto detection first", () => {
    expect(CODE_LANGUAGES[0]?.value).toBe("auto");
  });
});
