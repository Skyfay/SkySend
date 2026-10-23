import { describe, expect, it } from "vitest";
import { buildShareLink, parseShareLink, trimTrailingSlashes } from "../src/links.js";

/** What the CLI opens. */
const parseShareUrl = (url: string) => parseShareLink(url, ["file", "note"]);

// ── parseShareLink ────────────────────────────────────────────────────────────

describe("parseShareLink", () => {
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
      const result = parseShareUrl("https://send.example.com/file/abc123#dGVzdC1zZWNyZXQ");
      expect(result.secret).toBe("dGVzdC1zZWNyZXQ");
    });
  });

  describe("server with port", () => {
    it("includes port in the server origin", () => {
      const result = parseShareUrl("http://localhost:3000/file/abc#secret");
      expect(result.server).toBe("http://localhost:3000");
    });
  });

  describe("links of a file request", () => {
    it("reads the upload link and the inbox link when they are asked for", () => {
      const both = ["request", "inbox"] as const;
      expect(parseShareLink("https://send.example.com/request/r1#pk.ls", both)).toEqual({
        server: "https://send.example.com",
        type: "request",
        id: "r1",
        secret: "pk.ls",
      });
      expect(parseShareLink("https://send.example.com/inbox/r1#inbox", both).type).toBe("inbox");
    });

    it("refuses them where only files and notes are asked for", () => {
      expect(() => parseShareUrl("https://send.example.com/request/r1#pk")).toThrow(
        "path must be /file/<id> or /note/<id>, got: /request/r1",
      );
    });

    it("does not take the old /d/ path for anything but a file", () => {
      expect(() => parseShareLink("https://send.example.com/d/x#s", ["note"])).toThrow(
        "path must be /note/<id>",
      );
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
      expect(() => parseShareUrl("https://send.example.com/download/abc123#secret")).toThrow(
        "path must be /file/<id> or /note/<id>",
      );
    });

    it("throws for root path with no id", () => {
      expect(() => parseShareUrl("https://send.example.com/#secret")).toThrow(
        "path must be /file/<id> or /note/<id>",
      );
    });

    it("throws for path with extra segments", () => {
      expect(() => parseShareUrl("https://send.example.com/file/abc/extra#secret")).toThrow(
        "path must be /file/<id> or /note/<id>",
      );
    });
  });
});

// ── buildShareLink ────────────────────────────────────────────────────────────

describe("buildShareLink", () => {
  it("builds a file share URL", () => {
    expect(buildShareLink("https://send.example.com", "file", "abc123", "mysecret")).toBe(
      "https://send.example.com/file/abc123#mysecret",
    );
  });

  it("builds a note share URL", () => {
    expect(buildShareLink("https://send.example.com", "note", "note42", "notesecret")).toBe(
      "https://send.example.com/note/note42#notesecret",
    );
  });

  it("strips trailing slashes from server URL", () => {
    expect(buildShareLink("https://send.example.com/", "file", "abc", "sec")).toBe(
      "https://send.example.com/file/abc#sec",
    );
    expect(buildShareLink("https://send.example.com///", "file", "abc", "sec")).toBe(
      "https://send.example.com/file/abc#sec",
    );
  });

  it("builds the upload and inbox links of a file request", () => {
    expect(buildShareLink("https://send.example.com", "request", "r1", "pk.ls")).toBe(
      "https://send.example.com/request/r1#pk.ls",
    );
    expect(buildShareLink("https://send.example.com", "inbox", "r1", "inbox")).toBe(
      "https://send.example.com/inbox/r1#inbox",
    );
  });

  it("percent-encodes special characters in the ID", () => {
    expect(buildShareLink("https://send.example.com", "file", "a/b", "sec")).toBe(
      "https://send.example.com/file/a%2Fb#sec",
    );
  });

  it("roundtrips correctly with parseShareLink", () => {
    const built = buildShareLink(
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

describe("trimTrailingSlashes", () => {
  it("takes every slash off the end and nothing else", () => {
    expect(trimTrailingSlashes("https://send.example.com/")).toBe("https://send.example.com");
    expect(trimTrailingSlashes("https://send.example.com///")).toBe("https://send.example.com");
    expect(trimTrailingSlashes("https://send.example.com/sub/")).toBe(
      "https://send.example.com/sub",
    );
    expect(trimTrailingSlashes("https://send.example.com")).toBe("https://send.example.com");
    expect(trimTrailingSlashes("///")).toBe("");
    expect(trimTrailingSlashes("")).toBe("");
  });

  it("takes linear time on a long run of slashes that something follows", () => {
    // /\/+$/ tried every slash of such a run again, quadratic in its length.
    const start = Date.now();
    expect(trimTrailingSlashes(`https://a${"/".repeat(200_000)}b`)).toHaveLength(200_010);
    expect(trimTrailingSlashes(`https://a${"/".repeat(200_000)}`)).toBe("https://a");
    expect(Date.now() - start).toBeLessThan(200);
  });
});
