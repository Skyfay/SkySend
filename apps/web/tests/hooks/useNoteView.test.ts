// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@skysend/crypto", () => ({
  deriveKeys: vi.fn(async () => ({ metaKey: {}, authKey: {} })),
  computeAuthToken: vi.fn(async () => new Uint8Array(32)),
  decryptNoteContent: vi.fn(async () => "decrypted content"),
  toBase64url: vi.fn(() => "authtoken"),
  fromBase64url: vi.fn(() => new Uint8Array(32)),
  applyPasswordProtection: vi.fn((_s: Uint8Array, _k: Uint8Array) => new Uint8Array(32)),
  deriveKeyFromPassword: vi.fn(async () => ({ key: new Uint8Array(32) })),
}));

vi.mock("../../src/lib/api.js", () => ({
  fetchNoteInfo: vi.fn(),
  viewNote: vi.fn(),
  verifyNotePassword: vi.fn(),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNoteInfo(overrides = {}) {
  return {
    id: "n-1",
    contentType: "text" as const,
    hasPassword: false,
    salt: "salt64",
    maxViews: 3,
    viewCount: 0,
    expiresAt: "2099-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeViewResponse(overrides = {}) {
  return {
    encryptedContent: btoa("encrypted"),
    nonce: btoa("nonce"),
    viewCount: 1,
    maxViews: 3,
    ...overrides,
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useNoteView", () => {
  it("starts in idle state", async () => {
    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    expect(result.current.phase).toBe("idle");
    expect(result.current.content).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("loadInfo() sets phase=idle and stores info when note has no password", async () => {
    const { fetchNoteInfo } = await import("../../src/lib/api.js");
    vi.mocked(fetchNoteInfo).mockResolvedValueOnce(makeNoteInfo());

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.info?.id).toBe("n-1");
  });

  it("loadInfo() sets phase=needs-password when note has a password", async () => {
    const { fetchNoteInfo } = await import("../../src/lib/api.js");
    vi.mocked(fetchNoteInfo).mockResolvedValueOnce(
      makeNoteInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "argon2id-v2" }),
    );

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    expect(result.current.phase).toBe("needs-password");
  });

  it("loadInfo() sets phase=error on ApiError", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockRejectedValueOnce(
      new api.ApiError(404, "Not Found"),
    );

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Not Found");
  });

  it("view() decrypts and sets phase=viewing", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(makeNoteInfo());
    vi.mocked(api.viewNote).mockResolvedValueOnce(makeViewResponse());

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    // Pre-load info so view() finds state.info
    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("viewing");
    expect(result.current.content).toBe("decrypted content");
  });

  it("view() sets phase=destroyed when last view consumed", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(makeNoteInfo({ maxViews: 1 }));
    vi.mocked(api.viewNote).mockResolvedValueOnce(makeViewResponse({ viewCount: 1, maxViews: 1 }));

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    // Load info first so state.info is set before view() is called
    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("destroyed");
  });

  it("view() sets phase=needs-password and error=wrong-password on failed verify", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(
      makeNoteInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "argon2id-v2" }),
    );
    vi.mocked(api.verifyNotePassword).mockResolvedValueOnce(false);

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());
    const fakeArgon2id = vi.fn(async () => new Uint8Array(32));

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    await act(async () => {
      await result.current.view("n-1", "secretb64", "wrongpass", fakeArgon2id);
    });

    expect(result.current.phase).toBe("needs-password");
    expect(result.current.error).toBe("wrong-password");
  });

  it("view() sets phase=needs-password and error=rate-limited on 429", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(makeNoteInfo());
    vi.mocked(api.viewNote).mockRejectedValueOnce(new api.ApiError(429, "rate-limited"));

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("needs-password");
    expect(result.current.error).toBe("rate-limited");
  });

  it("view() mit hasPassword=true, passwordSalt=undefined \u2192 phase='error'", async () => {
    const api = await import("../../src/lib/api.js");
    // passwordSalt intentionally absent so the throw on line 70 fires
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(
      makeNoteInfo({ hasPassword: true, passwordAlgo: "argon2id-v2" }),
    );

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    await act(async () => {
      await result.current.view("n-1", "secretb64", "anypassword");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Failed to view note");
  });

  it("view() mit korrektem Passwort (verifyNotePassword=true) \u2192 phase='viewing'", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(
      makeNoteInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "argon2id-v2" }),
    );
    vi.mocked(api.verifyNotePassword).mockResolvedValueOnce(true);
    vi.mocked(api.viewNote).mockResolvedValueOnce(makeViewResponse());

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());
    const fakeArgon2id = vi.fn(async () => new Uint8Array(32));

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    await act(async () => {
      await result.current.view("n-1", "secretb64", "correctpass", fakeArgon2id);
    });

    expect(result.current.phase).toBe("viewing");
    expect(result.current.content).toBe("decrypted content");
  });

  it("loadInfo() setzt error='Failed to load note info' bei generischem Fehler", async () => {
    const { fetchNoteInfo } = await import("../../src/lib/api.js");
    vi.mocked(fetchNoteInfo).mockRejectedValueOnce(new Error("Network failure"));

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("Failed to load note info");
  });

  it("view() ohne loadInfo(): fetchNoteInfo gibt null zurueck \u2192 phase='error'", async () => {
    const api = await import("../../src/lib/api.js");
    // Return null so the `if (!info) throw` branch fires
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(null as never);

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    // Do NOT call loadInfo() - state.info stays null, so the ?? fetchNoteInfo() branch is taken
    await act(async () => {
      await result.current.view("n-1", "secretb64");
    });

    expect(result.current.phase).toBe("error");
  });

  it("view() mit passwordAlgo='argon2id-v2' und argon2id-Funktion \u2192 phase='viewing'", async () => {
    const api = await import("../../src/lib/api.js");
    vi.mocked(api.fetchNoteInfo).mockResolvedValueOnce(
      makeNoteInfo({ hasPassword: true, passwordSalt: "ps64", passwordAlgo: "argon2id-v2" }),
    );
    vi.mocked(api.verifyNotePassword).mockResolvedValueOnce(true);
    vi.mocked(api.viewNote).mockResolvedValueOnce(makeViewResponse());

    const { useNoteView } = await import("../../src/hooks/useNoteView.js");
    const { result } = renderHook(() => useNoteView());

    const fakeArgon2id = vi.fn(async () => new Uint8Array(32));

    await act(async () => {
      await result.current.loadInfo("n-1");
    });

    await act(async () => {
      await result.current.view("n-1", "secretb64", "correctpass", fakeArgon2id);
    });

    expect(result.current.phase).toBe("viewing");
  });
});
