import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countUnseen,
  keepUnseen,
  setUnseen,
  subscribeUnseen,
  unseenFor,
  unseenTotal,
} from "../../src/lib/unseen-uploads.js";
import type { StoredRequest } from "../../src/lib/upload-store.js";

const request = (seenUploads?: string[]): StoredRequest => ({
  id: "a",
  inboxFragment: "inbox-a",
  uploadFragment: "upload-a",
  hasPassword: false,
  closesAt: "2099-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  seenUploads,
});
const uploads = (...ids: string[]) => ({ uploads: ids.map((id) => ({ id }) as never) });

afterEach(() => {
  keepUnseen(new Set());
});

describe("countUnseen", () => {
  it("counts the uploads the inbox did not list last time", () => {
    expect(countUnseen(request(["x"]), uploads("x", "y", "z"))).toBe(2);
    expect(countUnseen(request(["x", "gone"]), uploads("x"))).toBe(0);
  });

  it("counts every upload of a request whose inbox was never open here", () => {
    expect(countUnseen(request(), uploads("x", "y"))).toBe(2);
  });
});

describe("unseen counts", () => {
  it("adds up the requests and tells its listeners only about a change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUnseen(listener);
    setUnseen("a", 2);
    setUnseen("b", 1);
    setUnseen("b", 1);
    expect(unseenTotal()).toBe(3);
    expect(unseenFor("a")).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    setUnseen("a", 0);
    expect(unseenTotal()).toBe(1);
    expect(unseenFor("a")).toBe(0);
    unsubscribe();
    setUnseen("b", 5);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("forgets the requests this browser no longer keeps", () => {
    setUnseen("a", 2);
    setUnseen("b", 1);
    keepUnseen(new Set(["b"]));
    expect(unseenTotal()).toBe(1);
    expect(unseenFor("a")).toBe(0);
  });
});
