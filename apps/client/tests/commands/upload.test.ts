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
  openRequest: vi.fn(async () => ({
    server: "https://send.example.com",
    id: "request",
    access: { publicKey: new Uint8Array(65), uploadToken: "token" },
    status: { open: true, uploadsLeft: 2, maxUploadSize: 1024, maxFilesPerUpload: 32 },
    brief: { title: "Logs", asks: ["files"], template: null },
    config: {},
  })),
  runRequestUpload: vi.fn(async () => ({
    id: "delivered",
    names: ["note.txt"],
    size: 5,
    totalSize: 5,
    fileCount: 1,
    transport: "http",
  })),
}));

vi.mock("../../src/lib/history.js", () => ({ addUpload: vi.fn() }));

import { getWebSocket } from "../../src/lib/config.js";
import { openRequest, runRequestUpload, runUpload } from "../../src/lib/upload-job.js";
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

describe("skysend upload --to", () => {
  const LINK = "https://send.example.com/request/request#fragment";

  it("sends into the request of the link and prints what was delivered", async () => {
    await upload("--to", LINK);
    expect(openRequest).toHaveBeenCalledWith(LINK);
    expect(vi.mocked(runRequestUpload).mock.calls[0]![0]).toMatchObject({
      paths: [file],
      webSocket: true,
    });
    expect(runUpload).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string)).toEqual({
      delivered: true,
      id: "delivered",
      size: 5,
      fileCount: 1,
      transport: "http",
    });
  });

  it("refuses options the request decides itself", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const flags of [["--password", "x"], ["--expires", "1d"], ["--downloads", "3"]]) {
      await expect(upload("--to", LINK, ...flags)).rejects.toThrow("process.exit(1)");
    }
    expect(openRequest).not.toHaveBeenCalled();
  });
});
