import { describe, it, expect } from "vitest";
import { zipSize } from "@skysend/transfer";
import { archiveMetadata, archiveMetadataFits } from "../../src/lib/archive.js";

function file(name: string, size = 3, path?: string): File {
  const f = new File([new Uint8Array(size)], name);
  if (path) Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

// The rules of the metadata are tested in @skysend/transfer. Here only what the page adds:
// which name a picked File gets in the zip.
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
  it("counts the folder path of a picked file, not only its name", () => {
    const deep = "d".repeat(250);
    const picked = Array.from({ length: 200 }, (_, i) =>
      file(`${i}.txt`, 3, `${deep}/${deep}/${deep}/${i}.txt`),
    );
    expect(archiveMetadataFits(picked)).toBe(false);
    expect(archiveMetadataFits(picked.map((f) => file(f.name)))).toBe(true);
  });
});
