// A tiny, dependency-free ZIP reader/writer used to open and write Office Open
// XML files (`.docx`, `.xlsx`) entirely in the browser.
//
// Both of those formats are just ZIP archives of XML parts, so a minimal ZIP
// codec lets us support them without pulling in a heavyweight (and, in the case
// of the npm build of SheetJS, security-flagged) dependency. We only need what
// the workspace actually uses: read the named parts out of an archive, and
// write a small archive back out.
//
// The heavy lifting — DEFLATE compression/decompression — is delegated to the
// platform's `CompressionStream`/`DecompressionStream`, which every modern
// browser (and Node 18+) ships. Everything else here is plain byte wrangling of
// the ZIP container format (local headers, the central directory and the
// end-of-central-directory record).

/** One file inside an archive, ready to be zipped. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/* ── CRC-32 ─────────────────────────────────────────────────────
 * ZIP stores a CRC-32 checksum of every (uncompressed) entry. */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── DEFLATE via the platform streams ──────────────────────────── */

async function pipeThrough(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Copy into a standalone ArrayBuffer-backed view so it satisfies BufferSource.
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  void writer.write(buf);
  void writer.close();
  const out = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(out);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new DecompressionStream("deflate-raw"));
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new CompressionStream("deflate-raw"));
}

/* ── Reading ────────────────────────────────────────────────────
 * The end-of-central-directory (EOCD) record lives at the very end of the
 * archive and points at the central directory, which lists every entry. We walk
 * that list rather than scanning for local headers, because the central
 * directory is the authoritative index. */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

function findEocd(view: DataView): number {
  // The EOCD is 22 bytes plus an optional trailing comment (max 65535). Scan
  // backwards from the end for its signature.
  const min = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Parse a ZIP archive into a map of entry name → uncompressed bytes. Only the
 * two storage methods Office uses are supported: stored (0) and DEFLATE (8).
 */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("Не удалось прочитать архив (нет EOCD).");

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // offset of central directory

  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // Jump to the local header to find where this entry's data actually starts
    // (its own name/extra field lengths can differ from the central record).
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    out.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ── Writing ────────────────────────────────────────────────────
 * We DEFLATE every entry and emit local headers followed by the central
 * directory and EOCD. Sizes and CRCs are known up front, so no data descriptors
 * are needed. */

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

/** Assemble a set of files into a ZIP archive (all entries DEFLATE-compressed). */
export async function zip(entries: ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());

  interface Prepared {
    nameBytes: Uint8Array;
    comp: Uint8Array;
    crc: number;
    size: number;
    offset: number;
  }
  const prepared: Prepared[] = [];
  const localChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const comp = await deflateRaw(entry.data);

    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); // local file header signature
    hv.setUint16(4, 20, true); // version needed
    hv.setUint16(6, 0x0800, true); // general purpose flag: UTF-8 names
    hv.setUint16(8, 8, true); // method: DEFLATE
    hv.setUint16(10, time, true);
    hv.setUint16(12, date, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, comp.length, true);
    hv.setUint32(22, entry.data.length, true);
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true); // extra len
    header.set(nameBytes, 30);

    localChunks.push(header, comp);
    prepared.push({ nameBytes, comp, crc, size: entry.data.length, offset });
    offset += header.length + comp.length;
  }

  const centralChunks: Uint8Array[] = [];
  let centralSize = 0;
  for (const p of prepared) {
    const rec = new Uint8Array(46 + p.nameBytes.length);
    const rv = new DataView(rec.buffer);
    rv.setUint32(0, CENTRAL_SIG, true);
    rv.setUint16(4, 20, true); // version made by
    rv.setUint16(6, 20, true); // version needed
    rv.setUint16(8, 0x0800, true); // UTF-8 names
    rv.setUint16(10, 8, true); // method
    rv.setUint16(12, time, true);
    rv.setUint16(14, date, true);
    rv.setUint32(16, p.crc, true);
    rv.setUint32(20, p.comp.length, true);
    rv.setUint32(24, p.size, true);
    rv.setUint16(28, p.nameBytes.length, true);
    rv.setUint32(42, p.offset, true); // relative offset of local header
    rec.set(p.nameBytes, 46);
    centralChunks.push(rec);
    centralSize += rec.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, prepared.length, true); // entries on this disk
  ev.setUint16(10, prepared.length, true); // total entries
  ev.setUint32(12, centralSize, true); // central directory size
  ev.setUint32(16, offset, true); // central directory offset

  const total = offset + centralSize + eocd.length;
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
