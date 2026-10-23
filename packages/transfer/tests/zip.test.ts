import { describe, it, expect } from "vitest";
import { crc32 as zlibCrc32 } from "node:zlib";
import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";
import { crc32, zipSize, zipStream, type ZipEntry } from "../src/zip.js";

/** An entry whose stream hands out `data` in pieces of `piece` bytes. */
function entry(name: string, data: Uint8Array, piece = 1000): ZipEntry {
  return {
    name,
    size: data.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < data.length; at += piece) {
            controller.enqueue(data.slice(at, at + piece));
          }
          controller.close();
        },
      }),
  };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("crc32", () => {
  it("matches zlib on odd lengths, across calls and on nothing", () => {
    const data = new Uint8Array(randomBytes(70_001));
    expect(crc32(0, data)).toBe(zlibCrc32(data));
    expect(crc32(crc32(0, data.subarray(0, 7)), data.subarray(7))).toBe(zlibCrc32(data));
    expect(crc32(0, new Uint8Array(0))).toBe(0);
    expect(crc32(0, new Uint8Array([0x61]))).toBe(zlibCrc32("a"));
  });
});

describe("zipStream", () => {
  it("writes exactly the size it announced, and another reader gets every file back", async () => {
    const files = [
      entry("photo.jpg", new Uint8Array(randomBytes(123_457))),
      entry("empty.txt", new Uint8Array(0)),
      entry("Ordner/Unterordner/äöü 日本.txt", new TextEncoder().encode("hello")),
      entry("one-byte.bin", new Uint8Array([7])),
    ];
    const zip = await collect(zipStream(files));

    expect(zip.length).toBe(zipSize(files));
    const read = unzipSync(zip);
    expect(Object.keys(read)).toEqual(files.map((f) => f.name));
    for (const file of files) {
      expect(Buffer.from(read[file.name]!).equals(Buffer.from(await collect(file.stream())))).toBe(
        true,
      );
    }
  });

  it("stores every file as it is, with the CRC after it and names in UTF-8", async () => {
    const data = new TextEncoder().encode("plain text, not compressed");
    const zip = await collect(zipStream([entry("a.txt", data)]));
    const view = new DataView(zip.buffer);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(4, true)).toBe(20);
    expect(view.getUint16(6, true)).toBe(0x0808);
    expect(view.getUint16(8, true)).toBe(0);
    // The data follows the header unchanged.
    const start = 30 + "a.txt".length;
    expect(new TextDecoder().decode(zip.subarray(start, start + data.length))).toBe(
      "plain text, not compressed",
    );
    const descriptor = new DataView(zip.buffer, start + data.length, 16);
    expect(descriptor.getUint32(0, true)).toBe(0x08074b50);
    expect(descriptor.getUint32(4, true)).toBe(zlibCrc32(data));
    expect(descriptor.getUint32(8, true)).toBe(data.length);
  });

  it("dates every entry with the time it was given, in MS-DOS fields", async () => {
    const zip = await collect(
      zipStream([entry("a", new Uint8Array(1))], new Date(2026, 9, 12, 18, 30, 42)),
    );
    const view = new DataView(zip.buffer);

    expect(view.getUint16(10, true)).toBe((18 << 11) | (30 << 5) | 21);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 12);
  });

  it("fails when a file holds fewer bytes than it said", async () => {
    const short: ZipEntry = { ...entry("a", new Uint8Array(10)), size: 11 };

    await expect(collect(zipStream([short]))).rejects.toThrow(
      "A file changed while it was uploaded",
    );
  });

  it("fails when a file holds more bytes than it said, and stops reading it", async () => {
    let cancelled = false;
    const long: ZipEntry = {
      name: "a",
      size: 5,
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull: (controller) => controller.enqueue(new Uint8Array(4)),
          cancel: () => {
            cancelled = true;
          },
        }),
    };

    await expect(collect(zipStream([long]))).rejects.toThrow(
      "A file changed while it was uploaded",
    );
    expect(cancelled).toBe(true);
  });

  it("stops reading the file it is in when the upload cancels the zip", async () => {
    let cancelled = false;
    const endless: ZipEntry = {
      name: "a",
      size: 1 << 30,
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull: (controller) => controller.enqueue(new Uint8Array(1024)),
          cancel: () => {
            cancelled = true;
          },
        }),
    };
    const reader = zipStream([endless]).getReader();
    await reader.read();
    await reader.read();

    await reader.cancel();
    expect(cancelled).toBe(true);
  });

  it("refuses a name too long for the zip format", () => {
    expect(() => zipSize([{ name: "a".repeat(65_536), size: 0 }])).toThrow(
      "A file name is too long for a zip",
    );
  });
});

describe("ZIP64", () => {
  it("keeps a zip below 4 GiB without ZIP64 records", () => {
    // 30 + 1 + size + 16 for the entry, 46 + 1 central, 22 end.
    expect(zipSize([{ name: "a", size: 1000 }])).toBe(30 + 1 + 1000 + 16 + 46 + 1 + 22);
  });

  it("counts the ZIP64 fields of a large file and of an offset past 4 GiB", () => {
    const big = 2 ** 32 + 1;
    // The large file: 24 byte descriptor, 28 byte extra field. The small file behind it starts
    // past 4 GiB: 12 byte extra field. Then the ZIP64 end record and its locator.
    const expected =
      30 + 1 + big + 24 + (30 + 1 + 10 + 16) + (46 + 1 + 20) + (46 + 1 + 12) + 56 + 20 + 22;
    expect(
      zipSize([
        { name: "a", size: big },
        { name: "b", size: 10 },
      ]),
    ).toBe(expected);
  });

  it("writes readable ZIP64 records once a file passes 4 GiB", { timeout: 120_000 }, async () => {
    // 4 GiB and one byte of zeros in pieces of 16 MiB, then a small file past the 4 GiB mark.
    const big = 2 ** 32 + 1;
    const zeros = new Uint8Array(16 * 1024 * 1024);
    const large: ZipEntry = {
      name: "large.bin",
      size: big,
      stream: () => {
        let sent = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent === big) return controller.close();
            const piece = Math.min(zeros.length, big - sent);
            sent += piece;
            controller.enqueue(piece === zeros.length ? zeros : zeros.subarray(0, piece));
          },
        });
      },
    };
    const small = entry("small.txt", new TextEncoder().encode("after 4 GiB"));
    const files = [large, small];

    // Keep the bytes after the large file only, where every record past 4 GiB sits.
    const tailStart = 30 + "large.bin".length + big;
    let position = 0;
    let largeCrc = 0;
    const tail: Uint8Array[] = [];
    const reader = zipStream(files).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const end = position + value.length;
      if (position >= 30 + "large.bin".length && position < tailStart) {
        largeCrc = zlibCrc32(
          value.subarray(0, Math.min(value.length, tailStart - position)),
          largeCrc,
        );
      }
      if (end > tailStart) tail.push(value.subarray(Math.max(0, tailStart - position)));
      position = end;
    }
    expect(position).toBe(zipSize(files));

    const bytes = Buffer.concat(tail);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    // The descriptor of the large file, with 8-byte sizes.
    expect(view.getUint32(0, true)).toBe(0x08074b50);
    expect(view.getUint32(4, true)).toBe(largeCrc);
    expect(Number(view.getBigUint64(8, true))).toBe(big);
    expect(Number(view.getBigUint64(16, true))).toBe(big);

    const smallOffset = tailStart + 24;
    const centralOffset = smallOffset + 30 + "small.txt".length + "after 4 GiB".length + 16;
    const at = (absolute: number) => absolute - tailStart;

    // Central record of the large file: sizes marked, the real ones in the extra field.
    let c = at(centralOffset);
    expect(view.getUint32(c, true)).toBe(0x02014b50);
    expect(view.getUint16(c + 6, true)).toBe(45);
    expect(view.getUint32(c + 16, true)).toBe(largeCrc);
    expect(view.getUint32(c + 20, true)).toBe(0xffffffff);
    expect(view.getUint32(c + 24, true)).toBe(0xffffffff);
    expect(view.getUint16(c + 30, true)).toBe(20);
    expect(view.getUint32(c + 42, true)).toBe(0);
    let extra = c + 46 + "large.bin".length;
    expect(view.getUint16(extra, true)).toBe(0x0001);
    expect(view.getUint16(extra + 2, true)).toBe(16);
    expect(Number(view.getBigUint64(extra + 4, true))).toBe(big);
    expect(Number(view.getBigUint64(extra + 12, true))).toBe(big);

    // Central record of the small file: its offset marked, the real one in the extra field.
    c = extra + 20;
    expect(view.getUint32(c, true)).toBe(0x02014b50);
    expect(view.getUint16(c + 6, true)).toBe(45);
    expect(view.getUint32(c + 20, true)).toBe("after 4 GiB".length);
    expect(view.getUint32(c + 42, true)).toBe(0xffffffff);
    extra = c + 46 + "small.txt".length;
    expect(view.getUint16(extra + 2, true)).toBe(8);
    expect(Number(view.getBigUint64(extra + 4, true))).toBe(smallOffset);
    // And the small file itself sits there.
    expect(view.getUint32(at(smallOffset), true)).toBe(0x04034b50);

    // ZIP64 end record, locator and end record.
    const centralSize = 46 + 9 + 20 + 46 + 9 + 12;
    const end64 = at(centralOffset) + centralSize;
    expect(view.getUint32(end64, true)).toBe(0x06064b50);
    expect(Number(view.getBigUint64(end64 + 24, true))).toBe(2);
    expect(Number(view.getBigUint64(end64 + 40, true))).toBe(centralSize);
    expect(Number(view.getBigUint64(end64 + 48, true))).toBe(centralOffset);
    expect(view.getUint32(end64 + 56, true)).toBe(0x07064b50);
    expect(Number(view.getBigUint64(end64 + 64, true))).toBe(centralOffset + centralSize);
    const end = end64 + 76;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(view.getUint32(end + 16, true)).toBe(0xffffffff);
    expect(end + 22).toBe(bytes.length);
  });
});
