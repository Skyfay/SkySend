/**
 * The zip of an upload of several files, written while the upload reads it. Every file is
 * stored without compression, so the size of the zip is known before its first byte and the
 * upload starts at once, with nothing held in memory but the piece on its way. Most large files
 * are compressed already (video, photos, archives, office documents), and deflate held a zip
 * of 3 GiB in memory for a minute to save nothing on them.
 *
 * A size or an offset from 4 GiB on goes into ZIP64 records, which every current unzip tool
 * reads. Entries carry their CRC in a data descriptor after the data, the way a streaming
 * writer has to, since it is known only once a file was read.
 */

/** What the layout of the zip needs of a file. */
export interface ZipEntryInfo {
  /** The path in the zip, `/` between folders. */
  name: string;
  size: number;
}

/** What writing the zip needs of a file. */
export interface ZipEntry extends ZipEntryInfo {
  stream(): ReadableStream<Uint8Array>;
}

/** The largest value a 32-bit field holds, and the mark that the real one is in ZIP64. */
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const LOCAL_HEADER = 30;
const DESCRIPTOR = 16;
const DESCRIPTOR64 = 24;
const CENTRAL_HEADER = 46;
const END = 22;
/** The ZIP64 end of central directory record and its locator. */
const END64 = 56 + 20;
/** Bit 3, sizes and CRC in a data descriptor, and bit 11, names in UTF-8. */
const FLAGS = 0x0808;

/** Where an entry sits and which of its fields need ZIP64. */
interface Placed {
  name: Uint8Array;
  size: number;
  offset: number;
  /** The size does not fit 32 bits, so the descriptor and the central record carry 64. */
  bigSize: boolean;
  /** The local header starts past 4 GiB, so the central record carries the offset in 64. */
  bigOffset: boolean;
}

interface Layout {
  entries: Placed[];
  centralOffset: number;
  centralSize: number;
  zip64End: boolean;
  size: number;
}

function zip64Extra(entry: Placed): number {
  const fields = (entry.bigSize ? 16 : 0) + (entry.bigOffset ? 8 : 0);
  return fields > 0 ? 4 + fields : 0;
}

function plan(files: readonly ZipEntryInfo[]): Layout {
  const encoder = new TextEncoder();
  const entries: Placed[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    if (name.length > MAX16) throw new Error("A file name is too long for a zip");
    const entry: Placed = {
      name,
      size: file.size,
      offset,
      bigSize: file.size >= MAX32,
      bigOffset: offset >= MAX32,
    };
    entries.push(entry);
    offset += LOCAL_HEADER + name.length + file.size + (entry.bigSize ? DESCRIPTOR64 : DESCRIPTOR);
    centralSize += CENTRAL_HEADER + name.length + zip64Extra(entry);
  }
  const zip64End =
    entries.some((e) => e.bigSize || e.bigOffset) ||
    entries.length >= MAX16 ||
    offset >= MAX32 ||
    centralSize >= MAX32;
  return {
    entries,
    centralOffset: offset,
    centralSize,
    zip64End,
    size: offset + centralSize + (zip64End ? END64 : 0) + END,
  };
}

/** The exact size of the zip `zipStream` writes for these files. */
export function zipSize(files: readonly ZipEntryInfo[]): number {
  return plan(files).size;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256 * 8);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  for (let i = 0; i < 256; i++) {
    for (let t = 1; t < 8; t++) {
      const prev = table[(t - 1) * 256 + i]!;
      table[t * 256 + i] = (prev >>> 8) ^ table[prev & 0xff]!;
    }
  }
  return table;
})();

/**
 * CRC-32 of the zip format, continued from `crc` over `data`. Slicing by 8 bytes, about
 * 1.4 GiB/s in V8, twice the speed of a byte at a time and well above any upload.
 */
export function crc32(crc: number, data: Uint8Array): number {
  const t = CRC_TABLE;
  let c = ~crc;
  let i = 0;
  for (const end = data.length - 8; i <= end; i += 8) {
    const a = (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)) ^ c;
    const b = data[i + 4]! | (data[i + 5]! << 8) | (data[i + 6]! << 16) | (data[i + 7]! << 24);
    c =
      t[1792 + (a & 0xff)]! ^
      t[1536 + ((a >>> 8) & 0xff)]! ^
      t[1280 + ((a >>> 16) & 0xff)]! ^
      t[1024 + (a >>> 24)]! ^
      t[768 + (b & 0xff)]! ^
      t[512 + ((b >>> 8) & 0xff)]! ^
      t[256 + ((b >>> 16) & 0xff)]! ^
      t[b >>> 24]!;
  }
  for (; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** Time and date of the MS-DOS fields, in local time like every zip tool reads them. */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function set64(view: DataView, at: number, value: number): void {
  view.setUint32(at, value % 2 ** 32, true);
  view.setUint32(at + 4, Math.floor(value / 2 ** 32), true);
}

function version(entry: Placed): number {
  return entry.bigSize || entry.bigOffset ? 45 : 20;
}

function localHeader(entry: Placed, stamp: { time: number; date: number }): Uint8Array {
  const bytes = new Uint8Array(LOCAL_HEADER + entry.name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, version(entry), true);
  view.setUint16(6, FLAGS, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  // CRC and sizes stay zero here, the descriptor after the data has them.
  view.setUint16(26, entry.name.length, true);
  bytes.set(entry.name, LOCAL_HEADER);
  return bytes;
}

function descriptor(entry: Placed, crc: number): Uint8Array {
  const bytes = new Uint8Array(entry.bigSize ? DESCRIPTOR64 : DESCRIPTOR);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, crc, true);
  if (entry.bigSize) {
    set64(view, 8, entry.size);
    set64(view, 16, entry.size);
  } else {
    view.setUint32(8, entry.size, true);
    view.setUint32(12, entry.size, true);
  }
  return bytes;
}

function centralDirectory(
  layout: Layout,
  crcs: readonly number[],
  stamp: { time: number; date: number },
): Uint8Array {
  const bytes = new Uint8Array(layout.centralSize + (layout.zip64End ? END64 : 0) + END);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const [i, entry] of layout.entries.entries()) {
    const extra = zip64Extra(entry);
    view.setUint32(at, 0x02014b50, true);
    // Made by MS-DOS, so an unzip on Unix gives the files the default permissions.
    view.setUint16(at + 4, version(entry), true);
    view.setUint16(at + 6, version(entry), true);
    view.setUint16(at + 8, FLAGS, true);
    view.setUint16(at + 12, stamp.time, true);
    view.setUint16(at + 14, stamp.date, true);
    view.setUint32(at + 16, crcs[i]!, true);
    view.setUint32(at + 20, entry.bigSize ? MAX32 : entry.size, true);
    view.setUint32(at + 24, entry.bigSize ? MAX32 : entry.size, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, extra, true);
    view.setUint32(at + 42, entry.bigOffset ? MAX32 : entry.offset, true);
    bytes.set(entry.name, at + CENTRAL_HEADER);
    at += CENTRAL_HEADER + entry.name.length;
    if (extra > 0) {
      // The ZIP64 extra field, with only the values whose 32-bit field holds the mark.
      view.setUint16(at, 0x0001, true);
      view.setUint16(at + 2, extra - 4, true);
      let field = at + 4;
      if (entry.bigSize) {
        set64(view, field, entry.size);
        set64(view, field + 8, entry.size);
        field += 16;
      }
      if (entry.bigOffset) set64(view, field, entry.offset);
      at += extra;
    }
  }

  const count = layout.entries.length;
  if (layout.zip64End) {
    const end64Offset = layout.centralOffset + layout.centralSize;
    view.setUint32(at, 0x06064b50, true);
    set64(view, at + 4, 44);
    view.setUint16(at + 12, 45, true);
    view.setUint16(at + 14, 45, true);
    set64(view, at + 24, count);
    set64(view, at + 32, count);
    set64(view, at + 40, layout.centralSize);
    set64(view, at + 48, layout.centralOffset);
    at += 56;
    view.setUint32(at, 0x07064b50, true);
    set64(view, at + 8, end64Offset);
    view.setUint32(at + 16, 1, true);
    at += 20;
  }
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, Math.min(count, MAX16), true);
  view.setUint16(at + 10, Math.min(count, MAX16), true);
  view.setUint32(at + 12, Math.min(layout.centralSize, MAX32), true);
  view.setUint32(at + 16, Math.min(layout.centralOffset, MAX32), true);
  return bytes;
}

async function* zipParts(files: readonly ZipEntry[], now: Date): AsyncGenerator<Uint8Array> {
  const layout = plan(files);
  const stamp = dosStamp(now);
  const crcs: number[] = [];
  for (const [i, file] of files.entries()) {
    const entry = layout.entries[i]!;
    yield localHeader(entry, stamp);
    let crc = 0;
    let read = 0;
    let finished = false;
    const reader = file.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.length;
        // The size went into the upload before the first byte, so a file that changed since
        // it was picked cannot go into this zip.
        if (read > entry.size) throw new Error("A file changed while it was uploaded");
        crc = crc32(crc, value);
        yield value;
      }
      finished = true;
    } finally {
      // An error or a cancelled upload leaves the file half read, so stop reading it.
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (read !== entry.size) throw new Error("A file changed while it was uploaded");
    crcs.push(crc);
    yield descriptor(entry, crc);
  }
  yield centralDirectory(layout, crcs, stamp);
}

/**
 * The zip of these files as a stream of exactly `zipSize(files)` bytes, read one file after
 * the other as the stream is pulled.
 */
export function zipStream(
  files: readonly ZipEntry[],
  now = new Date(),
): ReadableStream<Uint8Array> {
  const parts = zipParts(files, now);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await parts.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await parts.return(undefined);
    },
  });
}
