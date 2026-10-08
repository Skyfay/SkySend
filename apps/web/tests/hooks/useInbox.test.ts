// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../src/lib/api.js", () => ({
  fetchInbox: vi.fn(),
  downloadInboxFile: vi.fn(),
  deleteInboxFile: vi.fn().mockResolvedValue(undefined),
  closeRequest: vi.fn().mockResolvedValue(undefined),
  deleteRequest: vi.fn().mockResolvedValue(undefined),
  inboxFilePath: (id: string, uploadId: string) => `/api/inbox/${id}/file/${uploadId}`,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("../../src/lib/file-request.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/file-request.js")>();
  return {
    ...original,
    inboxNeedsPassword: vi.fn(),
    openInboxLink: vi.fn(),
    openInbox: vi.fn(),
    readInboxNote: vi.fn(),
  };
});

vi.mock("../../src/lib/download-tiers.js", () => ({
  saveDecryptedDownload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/upload-store.js", () => ({
  getRequest: vi.fn().mockResolvedValue(undefined),
  removeRequest: vi.fn().mockResolvedValue(undefined),
  markUploadsSeen: vi.fn().mockResolvedValue(null),
}));

import * as api from "../../src/lib/api.js";
import * as fileRequest from "../../src/lib/file-request.js";
import { saveDecryptedDownload } from "../../src/lib/download-tiers.js";
import { getRequest, markUploadsSeen, removeRequest } from "../../src/lib/upload-store.js";
import { keepUnseen, setUnseen, unseenFor } from "../../src/lib/unseen-uploads.js";
import { downloadName, useInbox } from "../../src/hooks/useInbox.js";
import type { OpenedUpload } from "../../src/lib/file-request.js";

const ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const UPLOAD_ID = "11111111-2222-4333-8444-555555555555";
const argon2 = vi.fn();

const access = { keys: {} as never, inboxToken: "inbox-token", ownerToken: "owner-token" };

function inbox(): api.Inbox {
  return {
    vault: "v",
    vaultNonce: "n",
    title: null,
    hasPassword: false,
    open: true,
    closesAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    maxUploads: 3,
    maxSize: 4096,
    usedUploads: 1,
    usedBytes: 50,
    uploads: [],
  };
}

function entry(name = "report.pdf"): OpenedUpload {
  return {
    upload: {
      id: UPLOAD_ID,
      size: 50,
      fileCount: 1,
      salt: "s",
      wrapEnc: "e",
      wrapCiphertext: "c",
      encryptedMeta: "m",
      metaNonce: "n",
      downloadCount: 0,
      maxDownloads: 5,
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    file: {
      secret: new Uint8Array(32),
      salt: new Uint8Array(32),
      keys: { fileKey: {} as CryptoKey } as never,
      metadata: { type: "single", name, size: 5, mimeType: "application/pdf" },
    },
  };
}

beforeEach(() => {
  vi.mocked(fileRequest.inboxNeedsPassword).mockReturnValue(false);
  vi.mocked(fileRequest.openInboxLink).mockResolvedValue(access);
  vi.mocked(fileRequest.openInbox).mockResolvedValue({
    title: "Docs",
    asks: ["files"],
    uploadFragment: "up",
    uploads: [entry()],
  });
  vi.mocked(api.fetchInbox).mockResolvedValue(inbox());
});

afterEach(() => {
  vi.clearAllMocks();
  keepUnseen(new Set());
});

describe("useInbox", () => {
  it("opens an inbox without a password straight away", async () => {
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(api.fetchInbox).toHaveBeenCalledWith(ID, "inbox-token");
    expect(result.current.opened?.title).toBe("Docs");
  });

  it("opens a note in the page, counts it, and refuses one too large before fetching it", async () => {
    const note = {
      ...entry(),
      file: { ...entry().file!, metadata: { type: "note" as const, size: 4096 } },
    };
    vi.mocked(fileRequest.openInbox).mockResolvedValue({
      title: "Docs",
      asks: ["note"],
      uploadFragment: "up",
      uploads: [note],
    });
    const stream = new ReadableStream<Uint8Array>();
    vi.mocked(api.downloadInboxFile).mockResolvedValue({
      stream,
      size: 1,
      fileCount: 1,
      storageBackend: "filesystem",
    });
    const blocks = [{ type: "text" as const, format: "plain" as const, text: "4711" }];
    vi.mocked(fileRequest.readInboxNote).mockResolvedValue({ blocks, unreadable: false });
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await expect(result.current.openNote(note, 1024)).rejects.toThrow(
      fileRequest.NoteTooLargeError,
    );
    expect(api.downloadInboxFile).not.toHaveBeenCalled();

    let opened: unknown;
    await act(async () => {
      opened = await result.current.openNote(note, 1024 * 1024);
    });
    expect(opened).toEqual({ blocks, unreadable: false });
    expect(api.downloadInboxFile).toHaveBeenCalledWith(ID, UPLOAD_ID, "inbox-token");
    expect(fileRequest.readInboxNote).toHaveBeenCalledWith(note.file, stream, 1024 * 1024);
    expect(result.current.opened?.uploads[0]!.upload.downloadCount).toBe(1);
    await expect(result.current.openNote(entry(), 1024 * 1024)).rejects.toThrow("Not a note");
  });

  it("marks what arrived since the last visit as new, until the page is left", async () => {
    vi.mocked(api.fetchInbox).mockResolvedValue({ ...inbox(), uploads: [entry().upload] });
    vi.mocked(markUploadsSeen).mockResolvedValueOnce(new Set());
    setUnseen(ID, 1);
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(markUploadsSeen).toHaveBeenCalledWith(ID, "fragment", [UPLOAD_ID]);
    expect(result.current.fresh.has(UPLOAD_ID)).toBe(true);
    expect(unseenFor(ID)).toBe(0);

    // The refresh finds it seen already, and it stays marked anyway.
    vi.mocked(markUploadsSeen).mockResolvedValueOnce(new Set([UPLOAD_ID]));
    await act(() => result.current.refresh());
    expect(result.current.fresh.has(UPLOAD_ID)).toBe(true);
  });

  it("marks nothing and clears nothing for a link this browser did not store", async () => {
    vi.mocked(api.fetchInbox).mockResolvedValue({ ...inbox(), uploads: [entry().upload] });
    setUnseen(ID, 1);
    const { result } = renderHook(() => useInbox(ID, "forged", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.fresh.size).toBe(0);
    expect(unseenFor(ID)).toBe(1);
  });

  it("calls a link that does not decode invalid without asking the server", () => {
    vi.mocked(fileRequest.inboxNeedsPassword).mockImplementation(() => {
      throw new Error("Not a valid inbox link");
    });
    const { result } = renderHook(() => useInbox(ID, "broken", argon2));
    expect(result.current.phase).toBe("invalid");
    expect(api.fetchInbox).not.toHaveBeenCalled();
  });

  it("asks for the password and reports a wrong one", async () => {
    vi.mocked(fileRequest.inboxNeedsPassword).mockReturnValue(true);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    expect(result.current.phase).toBe("needs-password");

    await act(() => result.current.unlock("wrong"));
    expect(fileRequest.openInboxLink).toHaveBeenCalledWith("fragment", "wrong", argon2);
    expect(result.current.phase).toBe("needs-password");
    expect(result.current.passwordError).toBe("wrong-password");
    expect(removeRequest).not.toHaveBeenCalled();

    await act(() => result.current.unlock("right"));
    expect(result.current.phase).toBe("ready");
  });

  it("reports the lockout", async () => {
    vi.mocked(fileRequest.inboxNeedsPassword).mockReturnValue(true);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(429, "Too many failed attempts"),
    );
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await act(() => result.current.unlock("pw"));
    expect(result.current.passwordError).toBe("rate-limited");
  });

  it("forgets a request without a password that the server no longer has", async () => {
    const kept = { inboxFragment: "fragment", closesAt: "2020-01-01T00:00:00.000Z" };
    vi.mocked(getRequest)
      .mockResolvedValueOnce(kept as never)
      .mockResolvedValueOnce(kept as never);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2, 604_800));
    await waitFor(() => expect(result.current.phase).toBe("gone"));
    expect(removeRequest).toHaveBeenCalledWith(ID);
  });

  it("keeps the stored request on a 404 while its uploads may still be there", async () => {
    const kept = { inboxFragment: "fragment", closesAt: "2099-01-01T00:00:00.000Z" };
    vi.mocked(getRequest)
      .mockResolvedValueOnce(kept as never)
      .mockResolvedValueOnce(kept as never);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    setUnseen(ID, 1);
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2, 604_800));
    await waitFor(() => expect(result.current.phase).toBe("gone"));
    expect(removeRequest).not.toHaveBeenCalled();
    expect(unseenFor(ID)).toBe(0);
  });

  it("keeps the stored request when a made-up link for its ID leads nowhere", async () => {
    // Not stored when the inbox opens, stored by the time the server answers.
    vi.mocked(getRequest).mockResolvedValueOnce(undefined);
    vi.mocked(getRequest).mockResolvedValueOnce({ inboxFragment: "the-real-one" } as never);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    const { result } = renderHook(() => useInbox(ID, "forged", argon2));
    await waitFor(() => expect(result.current.phase).toBe("gone"));
    expect(removeRequest).not.toHaveBeenCalled();
  });

  it("does not ask the server with a link that differs from the one stored for the request", async () => {
    vi.mocked(getRequest).mockResolvedValueOnce({ inboxFragment: "the-real-one" } as never);
    const { result } = renderHook(() => useInbox(ID, "forged", argon2));
    await waitFor(() => expect(result.current.phase).toBe("invalid"));
    expect(api.fetchInbox).not.toHaveBeenCalled();
  });

  it("shows the lockout without asking for a password the inbox does not have", async () => {
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(429, "Too many failed attempts"),
    );
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("locked"));
  });

  it("downloads through the inbox endpoint with the inbox token and counts it", async () => {
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(() => result.current.download(result.current.opened!.uploads[0]!));

    const options = vi.mocked(saveDecryptedDownload).mock.calls[0]![0];
    expect(options.source).toMatchObject({
      path: `/api/inbox/${ID}/file/${UPLOAD_ID}`,
      token: "inbox-token",
      tokenHeader: "X-Inbox-Token",
    });
    expect(options.filename).toBe("report.pdf");
    expect(options.plaintextSize).toBe(5);
    await options.source.fetchCiphertext();
    expect(api.downloadInboxFile).toHaveBeenCalledWith(ID, UPLOAD_ID, "inbox-token");
    expect(result.current.opened!.uploads[0]!.upload.downloadCount).toBe(1);
    expect(result.current.downloads[UPLOAD_ID]).toBeUndefined();
  });

  it("treats a cancelled download as nothing and clears its progress", async () => {
    vi.mocked(saveDecryptedDownload).mockRejectedValueOnce(
      new DOMException("cancelled", "AbortError"),
    );
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(() => result.current.download(result.current.opened!.uploads[0]!));
    expect(result.current.downloads[UPLOAD_ID]).toBeUndefined();
    expect(result.current.opened!.uploads[0]!.upload.downloadCount).toBe(0);
  });

  it("passes a failed download on and clears its progress", async () => {
    vi.mocked(saveDecryptedDownload).mockRejectedValueOnce(new Error("Stream truncation detected"));
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await expect(
      act(() => result.current.download(result.current.opened!.uploads[0]!)),
    ).rejects.toThrow("Stream truncation detected");
    expect(result.current.downloads[UPLOAD_ID]).toBeUndefined();
  });

  it("shows an error the server gave for anything but a missing request", async () => {
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(new api.ApiError(500, "Internal server error"));
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("Internal server error");
  });

  it("keeps what the client threw off the page, which shows a plain error instead", async () => {
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(new Error('[{"code":"invalid_type"}]'));
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBeNull();
  });

  it("manages the request with the owner token", async () => {
    const { result } = renderHook(() => useInbox(ID, "fragment", argon2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(() => result.current.deleteFile(UPLOAD_ID));
    expect(api.deleteInboxFile).toHaveBeenCalledWith(ID, UPLOAD_ID, "owner-token");
    expect(result.current.opened!.uploads).toHaveLength(0);

    await act(() => result.current.close());
    expect(api.closeRequest).toHaveBeenCalledWith(ID, "owner-token");
    expect(result.current.inbox!.open).toBe(false);

    await act(() => result.current.deleteAll());
    expect(api.deleteRequest).toHaveBeenCalledWith(ID, "owner-token");
    expect(removeRequest).toHaveBeenCalledWith(ID);
    expect(result.current.phase).toBe("deleted");
  });
});

describe("downloadName", () => {
  it("saves a file as bytes, whatever type its sender claims", () => {
    for (const claimed of [
      "text/html",
      "image/svg+xml",
      "application/pdf",
      "text/html\r\nX-Evil: 1",
    ]) {
      const odd = entry();
      (odd.file!.metadata as { mimeType: string }).mimeType = claimed;
      expect(downloadName(odd).mimeType).toBe("application/octet-stream");
    }
  });

  it("cleans the name a sender chose", () => {
    expect(downloadName(entry("a‮txt.exe")).filename).toBe("atxt.exe");
  });

  it("saves an archive as a zip", () => {
    const archive = entry();
    archive.file!.metadata = {
      type: "archive",
      files: [{ name: "a", size: 1 }],
      totalSize: 1,
      archiveSize: 99,
    };
    expect(downloadName(archive)).toEqual({ filename: "archive.zip", mimeType: "application/zip" });
  });
});
