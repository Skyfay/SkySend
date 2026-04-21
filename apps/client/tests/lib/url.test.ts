import { describe, expect, it } from "vitest";
import { parseShareUrl, buildShareUrl } from "../../src/lib/url.js";

// ── parseShareUrl ─────────────────────────────────────────────────────────────

describe("parseShareUrl", () => {
  describe("valid file URLs", () => {
    it("parses a standard file URL", () => {
      const result = parseShareUrl("https://send.example.com/file/abc123#mysecret");
      expect(result).toEqual({
        server: "https://send.example.com",
        type: "file",
        id: "abc123",
        secret: "mysecret",
      });
    });

    it("parses a file URL with trailing slash on path", () => {
      const result = parseShareUrl("https://send.example.com/file/abc123/#mysecret");
      expect(result).toEqual({
        server: "https://send.example.com",
        type: "file",
        id: "abc123",
        secret: "mysecret",
      });
    });

    it("preserves the server origin (no trailing slash)", () => {
      const result = parseShareUrl("https://send.example.com/file/abc123#s");
      expect(result.server).toBe("https://send.example.com");
    });
  });

  describe("valid note URLs", () => {
    it("parses a note URL", () => {
      const result = parseShareUrl("https://send.example.com/note/note42#notesecret");
      expect(result).toEqual({
        server: "https://send.example.com",
        type: "note",
        id: "note42",
        secret: "notesecret",
      });
    });
  });

  describe("legacy /d/ redirect URLs", () => {
    it("parses legacy /d/ path as file type", () => {
      const result = parseShareUrl("https://send.example.com/d/legacyid#legacysecret");
      expect(result).toEqual({
        server: "https://send.example.com",
        type: "file",
        id: "legacyid",
        secret: "legacysecret",
      });
    });
  });

  describe("URL decoding", () => {
    it("decodes percent-encoded characters in the ID", () => {
      const result = parseShareUrl("https://send.example.com/file/abc%2Fdef#secret");
      expect(result.id).toBe("abc/def");
    });

    it("handles base64url-style secrets", () => {
      const result = parseShareUrl(
        "https://send.example.com/file/abc123#dGVzdC1zZWNyZXQ",
      );
      expect(result.secret).toBe("dGVzdC1zZWNyZXQ");
    });
  });

  describe("server with port", () => {
    it("includes port in the server origin", () => {
      const result = parseShareUrl("http://localhost:3000/file/abc#secret");
      expect(result.server).toBe("http://localhost:3000");
    });
  });

  describe("error cases", () => {
    it("throws for a completely invalid URL", () => {
      expect(() => parseShareUrl("not-a-url")).toThrow("Invalid URL");
    });

    it("throws when the fragment (secret) is missing", () => {
      expect(() => parseShareUrl("https://send.example.com/file/abc123")).toThrow(
        "missing the secret fragment",
      );
    });

    it("throws when the path does not match expected format", () => {
      expect(() =>
        parseShareUrl("https://send.example.com/download/abc123#secret"),
      ).toThrow("path must be /file/<id> or /note/<id>");
    });

    it("throws for root path with no id", () => {
      expect(() => parseShareUrl("https://send.example.com/#secret")).toThrow(
        "path must be /file/<id> or /note/<id>",
      );
    });

    it("throws for path with extra segments", () => {
      expect(() =>
        parseShareUrl("https://send.example.com/file/abc/extra#secret"),
      ).toThrow("path must be /file/<id> or /note/<id>");
    });
  });
});

// ── buildShareUrl ─────────────────────────────────────────────────────────────

describe("buildShareUrl", () => {
  it("builds a file share URL", () => {
    expect(buildShareUrl("https://send.example.com", "file", "abc123", "mysecret")).toBe(
      "https://send.example.com/file/abc123#mysecret",
    );
  });

  it("builds a note share URL", () => {
    expect(buildShareUrl("https://send.example.com", "note", "note42", "notesecret")).toBe(
      "https://send.example.com/note/note42#notesecret",
    );
  });

  it("strips trailing slashes from server URL", () => {
    expect(buildShareUrl("https://send.example.com/", "file", "abc", "sec")).toBe(
      "https://send.example.com/file/abc#sec",
    );
    expect(buildShareUrl("https://send.example.com///", "file", "abc", "sec")).toBe(
      "https://send.example.com/file/abc#sec",
    );
  });

  it("percent-encodes special characters in the ID", () => {
    expect(buildShareUrl("https://send.example.com", "file", "a/b", "sec")).toBe(
      "https://send.example.com/file/a%2Fb#sec",
    );
  });

  it("roundtrips correctly with parseShareUrl", () => {
    const built = buildShareUrl(
      "https://send.example.com",
      "file",
      "roundtrip-id",
      "roundtrip-secret",
    );
    const parsed = parseShareUrl(built);
    expect(parsed.server).toBe("https://send.example.com");
    expect(parsed.type).toBe("file");
    expect(parsed.id).toBe("roundtrip-id");
    expect(parsed.secret).toBe("roundtrip-secret");
  });
});
