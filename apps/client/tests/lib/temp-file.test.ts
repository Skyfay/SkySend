import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrivateTempFile, type PrivateTempFile } from "../../src/lib/temp-file.js";

describe("createPrivateTempFile", () => {
  const created: PrivateTempFile[] = [];
  const make = (name = "upload.zip") => {
    const tmp = createPrivateTempFile(name);
    created.push(tmp);
    return tmp;
  };

  afterEach(() => {
    for (const tmp of created.splice(0)) tmp.cleanup();
  });

  it("creates the file in its own directory under the system temp directory", () => {
    const tmp = make();
    const dir = path.dirname(tmp.path);
    expect(path.basename(tmp.path)).toBe("upload.zip");
    expect(path.dirname(dir)).toBe(os.tmpdir());
    expect(path.basename(dir).startsWith("skysend-")).toBe(true);
    expect(fs.existsSync(tmp.path)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "lets only the current user read the file or list its directory",
    () => {
      const tmp = make();
      expect(fs.statSync(tmp.path).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(tmp.path)).mode & 0o777).toBe(0o700);
    },
  );

  it("gives every call a fresh directory", () => {
    const a = make();
    const b = make();
    expect(path.dirname(a.path)).not.toBe(path.dirname(b.path));
  });

  it("writes through the returned descriptor", () => {
    const tmp = make();
    fs.writeSync(tmp.fd, "plaintext");
    tmp.close();
    expect(fs.readFileSync(tmp.path, "utf-8")).toBe("plaintext");
  });

  it("removes the file and its directory, also with the descriptor still open", () => {
    const tmp = make();
    fs.writeSync(tmp.fd, "plaintext");
    tmp.cleanup();
    expect(fs.existsSync(tmp.path)).toBe(false);
    expect(fs.existsSync(path.dirname(tmp.path))).toBe(false);
  });

  it("can be closed and cleaned up more than once", () => {
    const tmp = make();
    tmp.close();
    expect(() => tmp.close()).not.toThrow();
    tmp.cleanup();
    expect(() => tmp.cleanup()).not.toThrow();
  });

  it("removes the file when the process exits, which is how Ctrl+C ends the TUI", () => {
    const before = process.listeners("exit");
    const tmp = make();
    const added = process.listeners("exit").filter((l) => !before.includes(l));
    expect(added).toHaveLength(1);

    (added[0] as () => void)();
    expect(fs.existsSync(path.dirname(tmp.path))).toBe(false);
    expect(process.listeners("exit")).not.toContain(added[0]);
  });

  it("stops listening for exit once cleaned up", () => {
    const count = process.listenerCount("exit");
    const tmp = make();
    expect(process.listenerCount("exit")).toBe(count + 1);
    tmp.cleanup();
    expect(process.listenerCount("exit")).toBe(count);
  });
});
