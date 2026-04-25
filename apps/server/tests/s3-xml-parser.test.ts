/**
 * Regression tests for S3 XML parsing compatibility.
 *
 * Background: fast-xml-parser@5.7.1 introduced a regression that caused
 * [EntityReplacer] Invalid character '#' in entity name: "#xD" errors when
 * parsing S3 XML responses containing &#xD; (carriage return) characters.
 * @aws-sdk/xml-builder registers "#xD" as a custom entity name, which
 * fast-xml-parser 5.7.1 incorrectly rejected. Fixed in 5.7.2.
 *
 * These tests guard against this class of regression being re-introduced.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// @aws-sdk/xml-builder is a transitive dependency of @aws-sdk/client-s3.
// We access it via createRequire to avoid adding it as a direct dependency.
const require = createRequire(import.meta.url);
const { parseXML } = require("@aws-sdk/xml-builder") as { parseXML: (xml: string) => unknown };

describe("S3 XML parser - entity compatibility", () => {
  it("parses XML responses containing &#xD; (carriage return entity)", () => {
    const xml = "<Result><Key>test&#xD;file.bin</Key><ETag>abc123</ETag></Result>";
    expect(() => parseXML(xml)).not.toThrow();
    const result = parseXML(xml) as { Result: { Key: string; ETag: string } };
    expect(result.Result.ETag).toBe("abc123");
  });

  it("parses CompleteMultipartUploadResult response shape", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<CompleteMultipartUploadResult>",
      "  <Location>https://bucket.r2.example.com/abc.bin</Location>",
      "  <Bucket>skysend-uploads</Bucket>",
      "  <Key>abc.bin</Key>",
      "  <ETag>&#x22;abc123&#x22;</ETag>",
      "</CompleteMultipartUploadResult>",
    ].join("\n");

    expect(() => parseXML(xml)).not.toThrow();
    const result = parseXML(xml) as {
      CompleteMultipartUploadResult: { Bucket: string; Key: string };
    };
    expect(result.CompleteMultipartUploadResult.Bucket).toBe("skysend-uploads");
    expect(result.CompleteMultipartUploadResult.Key).toBe("abc.bin");
  });

  it("parses XML responses containing &#x0A; (newline entity)", () => {
    const xml = "<Result><Value>line1&#x0A;line2</Value></Result>";
    expect(() => parseXML(xml)).not.toThrow();
  });

  it("parses XML responses containing mixed carriage-return and newline entities", () => {
    const xml = "<Result><Message>hello&#xD;&#x0A;world</Message></Result>";
    expect(() => parseXML(xml)).not.toThrow();
  });

  it("parses standard S3 error response shape", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Error>",
      "  <Code>NoSuchKey</Code>",
      "  <Message>The specified key does not exist.</Message>",
      "  <Key>abc&#xD;def.bin</Key>",
      "</Error>",
    ].join("\n");

    expect(() => parseXML(xml)).not.toThrow();
    const result = parseXML(xml) as { Error: { Code: string } };
    expect(result.Error.Code).toBe("NoSuchKey");
  });
});
