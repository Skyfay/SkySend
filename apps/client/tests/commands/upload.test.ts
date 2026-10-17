import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The API of the server, the way apiFor(server) hands it out.
const server = vi.hoisted(() => ({
  fetchConfig: vi.fn(async () => ({
    fileUploadWs: true,
    oidcProtectFiles: false,
    forceFilePassword: false,
    fileDefaultExpire: 86400,
    fileExpireOptions: [86400],
    fileDefaultDownload: 1,
    fileDownloadOptions: [1],
    fileMaxSize: 1024 ** 3,
    fileUploadConcurrentChunks: 3,
  })),
}));

vi.mock("../../src/lib/api.js", () => ({ apiFor: vi.fn(() => server) }));

vi.mock("../../src/lib/config.js", () => ({
  resolveServer: vi.fn(() => "http://127.0.0.1:3000"),
  getWebSocket: vi.fn(() => true),
}));

vi.mock("../../src/lib/upload-job.js", () => ({
  runUpload: vi.fn(async () => ({
    id: "upload",
    url: "http://127.0.0.1:3000/file/upload#secret",
    ownerToken: "owner",
    names: ["note.txt"],
    size: 5,
    totalSize: 5,
    fileCount: 1,
    hasPassword: false,
    transport: "ws",
  })),
}));

vi.mock("../../src/lib/history.js", () => ({ addUpload: vi.fn() }));

import { getWebSocket } from "../../src/lib/config.js";
import { runUpload } from "../../src/lib/upload-job.js";
import { registerUploadCommand } from "../../src/commands/upload.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skysend-upload-"));
  file = join(dir, "note.txt");
  writeFileSync(file, "hello");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function upload(...flags: string[]) {
  const program = new Command();
  registerUploadCommand(program);
  await program.parseAsync(["node", "skysend", "upload", "--json", ...flags, file]);
}

describe("skysend upload", () => {
  it("keeps the upload off the WebSocket with --no-ws", async () => {
    await upload("--no-ws");
    expect(vi.mocked(runUpload).mock.calls[0]![0]).toMatchObject({ webSocket: false });
  });

  it("keeps the upload off the WebSocket where the settings switched it off", async () => {
    vi.mocked(getWebSocket).mockReturnValueOnce(false);
    await upload();
    expect(vi.mocked(getWebSocket)).toHaveBeenCalledWith("http://127.0.0.1:3000");
    expect(vi.mocked(runUpload).mock.calls[0]![0]).toMatchObject({ webSocket: false });
  });

  it("lets the upload take the WebSocket without --no-ws", async () => {
    await upload();
    expect(vi.mocked(runUpload).mock.calls[0]![0]).toMatchObject({
      webSocket: true,
      paths: [file],
      expireSec: 86400,
      maxDownloads: 1,
    });
  });

  it("prints the link and what was sent as one JSON object", async () => {
    await upload();
    const printed = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
    expect(printed).toMatchObject({
      id: "upload",
      url: "http://127.0.0.1:3000/file/upload#secret",
      size: 5,
      fileCount: 1,
      expires: 86400,
      maxDownloads: 1,
      hasPassword: false,
      transport: "ws",
    });
  });
});
