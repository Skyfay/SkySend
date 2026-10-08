// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../../src/lib/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the Clipboard API when the browser offers it", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("secret");
    expect(writeText).toHaveBeenCalledWith("secret");
  });

  it("falls back to a text area that it removes again when the Clipboard API is missing", async () => {
    vi.stubGlobal("navigator", {});
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    let copied = "";
    execCommand.mockImplementation(() => {
      copied = (document.querySelector("textarea") as HTMLTextAreaElement).value;
      return true;
    });

    await copyText("from the fallback");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe("from the fallback");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the browser refuses the Clipboard API", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    await copyText("x");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
