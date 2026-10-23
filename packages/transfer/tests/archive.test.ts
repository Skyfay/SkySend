import { describe, it, expect } from "vitest";
import { encryptedMetadataLength, MAX_ENCRYPTED_METADATA_BYTES } from "@skysend/crypto";
import { archiveMetadata, archiveMetadataFits, uniqueNames } from "../src/archive.js";
import { zipSize, type ZipEntryInfo } from "../src/zip.js";

function file(name: string, size = 3): ZipEntryInfo {
  return { name, size };
}

/** `count` files with names of `length` characters each. */
function files(count: number, length: number, char = "a"): ZipEntryInfo[] {
  return Array.from({ length: count }, (_, i) =>
    file(`${i}`.padStart(4, "0") + char.repeat(length - 4)),
  );
}

describe("archiveMetadata", () => {
  it("lists every file under its path in the zip, with the size of the zip", () => {
    const metadata = archiveMetadata([file("a.txt", 5), file("Folder/Sub/b.txt", 7)]);

    expect(metadata.files).toEqual([
      { name: "a.txt", size: 5 },
      { name: "Folder/Sub/b.txt", size: 7 },
    ]);
    expect(metadata.totalSize).toBe(12);
    expect(metadata.archiveSize).toBe(zipSize(metadata.files));
  });

  it("keeps nothing of an entry but its name and size", () => {
    const entry = { name: "a.txt", size: 5, stream: () => new ReadableStream() };
    expect(archiveMetadata([entry, file("b.txt")]).files[0]).toEqual({ name: "a.txt", size: 5 });
  });
});

describe("uniqueNames", () => {
  it("numbers a name that comes again before its extension, like a browser", () => {
    expect(uniqueNames(["report.pdf", "report.pdf", "report.pdf"])).toEqual([
      "report.pdf",
      "report (2).pdf",
      "report (3).pdf",
    ]);
  });

  it("counts names that differ only in case as the same", () => {
    expect(uniqueNames(["Report.pdf", "report.pdf"])).toEqual(["Report.pdf", "report (2).pdf"]);
  });

  it("numbers names without an extension, hidden files and paths at their end", () => {
    expect(uniqueNames(["notes", "notes", ".env", ".env", "a.b/c", "a.b/c"])).toEqual([
      "notes",
      "notes (2)",
      ".env",
      ".env (2)",
      "a.b/c",
      "a.b/c (2)",
    ]);
  });

  it("skips a number a later name already holds", () => {
    expect(uniqueNames(["a (2).txt", "a.txt", "a.txt"])).toEqual(["a (2).txt", "a.txt", "a (3).txt"]);
  });
});

describe("archiveMetadataFits", () => {
  it("takes 200 files with names of 255 characters", () => {
    expect(archiveMetadataFits(files(200, 255))).toBe(true);
  });

  it("refuses names the server would not take, like 200 long names in Japanese", () => {
    expect(archiveMetadataFits(files(200, 255, "日"))).toBe(false);
  });

  it("counts the submission ID an upload into a file request adds", () => {
    // Grow the last name until the metadata of a normal upload, with the stream nonce every
    // upload adds, just fits, with no room left for the 48 bytes of a submission ID.
    const picked = files(150, 255);
    let extra = 0;
    const withExtra = () => [...picked.slice(0, -1), file(picked.at(-1)!.name + "b".repeat(extra))];
    const sentLength = () =>
      encryptedMetadataLength({ ...archiveMetadata(withExtra()), streamNonce: "A".repeat(16) });
    while (sentLength() <= MAX_ENCRYPTED_METADATA_BYTES - 1024) {
      extra += 100;
    }
    while (sentLength() <= MAX_ENCRYPTED_METADATA_BYTES) {
      extra += 1;
    }
    extra -= 1;

    expect(archiveMetadataFits(withExtra())).toBe(true);
    expect(archiveMetadataFits(withExtra(), true)).toBe(false);
  });

  it("does not check a single file, whose metadata holds one name", () => {
    expect(archiveMetadataFits([file("x".repeat(70_000))])).toBe(true);
  });
});
