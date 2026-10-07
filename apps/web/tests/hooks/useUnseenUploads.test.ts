// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("../../src/lib/api.js", () => ({
  fetchInbox: vi.fn(),
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

vi.mock("../../src/lib/file-request.js", () => ({
  openInboxLink: vi.fn(),
}));

vi.mock("../../src/lib/upload-store.js", () => ({
  getAllRequests: vi.fn(),
  removeRequest: vi.fn().mockResolvedValue(undefined),
}));

import * as api from "../../src/lib/api.js";
import { openInboxLink } from "../../src/lib/file-request.js";
import { getAllRequests, removeRequest, type StoredRequest } from "../../src/lib/upload-store.js";
import { keepUnseen, setUnseen, unseenFor, unseenTotal } from "../../src/lib/unseen-uploads.js";
import {
  checkUnseenUploads,
  UNSEEN_MAX_PER_ROUND,
  UNSEEN_MIN_GAP_MS,
  UNSEEN_POLL_MS,
  useUnseenUploads,
} from "../../src/hooks/useUnseenUploads.js";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;

function stored(id: string, overrides: Partial<StoredRequest> = {}): StoredRequest {
  return {
    id,
    inboxFragment: `inbox-${id}`,
    uploadFragment: `upload-${id}`,
    hasPassword: false,
    closesAt: new Date(NOW + DAY).toISOString(),
    createdAt: "2026-10-01T00:00:00.000Z",
    seenUploads: [],
    ...overrides,
  };
}

/** An inbox as the server sends it, with uploads of these IDs. */
function inbox(...ids: string[]): api.Inbox {
  return {
    vault: "v",
    vaultNonce: "n",
    title: null,
    hasPassword: false,
    open: true,
    closesAt: new Date(NOW + DAY).toISOString(),
    createdAt: "2026-10-01T00:00:00.000Z",
    maxUploads: 3,
    maxSize: 4096,
    usedUploads: ids.length,
    usedBytes: 0,
    uploads: ids.map((id) => ({
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
      createdAt: "2026-10-07T11:00:00.000Z",
    })),
  };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

beforeEach(() => {
  vi.mocked(openInboxLink).mockImplementation(async (fragment) => ({
    keys: {} as never,
    inboxToken: `token-${fragment}`,
    ownerToken: "owner",
  }));
  setVisibility("visible");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  keepUnseen(new Set());
});

describe("checkUnseenUploads", () => {
  it("counts new uploads of the requests it can check, one request at a time", async () => {
    vi.mocked(getAllRequests).mockResolvedValueOnce([
      stored("a", { seenUploads: ["x"] }),
      stored("b", { hasPassword: true }),
      stored("c", { closesAt: new Date(NOW - 2 * DAY).toISOString() }),
    ]);
    vi.mocked(api.fetchInbox).mockResolvedValueOnce(inbox("x", "y"));
    await checkUnseenUploads(NOW);
    expect(api.fetchInbox).toHaveBeenCalledTimes(1);
    expect(api.fetchInbox).toHaveBeenCalledWith("a", "token-inbox-a");
    expect(unseenFor("a")).toBe(1);
    expect(unseenTotal()).toBe(1);
  });

  it("still checks a request that closed less than a day ago", async () => {
    vi.mocked(getAllRequests).mockResolvedValueOnce([
      stored("a", { closesAt: new Date(NOW - DAY / 2).toISOString() }),
    ]);
    vi.mocked(api.fetchInbox).mockResolvedValueOnce(inbox("x"));
    await checkUnseenUploads(NOW);
    expect(unseenFor("a")).toBe(1);
  });

  it("never forgets a stored request, even on a 404, and keeps the last count", async () => {
    setUnseen("a", 2);
    setUnseen("b", 1);
    vi.mocked(getAllRequests).mockResolvedValueOnce([stored("a"), stored("b")]);
    vi.mocked(api.fetchInbox)
      .mockRejectedValueOnce(new api.ApiError(404, "Not Found"))
      .mockRejectedValueOnce(new api.ApiError(500, "Internal server error"));
    await checkUnseenUploads(NOW);
    expect(removeRequest).not.toHaveBeenCalled();
    expect(unseenFor("a")).toBe(2);
    expect(unseenFor("b")).toBe(1);
  });

  it("checks only the newest requests in one round", async () => {
    const many = Array.from({ length: UNSEEN_MAX_PER_ROUND + 5 }, (_, i) => stored(`r${i}`));
    vi.mocked(getAllRequests).mockResolvedValueOnce(many);
    vi.mocked(api.fetchInbox).mockResolvedValue(inbox());
    await checkUnseenUploads(NOW);
    expect(api.fetchInbox).toHaveBeenCalledTimes(UNSEEN_MAX_PER_ROUND);
    expect(api.fetchInbox).toHaveBeenLastCalledWith(
      `r${UNSEEN_MAX_PER_ROUND - 1}`,
      `token-inbox-r${UNSEEN_MAX_PER_ROUND - 1}`,
    );
  });

  it("drops the count of a request this browser no longer keeps", async () => {
    setUnseen("old", 3);
    vi.mocked(getAllRequests).mockResolvedValueOnce([]);
    await checkUnseenUploads(NOW);
    expect(unseenTotal()).toBe(0);
  });

  it("runs one check at a time", async () => {
    vi.mocked(getAllRequests).mockResolvedValue([stored("a")]);
    vi.mocked(api.fetchInbox).mockResolvedValue(inbox());
    await Promise.all([checkUnseenUploads(NOW), checkUnseenUploads(NOW)]);
    expect(api.fetchInbox).toHaveBeenCalledTimes(1);
  });
});

describe("useUnseenUploads", () => {
  it("checks at once, then every few minutes, but not while the page is hidden", async () => {
    vi.useFakeTimers({ now: NOW });
    vi.mocked(getAllRequests).mockResolvedValue([stored("a")]);
    vi.mocked(api.fetchInbox).mockResolvedValue(inbox("x"));
    const { result, unmount } = renderHook(() => useUnseenUploads(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.fetchInbox).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(1);

    await vi.advanceTimersByTimeAsync(UNSEEN_POLL_MS);
    expect(api.fetchInbox).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(UNSEEN_POLL_MS);
    expect(api.fetchInbox).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.fetchInbox).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("starts no new round when the tab comes back right after one", async () => {
    vi.useFakeTimers({ now: NOW + 30 * DAY });
    vi.mocked(getAllRequests).mockResolvedValue([]);
    const { unmount } = renderHook(() => useUnseenUploads(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(getAllRequests).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getAllRequests).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UNSEEN_MIN_GAP_MS);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getAllRequests).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("checks nothing when the instance has no file requests", async () => {
    vi.useFakeTimers({ now: NOW });
    const { unmount } = renderHook(() => useUnseenUploads(false));
    await vi.advanceTimersByTimeAsync(UNSEEN_POLL_MS);
    expect(getAllRequests).not.toHaveBeenCalled();
    unmount();
  });

  it("stops checking once the page is gone", async () => {
    vi.useFakeTimers({ now: NOW });
    vi.mocked(getAllRequests).mockResolvedValue([]);
    const { unmount } = renderHook(() => useUnseenUploads(true));
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(UNSEEN_POLL_MS * 2);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getAllRequests).toHaveBeenCalledTimes(1);
  });
});
