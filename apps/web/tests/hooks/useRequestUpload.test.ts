// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@skysend/crypto", () => ({
  decodeUploadFragment: vi.fn(),
  deriveLinkKeys: vi.fn(),
  decryptRequestBrief: vi.fn(),
  fromBase64url: (s: string) => new TextEncoder().encode(s),
  toBase64url: () => "upload-token",
}));

vi.mock("../../src/lib/api.js", () => ({
  fetchRequestForSender: vi.fn(),
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

const upload = vi.fn().mockResolvedValue(undefined);
const cancel = vi.fn();
const reset = vi.fn();
const uploadState = {
  phase: "idle" as string,
  progress: 0,
  speed: null,
  error: null as string | null,
};
vi.mock("../../src/hooks/useUpload.js", () => ({
  useUpload: () => ({ ...uploadState, upload, reset, cancel }),
}));

import * as crypto from "@skysend/crypto";
import * as api from "../../src/lib/api.js";
import { useRequestUpload } from "../../src/hooks/useRequestUpload.js";

const ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const publicKey = new Uint8Array(65).fill(4);

function senderView(overrides: Partial<api.SenderRequest> = {}): api.SenderRequest {
  return {
    brief: { ciphertext: "ct", nonce: "n" },
    open: true,
    closesAt: "2099-01-01T00:00:00.000Z",
    uploadsLeft: 2,
    maxUploadSize: 1000,
    maxFilesPerUpload: 32,
    ...overrides,
  };
}

beforeEach(() => {
  uploadState.phase = "idle";
  uploadState.error = null;
  vi.mocked(crypto.decodeUploadFragment).mockResolvedValue({
    publicKey,
    linkSecret: new Uint8Array(32),
  });
  vi.mocked(crypto.deriveLinkKeys).mockResolvedValue({
    uploadToken: new Uint8Array(32),
    briefKey: {} as CryptoKey,
  });
  vi.mocked(crypto.decryptRequestBrief).mockResolvedValue({
    title: "Tax documents",
    asks: ["files"],
    template: null,
  });
  vi.mocked(api.fetchRequestForSender).mockResolvedValue(senderView());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRequestUpload", () => {
  it("reads the link, shows the brief and uploads with the key from the link", async () => {
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(api.fetchRequestForSender).toHaveBeenCalledWith(ID, "upload-token");
    expect(result.current.brief).toEqual({
      title: "Tax documents",
      asks: ["files"],
      template: null,
    });

    const file = new File(["x"], "a.txt");
    await act(() => result.current.send({ files: [file] }));
    expect(upload).toHaveBeenCalledWith({
      files: [file],
      request: { id: ID, uploadToken: "upload-token", publicKey },
    });
  });

  it("sends a note padded, so its length tells little", async () => {
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const note = [{ type: "text" as const, format: "plain" as const, text: "4711" }];
    await act(() => result.current.send({ note }));
    const options = upload.mock.calls[0]![0] as { note: string; files: File[] };
    expect(options.files).toEqual([]);
    expect(new TextEncoder().encode(options.note).length).toBe(1024);
    expect(JSON.parse(options.note)).toEqual({ v: 1, blocks: note });
  });

  it("reads the template of a note to fill in, without any value in it", async () => {
    vi.mocked(crypto.decryptRequestBrief).mockResolvedValueOnce({
      title: null,
      asks: ["note"],
      template: { v: 1, blocks: [{ type: "password", entries: [{ label: "PIN", value: "1" }] }] },
    });
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.brief).toEqual({
      title: null,
      asks: ["note"],
      template: [{ type: "password", entries: [{ label: "PIN", value: "" }] }],
    });
  });

  it("leaves a note to write freely when the template has nothing to fill in", async () => {
    vi.mocked(crypto.decryptRequestBrief).mockResolvedValueOnce({
      title: null,
      asks: ["note"],
      template: { v: 1, blocks: [{ type: "form" }] },
    });
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.brief?.template).toBeNull();
  });

  it("calls a link that does not decode invalid without asking the server", async () => {
    vi.mocked(crypto.decodeUploadFragment).mockRejectedValueOnce(
      new Error("Not a valid upload link"),
    );
    const { result } = renderHook(() => useRequestUpload(ID, "broken"));
    await waitFor(() => expect(result.current.phase).toBe("invalid"));
    expect(api.fetchRequestForSender).not.toHaveBeenCalled();
  });

  it("reports a request the server does not have", async () => {
    vi.mocked(api.fetchRequestForSender).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("gone"));
  });

  it("calls a request whose brief does not open broken, and offers nothing to send", async () => {
    vi.mocked(crypto.decryptRequestBrief).mockRejectedValueOnce(new Error("bad"));
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("broken"));
    expect(result.current.brief).toBeNull();
  });

  it("passes on why an upload failed", async () => {
    uploadState.phase = "error";
    uploadState.error = "full";
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.uploadError).toBe("full");
  });

  it("starts one upload for a double click", async () => {
    let finish: () => void = () => {};
    upload.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const file = new File(["x"], "a.txt");
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.send({ files: [file] });
      void result.current.send({ files: [file] });
    });
    expect(upload).toHaveBeenCalledTimes(1);
    finish();
    await act(() => first);
  });

  it("stays delivered and asks again what is left", async () => {
    vi.mocked(api.fetchRequestForSender)
      .mockResolvedValueOnce(senderView())
      .mockResolvedValueOnce(senderView({ open: false, uploadsLeft: 1 }));
    const { result, rerender } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    uploadState.phase = "done";
    rerender();
    await waitFor(() => expect(result.current.status?.open).toBe(false));
    expect(result.current.phase).toBe("delivered");
  });

  it("asks again what is left after a cancel", async () => {
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.cancel());
    expect(cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(api.fetchRequestForSender).toHaveBeenCalledTimes(2));
  });

  it("shows an error state when the server does not answer", async () => {
    vi.mocked(api.fetchRequestForSender).mockRejectedValueOnce(new Error("Failed to fetch"));
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("error"));
  });

  it("cleans the title before it is shown", async () => {
    vi.mocked(crypto.decryptRequestBrief).mockResolvedValueOnce({
      title: "Docs\n\n\n\n\nVerified \u202Esender",
      asks: ["files"],
      template: null,
    });
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.brief?.title).toBe("Docs\n\nVerified sender"));
  });

  it("shows no title when it cleans down to nothing", async () => {
    vi.mocked(crypto.decryptRequestBrief).mockResolvedValueOnce({
      title: "\u202E\u200B",
      asks: ["files"],
      template: null,
    });
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.brief?.title).toBeNull();
  });
});
