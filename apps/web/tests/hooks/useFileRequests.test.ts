// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../src/lib/api.js", () => ({
  createRequest: vi.fn(),
  fetchInbox: vi.fn(),
  deleteRequest: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../src/lib/file-request.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/file-request.js")>()),
  prepareRequest: vi.fn(),
  openInboxLink: vi.fn(),
}));

vi.mock("../../src/lib/upload-store.js", () => ({
  getAllRequests: vi.fn(),
  saveRequest: vi.fn().mockResolvedValue(undefined),
  removeRequest: vi.fn().mockResolvedValue(undefined),
}));

import * as api from "../../src/lib/api.js";
import * as fileRequest from "../../src/lib/file-request.js";
import * as store from "../../src/lib/upload-store.js";
import { useCreateRequest, useRequestHistory } from "../../src/hooks/useFileRequests.js";
import { keepUnseen, setUnseen, unseenFor } from "../../src/lib/unseen-uploads.js";

const ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const argon2 = vi.fn();
const options = { title: " Docs ", expireSec: 86400, maxUploads: 3, maxSize: 4096, password: "" };

const prepared = {
  body: {
    vault: "v",
    vaultNonce: "n",
    inboxAuthToken: "a",
    inboxOwnerToken: "o",
    uploadToken: "u",
    title: null,
    hasPassword: false,
  },
  inboxFragment: "inboxfrag",
  uploadFragment: "uploadfrag",
};

function stored(id: string, hasPassword = false) {
  return {
    id,
    inboxFragment: `inbox-${id}`,
    uploadFragment: `upload-${id}`,
    hasPassword,
    closesAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** An inbox as the server sends it, so the mock matches the real schema. */
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
    usedUploads: 0,
    usedBytes: 0,
    uploads: [],
  };
}

beforeEach(() => {
  vi.mocked(fileRequest.prepareRequest).mockResolvedValue(prepared);
  vi.mocked(fileRequest.openInboxLink).mockResolvedValue({
    keys: {} as never,
    inboxToken: "it",
    ownerToken: "ot",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  keepUnseen(new Set());
});

function upload(id: string): api.InboxUpload {
  return {
    id,
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
  };
}

describe("useCreateRequest", () => {
  it("creates the request and keeps both links in this browser", async () => {
    vi.mocked(api.createRequest).mockResolvedValueOnce({
      id: ID,
      closesAt: "2099-01-01T00:00:00.000Z",
    });
    const { result } = renderHook(() => useCreateRequest(argon2));
    await act(() => result.current.create(options));

    expect(fileRequest.prepareRequest).toHaveBeenCalledWith({
      title: "Docs",
      password: undefined,
      argon2id: argon2,
    });
    expect(api.createRequest).toHaveBeenCalledWith({
      ...prepared.body,
      expireSec: 86400,
      maxUploads: 3,
      maxSize: 4096,
    });
    expect(store.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ID,
        inboxFragment: "inboxfrag",
        uploadFragment: "uploadfrag",
        title: "Docs",
        seenUploads: [],
      }),
    );
    expect(result.current.created?.uploadLink).toBe(
      `${window.location.origin}/request/${ID}#uploadfrag`,
    );
    expect(result.current.created?.inboxLink).toBe(
      `${window.location.origin}/inbox/${ID}#inboxfrag`,
    );
  });

  it("names the reason when the server refuses", async () => {
    const { result } = renderHook(() => useCreateRequest(argon2));
    vi.mocked(api.createRequest).mockRejectedValueOnce(
      new api.ApiError(401, "Authentication required"),
    );
    await act(() => result.current.create(options));
    expect(result.current.error).toBe("signInRequired");

    vi.mocked(api.createRequest).mockRejectedValueOnce(new api.ApiError(429, "Too many"));
    await act(() => result.current.create(options));
    expect(result.current.error).toBe("dailyLimit");
    expect(store.saveRequest).not.toHaveBeenCalled();
  });
});

describe("useRequestHistory", () => {
  it("shows the status of a request without a password and leaves one with a password shut", async () => {
    vi.mocked(store.getAllRequests).mockResolvedValueOnce([stored("a"), stored("b", true)]);
    vi.mocked(api.fetchInbox).mockResolvedValueOnce(inbox());
    const { result } = renderHook(() => useRequestHistory());

    await waitFor(() => expect(result.current.requests[0]?.loading).toBe(false));
    expect(api.fetchInbox).toHaveBeenCalledTimes(1);
    expect(api.fetchInbox).toHaveBeenCalledWith("a", "it");
    expect(result.current.requests[0]?.inbox).toEqual(inbox());
    expect(result.current.requests[1]).toMatchObject({ id: "b", inbox: null, loading: false });
  });

  it("counts the uploads its inbox has not shown in this browser yet", async () => {
    vi.mocked(store.getAllRequests).mockResolvedValueOnce([{ ...stored("a"), seenUploads: ["x"] }]);
    vi.mocked(api.fetchInbox).mockResolvedValueOnce({
      ...inbox(),
      uploads: [upload("x"), upload("y")],
    });
    const { result } = renderHook(() => useRequestHistory());
    await waitFor(() => expect(result.current.requests[0]?.loading).toBe(false));
    expect(unseenFor("a")).toBe(1);

    await act(() => result.current.remove(stored("a")));
    expect(unseenFor("a")).toBe(0);
  });

  it("forgets a request the server no longer has once every upload in it ran out", async () => {
    vi.mocked(store.getAllRequests).mockResolvedValueOnce([
      { ...stored("a"), closesAt: "2020-01-01T00:00:00.000Z" },
    ]);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    const { result } = renderHook(() => useRequestHistory(604_800));
    await waitFor(() => expect(store.removeRequest).toHaveBeenCalledWith("a"));
    expect(result.current.requests).toHaveLength(0);
  });

  it("keeps a request the server answers 404 for while its uploads may still be there", async () => {
    // A proxy or a restored database can answer 404, and the stored link is the only copy.
    vi.mocked(store.getAllRequests).mockResolvedValueOnce([stored("a")]);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    setUnseen("a", 2);
    const { result } = renderHook(() => useRequestHistory(604_800));
    await waitFor(() => expect(result.current.requests[0]?.loading).toBe(false));
    expect(store.removeRequest).not.toHaveBeenCalled();
    expect(result.current.requests[0]).toMatchObject({ id: "a", inbox: null });
    // Nothing the server no longer lists counts as new.
    expect(unseenFor("a")).toBe(0);
  });

  it("forgets nothing on a 404 before it knows how long the instance keeps an upload", async () => {
    vi.mocked(store.getAllRequests).mockResolvedValueOnce([
      { ...stored("a"), closesAt: "2020-01-01T00:00:00.000Z" },
    ]);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(
      new api.ApiError(404, "File request not found"),
    );
    const { result } = renderHook(() => useRequestHistory());
    await waitFor(() => expect(result.current.requests[0]?.loading).toBe(false));
    expect(store.removeRequest).not.toHaveBeenCalled();
  });

  it("keeps a request when the server only failed to answer", async () => {
    vi.mocked(store.getAllRequests).mockResolvedValueOnce([stored("a")]);
    vi.mocked(api.fetchInbox).mockRejectedValueOnce(new api.ApiError(500, "Internal server error"));
    const { result } = renderHook(() => useRequestHistory());
    await waitFor(() => expect(result.current.requests[0]?.loading).toBe(false));
    expect(store.removeRequest).not.toHaveBeenCalled();
    expect(result.current.requests).toHaveLength(1);
  });

  it("deletes on the server only what it can, and forgets the rest", async () => {
    vi.mocked(store.getAllRequests).mockResolvedValueOnce([stored("a"), stored("b", true)]);
    vi.mocked(api.fetchInbox).mockResolvedValueOnce(inbox());
    const { result } = renderHook(() => useRequestHistory());
    await waitFor(() => expect(result.current.requests).toHaveLength(2));

    await act(() => result.current.remove(stored("a")));
    expect(api.deleteRequest).toHaveBeenCalledWith("a", "ot");
    await act(() => result.current.remove(stored("b", true)));
    expect(api.deleteRequest).toHaveBeenCalledTimes(1);
    expect(store.removeRequest).toHaveBeenCalledWith("b");
    expect(result.current.requests).toHaveLength(0);
  });
});
