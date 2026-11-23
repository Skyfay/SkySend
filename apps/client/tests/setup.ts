import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, vi } from "vitest";

// The tests must never touch the real ~/.config/skysend of whoever runs them. Most of them point
// XDG_CONFIG_HOME at a folder of their own, but a test that clears it, a worker thread that does
// not share the environment, or a mutant of the mutation tests falls back to os.homedir(). Here
// that is a temporary folder as well.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  // os.homedir() reads the environment of the process, which a worker thread does not share, so
  // it follows HOME as the tests set it.
  const homedir = (): string => {
    const home = process.env["HOME"];
    if (!home) throw new Error("HOME is not set in the client tests");
    return home;
  };
  return { ...actual, default: { ...actual, homedir }, homedir };
});

const fakeHome = mkdtempSync(join(tmpdir(), "skysend-client-home-"));
process.env["HOME"] = fakeHome;
process.env["XDG_CONFIG_HOME"] = join(fakeHome, ".config");

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});
