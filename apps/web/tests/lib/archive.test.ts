import { describe, it, expect } from "vitest";
import { encryptedMetadataLength, MAX_ENCRYPTED_METADATA_BYTES } from "@skysend/crypto";
import { archiveMetadata, archiveMetadataFits } from "../../src/lib/archive.js";
import { zipSize } from "../../src/lib/zip.js";

function file(name: string, size = 3, path?: string): File {
  const f = new File([new Uint8Array(size)], name);
  if (path) Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

/** `count` files with names of `length` characters each. */
function files(count: number, length: number, char = "a"): File[] {
  return Array.from({ length: count }, (_, i) =>
    file(`${i}`.padStart(4, "0") + char.repeat(length - 4)),
  );
}

describe("archiveMetadata", () => {
  it("lists every file under its place in a picked folder, with the size of the zip", () => {
    const picked = [file("a.txt", 5), file("b.txt", 7, "Folder/Sub/b.txt")];
    const metadata = archiveMetadata(picked);

    expect(metadata.files).toEqual([
      { name: "a.txt", size: 5 },
      { name: "Folder/Sub/b.txt", size: 7 },
    ]);
    expect(metadata.totalSize).toBe(12);
    expect(metadata.archiveSize).toBe(zipSize(metadata.files));
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
