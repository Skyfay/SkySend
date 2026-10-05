import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/api.js", () => ({
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
  uploadInit: vi.fn(async () => ({ id: "http-upload" })),
  uploadChunk: vi.fn(async () => {}),
  uploadFinalize: vi.fn(async () => {}),
  saveMeta: vi.fn(async () => {}),
}));

// The CLI keeps WebSocket uploads off for now. Turning them on here shows which
// transport the flag picks once they return.
vi.mock("../../src/lib/config.js", () => ({
  resolveServer: vi.fn(() => "http://127.0.0.1:3000"),
  getWebSocket: vi.fn(() => true),
}));

vi.mock("../../src/lib/ws-upload.js", () => ({
  uploadWsTransport: vi.fn(async () => ({ id: "ws-upload" })),
}));

vi.mock("../../src/lib/history.js", () => ({ addUpload: vi.fn() }));

import { uploadChunk } from "../../src/lib/api.js";
import { uploadWsTransport } from "../../src/lib/ws-upload.js";
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
  it("uses HTTP chunks with --no-ws", async () => {
    await upload("--no-ws");

    expect(uploadWsTransport).not.toHaveBeenCalled();
    expect(uploadChunk).toHaveBeenCalledOnce();
  });

  it("uses the WebSocket transport without --no-ws when it is available", async () => {
    await upload();

    expect(uploadWsTransport).toHaveBeenCalledOnce();
    expect(uploadChunk).not.toHaveBeenCalled();
  });
});
