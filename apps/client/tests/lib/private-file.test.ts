import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writePrivateFile } from "../../src/lib/private-file.js";

const mode = (target: string) => fs.statSync(target).mode & 0o777;

describe.skipIf(process.platform === "win32")("writePrivateFile", () => {
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "skysend-private-file-test-"));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("creates the file for the user only, in a folder only the user may enter", () => {
    const file = path.join(base, "skysend", "history.json");
    writePrivateFile(file, '{"uploads":[]}\n');
    expect(fs.readFileSync(file, "utf-8")).toBe('{"uploads":[]}\n');
    expect(mode(file)).toBe(0o600);
    expect(mode(path.dirname(file))).toBe(0o700);
  });

  it("narrows a file and a folder an older version left readable for everyone", () => {
    const dir = path.join(base, "skysend");
    const file = path.join(dir, "history.json");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    fs.writeFileSync(file, "old", { mode: 0o644 });
    fs.chmodSync(file, 0o644);

    writePrivateFile(file, "new");
    expect(fs.readFileSync(file, "utf-8")).toBe("new");
    expect(mode(file)).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
  });
});
