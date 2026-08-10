// Read/write helpers for the two Office Open XML formats the workspace cares
// about: Word documents (`.docx`, read as plain text) and Excel spreadsheets
// (`.xlsx`, read/written as a rectangular grid of strings). Both are ZIP
// archives of XML parts, so everything here builds on the tiny `zip` codec.
//
// The XML is parsed with focused regular expressions rather than a full DOM
// parser. That keeps the module free of browser-only globals (so it can be
// unit-tested in Node) and is entirely adequate for the small, tool-generated
// XML these formats contain — we only extract text and cell values, never
// arbitrary markup.

import { unzip, zip } from "./zip";

/* ── Shared XML helpers ─────────────────────────────────────────── */

/** Decode the five predefined XML entities plus numeric character references. */
export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Escape a string for inclusion in an XML text node. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/* ── DOCX → text ────────────────────────────────────────────────
 * All visible text in a Word document lives inside <w:t> runs. Paragraphs
 * (<w:p>), explicit breaks (<w:br>/<w:cr>) and tabs (<w:tab>) carry the layout
 * we care about; everything else is dropped. */

/** Extract the readable plain text from a `.docx` file's raw bytes. */
export async function docxToText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  const docPart = files.get("word/document.xml");
  if (!docPart) throw new Error("Это не похоже на документ Word (нет word/document.xml).");
  const xml = textDecoder.decode(docPart);

  const token = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>|<\/w:p>/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = token.exec(xml)) !== null) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0].startsWith("<w:tab")) out += "\t";
    else out += "\n"; // <w:br>, <w:cr> or </w:p>
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/* ── Cell reference helpers ─────────────────────────────────────── */

/** "AB" → 27 (0-based column index). */
function colToIndex(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
  return col - 1;
}

/** 0 → "A", 27 → "AB". */
function indexToCol(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ── XLSX → grid ────────────────────────────────────────────────
 * Cells reference their text either by an index into the shared-strings table
 * (t="s"), inline (t="inlineStr"), or as a literal value (numbers, booleans and
 * formula strings). We resolve all of those into a rectangular string grid. */

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let si: RegExpExecArray | null;
  while ((si = siRe.exec(xml)) !== null) {
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let joined = "";
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(si[1])) !== null) joined += decodeXml(t[1]);
    strings.push(joined);
  }
  return strings;
}

/** Parse the first worksheet of an `.xlsx` file into a rectangular grid. */
export async function xlsxToGrid(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes);
  const shared = files.has("xl/sharedStrings.xml")
    ? parseSharedStrings(textDecoder.decode(files.get("xl/sharedStrings.xml")!))
    : [];

  // Pick the lowest-numbered worksheet part (usually sheet1.xml).
  const sheetName = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) throw new Error("Это не похоже на книгу Excel (нет листов).");
  const xml = textDecoder.decode(files.get(sheetName)!);

  const cellMap = new Map<number, Map<number, string>>();
  let maxRow = -1;
  let maxCol = -1;

  const rowRe = /<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;
  let autoRow = 0;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowAttrs = rowMatch[1];
    const body = rowMatch[2] ?? "";
    const rAttr = /\br="(\d+)"/.exec(rowAttrs);
    const rowIdx = rAttr ? parseInt(rAttr[1], 10) - 1 : autoRow;
    autoRow = rowIdx + 1;

    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cell: RegExpExecArray | null;
    let autoCol = 0;
    while ((cell = cellRe.exec(body)) !== null) {
      const attrs = cell[1];
      const inner = cell[2] ?? "";
      const refM = /\br="([A-Z]+)\d+"/.exec(attrs);
      const colIdx = refM ? colToIndex(refM[1]) : autoCol;
      autoCol = colIdx + 1;
      const typeM = /\bt="([^"]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : "n";

      let value = "";
      if (type === "s") {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const idx = v ? parseInt(v[1], 10) : -1;
        value = idx >= 0 && idx < shared.length ? shared[idx] : "";
      } else if (type === "inlineStr") {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t: RegExpExecArray | null;
        while ((t = tRe.exec(inner)) !== null) value += decodeXml(t[1]);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        value = v ? decodeXml(v[1]) : "";
      }

      if (value !== "") {
        if (!cellMap.has(rowIdx)) cellMap.set(rowIdx, new Map());
        cellMap.get(rowIdx)!.set(colIdx, value);
        if (rowIdx > maxRow) maxRow = rowIdx;
        if (colIdx > maxCol) maxCol = colIdx;
      }
    }
  }

  if (maxRow < 0 || maxCol < 0) return [[""]];
  const grid: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const row: string[] = [];
    const cols = cellMap.get(r);
    for (let c = 0; c <= maxCol; c++) row.push(cols?.get(c) ?? "");
    grid.push(row);
  }
  return grid;
}

/* ── grid → XLSX ────────────────────────────────────────────────
 * A minimal but spec-valid workbook: one worksheet whose cells are written as
 * inline strings, except values that round-trip cleanly as numbers, which are
 * written as numeric cells so Excel treats them as numbers. */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

/** True when a string is a plain number that survives a Number round-trip. */
function isNumeric(v: string): boolean {
  if (v.trim() === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && String(n) === v.trim();
}

function sheetXml(cells: string[][]): string {
  const rows = cells
    .map((row, r) => {
      const cs = row
        .map((value, c) => {
          if (value === "") return "";
          const ref = `${indexToCol(c)}${r + 1}`;
          if (isNumeric(value)) return `<c r="${ref}"><v>${value.trim()}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

/** Serialize a grid into a downloadable `.xlsx` workbook. */
export async function gridToXlsx(cells: string[][]): Promise<Uint8Array> {
  const entry = (name: string, text: string) => ({ name, data: textEncoder.encode(text) });
  return zip([
    entry("[Content_Types].xml", CONTENT_TYPES),
    entry("_rels/.rels", ROOT_RELS),
    entry("xl/workbook.xml", WORKBOOK),
    entry("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
    entry("xl/worksheets/sheet1.xml", sheetXml(cells)),
  ]);
}
