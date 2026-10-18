import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedUpload } from "@skysend/transfer";

// An inbox with one zip whose names a sender wrote to fool a terminal.
const archive = vi.hoisted(() => ({
  upload: {
    id: "upload-1",
    size: 4096,
    downloadCount: 0,
    maxDownloads: 3,
    createdAt: "2026-10-18T00:00:00.000Z",
  },
  file: {
    metadata: {
      type: "archive",
      files: [
        { name: "report\u009b31m.txt", size: 10 },
        { name: "invoice\u202efdp.exe", size: 20 },
      ],
      totalSize: 30,
      archiveSize: 300,
    },
  },
}));

vi.mock("../../src/lib/inbox-job.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/inbox-job.js")>()),
  readInboxLink: vi.fn(() => ({
    server: "https://send.example.com",
    id: "r",
    fragment: "f",
    needsPassword: false,
  })),
  openInboxFrom: vi.fn(async () => ({
    opened: { title: "Logs", asks: ["files"], uploads: [archive] },
  })),
  inboxEntries: vi.fn(() => [[archive as unknown as OpenedUpload]]),
}));

import { registerInboxCommand } from "../../src/commands/inbox.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("skysend inbox --json", () => {
  it("cleans the names inside a zip like every other name a sender wrote", async () => {
    const program = new Command();
    registerInboxCommand(program);
    await program.parseAsync([
      "node",
      "skysend",
      "inbox",
      "https://send.example.com/inbox/r#f",
      "--json",
    ]);

    const printed = vi.mocked(console.log).mock.calls[0]![0] as string;
    // JSON escapes ESC, but not the C1 controls or the reordering marks.
    expect(printed).not.toMatch(/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/);
    const { uploads } = JSON.parse(printed) as { uploads: Array<{ files: string[] }> };
    expect(uploads[0]!.files).toEqual(["report31m.txt", "invoicefdp.exe"]);
  });
});
