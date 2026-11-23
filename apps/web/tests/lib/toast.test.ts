// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("i18next", () => ({ default: { t: (key: string) => key } }));

import { isStorageFullError, showKnownErrorToast } from "../../src/lib/toast.js";

/** What the server answers when STORAGE_MAX_SIZE has no room, its STORAGE_FULL_MESSAGE. */
const STORAGE_FULL = "This instance is out of storage space. Try again later.";

describe("storage full error", () => {
  beforeEach(() => {
    toast.error.mockClear();
  });

  it("recognises the message the server refuses a full instance with", () => {
    expect(isStorageFullError(STORAGE_FULL)).toBe(true);
    expect(isStorageFullError("Upload quota exceeded. Try again later.")).toBe(false);
  });

  it("shows the translated sentence instead of the server's English", () => {
    showKnownErrorToast(STORAGE_FULL);
    expect(toast.error).toHaveBeenCalledWith("errors.storageFull");
  });

  it("leaves other errors as they are", () => {
    showKnownErrorToast("Upload quota exceeded. Try again later.");
    expect(toast.error).toHaveBeenCalledWith("Upload quota exceeded. Try again later.");
  });
});
