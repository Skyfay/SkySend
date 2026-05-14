// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth } from "../../src/hooks/useAuth.js";
import type { ServerConfig } from "../../src/lib/api.js";

// Mock the api module so we control what fetchAuthSession returns without
// making real network requests.
vi.mock("../../src/lib/api.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/api.js")>();
  return {
    ...original,
    fetchAuthSession: vi.fn(),
  };
});

// jsdom does not implement navigation, so we replace window.location with a
// plain writable object before each test and restore it afterwards.
let locationMock: { href: string };

beforeEach(() => {
  locationMock = { href: "" };
  Object.defineProperty(window, "location", { configurable: true, value: locationMock });
});

afterEach(() => {
  vi.resetAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_USER = { sub: "u-1", name: "Marie Curie", email: "marie@example.com" };

function oidcConfig(enabled: boolean): ServerConfig {
  return {
    oidcEnabled: enabled,
    oidcProtectFiles: false,
    oidcProtectNotes: false,
  } as unknown as ServerConfig;
}

async function getMockFetchAuthSession() {
  const { fetchAuthSession } = await import("../../src/lib/api.js");
  return vi.mocked(fetchAuthSession);
}

// ── useAuth ───────────────────────────────────────────────────────────────────

describe("useAuth - OIDC disabled", () => {
  it("returns idle state without fetching when oidcEnabled is false", async () => {
    const mockFetch = await getMockFetchAuthSession();

    const { result } = renderHook(() => useAuth(oidcConfig(false)));

    expect(result.current.user).toBeNull();
    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns idle state when config is null", () => {
    const { result } = renderHook(() => useAuth(null));

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.isLoggedIn).toBe(false);
  });
});

describe("useAuth - OIDC enabled, authenticated", () => {
  it("sets user and isLoggedIn after a successful session fetch", async () => {
    const mockFetch = await getMockFetchAuthSession();
    mockFetch.mockResolvedValue(VALID_USER);

    const { result } = renderHook(() => useAuth(oidcConfig(true)));

    // Initially loading while fetch is in-flight
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toEqual(VALID_USER);
    expect(result.current.isLoggedIn).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

describe("useAuth - OIDC enabled, not authenticated", () => {
  it("sets user to null when fetchAuthSession returns null (401)", async () => {
    const mockFetch = await getMockFetchAuthSession();
    mockFetch.mockResolvedValue(null);

    const { result } = renderHook(() => useAuth(oidcConfig(true)));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.isLoggedIn).toBe(false);
  });
});

describe("useAuth - logout", () => {
  it("redirects to /auth/logout when logout() is called", async () => {
    const mockFetch = await getMockFetchAuthSession();
    mockFetch.mockResolvedValue(VALID_USER);

    const { result } = renderHook(() => useAuth(oidcConfig(true)));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.logout();
    });

    expect(locationMock.href).toBe("/auth/logout");
  });
});
