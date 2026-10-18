import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@skysend/transfer";

// The API of the server, the way apiFor(server) hands it out.
const server = vi.hoisted(() => ({
  deleteUpload: vi.fn(async () => {}),
  deleteNote: vi.fn(async () => {}),
}));

vi.mock("../../src/lib/api.js", () => ({ apiFor: vi.fn(() => server) }));
vi.mock("../../src/lib/history.js", () => ({ removeUpload: vi.fn(), removeNote: vi.fn() }));

import { removeNote, removeUpload } from "../../src/lib/history.js";
import { registerDeleteCommand } from "../../src/commands/delete.js";

const FILE = "https://send.example.com/file/11111111-2222-4333-8444-555555555555#secret";
const NOTE = "https://send.example.com/note/66666666-7777-4888-9999-000000000000#secret";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function remove(url: string) {
  const program = new Command();
  registerDeleteCommand(program);
  await program.parseAsync(["node", "skysend", "delete", url, "owner-token", "--json"]);
}

describe("skysend delete", () => {
  it("takes a deleted upload off the history", async () => {
    await remove(FILE);
    expect(server.deleteUpload).toHaveBeenCalledWith(
      "11111111-2222-4333-8444-555555555555",
      "owner-token",
    );
    expect(removeUpload).toHaveBeenCalledWith("11111111-2222-4333-8444-555555555555");
    expect(removeNote).not.toHaveBeenCalled();
  });

  it("takes a deleted note off the history", async () => {
    await remove(NOTE);
    expect(server.deleteNote).toHaveBeenCalled();
    expect(removeNote).toHaveBeenCalledWith("66666666-7777-4888-9999-000000000000");
    expect(removeUpload).not.toHaveBeenCalled();
  });

  it("keeps the entry when the server did not delete it", async () => {
    server.deleteUpload.mockRejectedValueOnce(new ApiError(403, "Invalid owner token"));
    await expect(remove(FILE)).rejects.toThrow("process.exit(1)");
    expect(removeUpload).not.toHaveBeenCalled();
  });
});
