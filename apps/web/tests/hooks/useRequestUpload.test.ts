// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@skysend/crypto", () => ({
  decodeUploadFragment: vi.fn(),
  deriveLinkKeys: vi.fn(),
  decryptRequestTitle: vi.fn(),
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
    title: { ciphertext: "ct", nonce: "n" },
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
    titleKey: {} as CryptoKey,
  });
  vi.mocked(crypto.decryptRequestTitle).mockResolvedValue("Tax documents");
  vi.mocked(api.fetchRequestForSender).mockResolvedValue(senderView());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRequestUpload", () => {
  it("reads the link, shows the title and uploads with the key from the link", async () => {
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(api.fetchRequestForSender).toHaveBeenCalledWith(ID, "upload-token");
    expect(result.current.title).toBe("Tax documents");

    const file = new File(["x"], "a.txt");
    await act(() => result.current.send([file]));
    expect(upload).toHaveBeenCalledWith({
      files: [file],
      request: { id: ID, uploadToken: "upload-token", publicKey },
    });
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

  it("hides a title that does not decrypt", async () => {
    vi.mocked(crypto.decryptRequestTitle).mockRejectedValueOnce(new Error("bad"));
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.title).toBeNull();
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
      first = result.current.send([file]);
      void result.current.send([file]);
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
    vi.mocked(crypto.decryptRequestTitle).mockResolvedValueOnce(
      "Docs\n\n\n\n\nVerified \u202Esender",
    );
    const { result } = renderHook(() => useRequestUpload(ID, "fragment"));
    await waitFor(() => expect(result.current.title).toBe("Docs\n\nVerified sender"));
  });
});
