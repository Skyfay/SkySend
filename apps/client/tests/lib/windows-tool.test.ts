import { afterEach, describe, expect, it, vi } from "vitest";
import { systemTool } from "../../src/lib/windows-tool.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("systemTool", () => {
  it("names the program by its full path in System32", () => {
    vi.stubEnv("SystemRoot", "D:\\WINDOWS");
    expect(systemTool("clip.exe")).toBe("D:\\WINDOWS\\System32\\clip.exe");
  });

  it("falls back to C:\\Windows without SystemRoot", () => {
    vi.stubEnv("SystemRoot", undefined);
    expect(systemTool("cmd.exe")).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});
