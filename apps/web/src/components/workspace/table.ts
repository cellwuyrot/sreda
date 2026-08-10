// Pure helpers for the spreadsheet ("Таблица") node: immutable grid edits plus
// CSV import/export. Keeping these free of React makes the table card and its
// full-screen editor share exactly the same, easily testable, logic.

/** Return a copy of `cells` with `value` written at (row, col). */
export function setCell(cells: string[][], row: number, col: number, value: string): string[][] {
  return cells.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? value : c)) : r));
}

/* ── Column width / row height sizing ─────────────────────────────
 * Tables carry optional per-column widths and per-row heights so a cramped
 * column can be widened or a row given more breathing room. Sizes are stored
 * as index-aligned arrays on the card; a missing entry means "use the default",
 * so older boards and freshly created tables render at the default size until
 * the user drags a divider. */

export const DEFAULT_COL_WIDTH = 160;
export const MIN_COL_WIDTH = 60;
export const MAX_COL_WIDTH = 640;
export const DEFAULT_ROW_HEIGHT = 36;
export const MIN_ROW_HEIGHT = 28;
export const MAX_ROW_HEIGHT = 400;

/** Materialize an optional size array into exactly `count` positive numbers. */
export function normalizeSizes(sizes: number[] | undefined, count: number, fallback: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = sizes?.[i];
    arr.push(typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);
  }
  return arr;
}

/** Splice a new default entry into a stored size array (kept unset when empty). */
export function insertSize(sizes: number[] | undefined, at: number, fallback: number): number[] | undefined {
  if (!sizes) return undefined;
  const arr = [...sizes];
  arr.splice(Math.min(Math.max(at, 0), arr.length), 0, fallback);
  return arr;
}

/** Drop the entry at `at` from a stored size array (kept unset when empty). */
export function removeSize(sizes: number[] | undefined, at: number): number[] | undefined {
  if (!sizes) return undefined;
  const arr = [...sizes];
  arr.splice(at, 1);
  return arr;
}

/** Set one entry (clamped), materializing the array from defaults if needed. */
export function setSize(
  sizes: number[] | undefined,
  count: number,
  index: number,
  value: number,
  fallback: number,
  min: number,
  max: number,
): number[] {
  const arr = normalizeSizes(sizes, count, fallback);
  arr[index] = Math.max(min, Math.min(max, Math.round(value)));
  return arr;
}

/** Number of columns in the grid (0 when there are no rows). */
export function colCount(cells: string[][]): number {
  return cells.length ? cells[0].length : 0;
}

/** Insert a blank row at `index` (defaults to the end). */
export function insertRow(cells: string[][], index?: number): string[][] {
  const cols = colCount(cells) || 1;
  const blank = Array.from({ length: cols }, () => "");
  const at = index ?? cells.length;
  const next = cells.map((r) => [...r]);
  next.splice(at, 0, blank);
  return next;
}

/** Insert a blank column at `index` (defaults to the end). */
export function insertCol(cells: string[][], index?: number): string[][] {
  if (cells.length === 0) return [[""]];
  const at = index ?? colCount(cells);
  return cells.map((r) => {
    const nr = [...r];
    nr.splice(at, 0, "");
    return nr;
  });
}

/** Remove the row at `index`, keeping at least one row. */
export function removeRow(cells: string[][], index: number): string[][] {
  if (cells.length <= 1) return cells;
  return cells.filter((_, ri) => ri !== index);
}

/** Remove the column at `index`, keeping at least one column. */
export function removeCol(cells: string[][], index: number): string[][] {
  if (colCount(cells) <= 1) return cells;
  return cells.map((r) => r.filter((_, ci) => ci !== index));
}

/**
 * Serialize a grid to RFC-4180 CSV. Cells that contain a comma, quote or line
 * break are wrapped in double quotes with embedded quotes doubled.
 */
export function toCSV(cells: string[][]): string {
  const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return cells.map((row) => row.map(escape).join(",")).join("\r\n");
}

/**
 * Parse CSV text into a rectangular grid. Handles quoted fields, escaped quotes
 * and both CRLF and LF line endings. Short rows are padded so every row has the
 * same width as the widest one.
 */
export function fromCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      pushField();
      i += 1;
    } else if (ch === "\r") {
      // Swallow CR; the following LF (if any) triggers the row break.
      i += 1;
      if (text[i] !== "\n") pushRow();
    } else if (ch === "\n") {
      pushRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  // Flush the trailing field/row unless the file ended on a clean line break.
  if (field.length > 0 || row.length > 0) pushRow();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 1);
  return rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill("")] : r));
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** File-picker `accept` string for the spreadsheet importer (CSV + XLSX). */
export const SPREADSHEET_ACCEPT = ".csv,.xlsx,text/csv," + XLSX_MIME;

/** True when the file is an Excel workbook (`.xlsx`). */
export function isXlsxFile(file: File): boolean {
  return file.type === XLSX_MIME || file.name.toLowerCase().endsWith(".xlsx");
}

/** True when the file looks like a CSV export (by MIME type or extension). */
export function isCsvFile(file: File): boolean {
  return (
    file.type === "text/csv" ||
    file.type === "application/csv" ||
    file.type === "application/vnd.ms-excel" ||
    file.name.toLowerCase().endsWith(".csv")
  );
}

/**
 * True when the file is a spreadsheet the workspace should open as a *table*
 * node (CSV or XLSX) rather than as a plain-text document. Used so a table
 * dropped onto the canvas stays a table instead of collapsing into text.
 */
export function isSpreadsheetFile(file: File): boolean {
  return isXlsxFile(file) || isCsvFile(file);
}

/**
 * Read a spreadsheet file into a grid, dispatching on its type: `.xlsx`
 * workbooks are unpacked via the Office helpers, everything else is parsed as
 * CSV. The Office codec is imported lazily so it only loads when needed.
 */
export async function readSpreadsheetFile(file: File): Promise<string[][]> {
  if (isXlsxFile(file)) {
    const { xlsxToGrid } = await import("./office");
    return xlsxToGrid(new Uint8Array(await file.arrayBuffer()));
  }
  return fromCSV(await file.text());
}

/** Trigger a browser download of a grid as an `.xlsx` workbook. */
export async function downloadXLSX(fileName: string, cells: string[][]): Promise<void> {
  const base = (fileName || "таблица").replace(/[\\/:*?"<>|]+/g, "").trim() || "таблица";
  const name = base.toLowerCase().endsWith(".xlsx") ? base : `${base}.xlsx`;
  const { gridToXlsx } = await import("./office");
  const bytes = await gridToXlsx(cells);
  // Copy into a fresh ArrayBuffer-backed view so it satisfies BlobPart.
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const blob = new Blob([buf], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of a grid as a CSV file (UTF-8 with BOM). */
export function downloadCSV(fileName: string, cells: string[][]): void {
  const base = (fileName || "таблица").replace(/[\\/:*?"<>|]+/g, "").trim() || "таблица";
  const name = base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
  // Prefix a BOM so Excel opens UTF-8 (Cyrillic) correctly.
  const blob = new Blob(["\uFEFF" + toCSV(cells)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
