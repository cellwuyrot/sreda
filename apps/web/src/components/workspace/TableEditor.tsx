"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TableCard } from "./types";
import {
  colCount,
  downloadCSV,
  downloadXLSX,
  insertCol,
  insertRow,
  insertSize,
  normalizeSizes,
  readSpreadsheetFile,
  removeCol,
  removeRow,
  removeSize,
  setCell,
  setSize,
  SPREADSHEET_ACCEPT,
  DEFAULT_COL_WIDTH,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
} from "./table";
import { GridResizeHandle } from "./GridResizeHandle";
import { CloseIcon, DownloadIcon, PlusIcon, UploadIcon } from "./icons";
import InfoTooltip from "@/components/ui/InfoTooltip";

/** Fixed widths (px) of the row-handle column and the trailing add-column cell. */
const HANDLE_COL_W = 36;
const ADD_COL_W = 32;

/** Rows below this count render all at once; above — virtual window. */
const VIRTUAL_THRESHOLD = 100;
/** Extra rows rendered above and below the visible range. */
const OVERSCAN = 15;
/** Max entries in the internal undo stack. */
const MAX_TABLE_HISTORY = 25;

/** 0 -> "A", 27 -> "AB" */
function colLabel(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * WS-PERF: O(log n) binary-search over a sorted Float32Array of cumulative
 * row offsets to find the first row whose cumulative offset >= `target`.
 * Returns the row *index* (0-based).
 */
function bisectLeft(offsets: Float32Array, target: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/**
 * Full-screen spreadsheet editor.
 *
 * WS-PERF improvements vs. the previous version:
 * - Virtual row windowing: only OVERSCAN rows above/below the visible area
 *   are rendered as <tr> elements. A 10 000-row table renders ~50 rows at
 *   any time instead of 10 000. Two zero-height spacer rows keep the
 *   scrollbar thumb accurate.
 * - Internal Ctrl+Z / Ctrl+Y: table-cell edits never enter the *canvas*
 *   undo stack (which would clone the full cells array 30 times). Instead,
 *   the editor keeps its own lightweight stack of cell snapshots, capped at
 *   MAX_TABLE_HISTORY entries.
 */
export default function TableEditor({
  card,
  patch,
  onClose,
}: {
  card: TableCard;
  patch: (p: Partial<TableCard>) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const cells = card.cells;
  const cols = colCount(cells);
  const setCells = (next: string[][]) => patch({ cells: next });

  // ── Internal undo stack (cell edits only) ───────────────────────────────
  const undoRef = useRef<string[][][]>([]);
  const redoRef = useRef<string[][][]>([]);

  const tblBeginHistory = useCallback(() => {
    // Snapshot rows shallowly — each inner array is immutable after setCell
    undoRef.current.push(cells.map((r) => r.slice()));
    if (undoRef.current.length > MAX_TABLE_HISTORY) undoRef.current.shift();
    redoRef.current = [];
  }, [cells]);

  const tblUndo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(cells.map((r) => r.slice()));
    setCells(prev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  const tblRedo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(cells.map((r) => r.slice()));
    setCells(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  // ── Virtual scrolling state ──────────────────────────────────────────────
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(480);

  // Effective per-column widths and per-row heights
  const widths = normalizeSizes(card.colWidths, cols, DEFAULT_COL_WIDTH);
  const heights = normalizeSizes(card.rowHeights, cells.length, DEFAULT_ROW_HEIGHT);
  const tableWidth = HANDLE_COL_W + widths.reduce((s, w) => s + w, 0) + ADD_COL_W;
  const hasCustomSizes = !!card.colWidths || !!card.rowHeights;

  /** Cumulative row offsets: offsets[i] = top of row i in pixels. */
  const rowOffsets = useMemo(() => {
    const arr = new Float32Array(cells.length + 1);
    for (let i = 0; i < cells.length; i++) arr[i + 1] = arr[i] + heights[i];
    return arr;
  }, [cells.length, heights]);

  const totalRowH = rowOffsets[cells.length] ?? 0;

  // Visible row window (with overscan)
  const firstRow = useMemo(() => {
    if (cells.length <= VIRTUAL_THRESHOLD) return 0;
    return Math.max(0, bisectLeft(rowOffsets, scrollTop) - OVERSCAN);
  }, [cells.length, rowOffsets, scrollTop]);

  const lastRow = useMemo(() => {
    if (cells.length <= VIRTUAL_THRESHOLD) return cells.length;
    return Math.min(cells.length, bisectLeft(rowOffsets, scrollTop + containerH) + OVERSCAN + 1);
  }, [cells.length, rowOffsets, scrollTop, containerH]);

  const topSpacerH = rowOffsets[firstRow] ?? 0;
  const bottomSpacerH = totalRowH - (rowOffsets[lastRow] ?? totalRowH);

  // ── Scroll + resize observers ────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setContainerH(h);
    });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "z" && !e.shiftKey) { e.preventDefault(); tblUndo(); }
      if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        tblRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, tblUndo, tblRedo]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const setColW = (ci: number, w: number) =>
    patch({ colWidths: setSize(card.colWidths, cols, ci, w, DEFAULT_COL_WIDTH, MIN_COL_WIDTH, MAX_COL_WIDTH) });
  const setRowH = (ri: number, h: number) =>
    patch({ rowHeights: setSize(card.rowHeights, cells.length, ri, h, DEFAULT_ROW_HEIGHT, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT) });

  const insertColAt = (ci: number) =>
    patch({ cells: insertCol(cells, ci), colWidths: insertSize(card.colWidths, ci, DEFAULT_COL_WIDTH) });
  const insertColEnd = () =>
    patch({ cells: insertCol(cells), colWidths: insertSize(card.colWidths, cols, DEFAULT_COL_WIDTH) });
  const removeColAt = (ci: number) => {
    if (cols <= 1) return;
    patch({ cells: removeCol(cells, ci), colWidths: removeSize(card.colWidths, ci) });
  };
  const insertRowEnd = () =>
    patch({ cells: insertRow(cells), rowHeights: insertSize(card.rowHeights, cells.length, DEFAULT_ROW_HEIGHT) });
  const removeRowAt = (ri: number) => {
    if (cells.length <= 1) return;
    patch({ cells: removeRow(cells, ri), rowHeights: removeSize(card.rowHeights, ri) });
  };
  const resetSizes = () => patch({ colWidths: undefined, rowHeights: undefined });

  const onImport = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const grid = await readSpreadsheetFile(file);
      if (grid.length === 0) { setError("Файл пуст или не распознан."); return; }
      patch({ cells: grid, colWidths: undefined, rowHeights: undefined });
    } catch {
      setError("Не удалось прочитать файл. Поддерживаются CSV и XLSX.");
    }
  };

  const ctrlBtn =
    "flex h-5 w-5 items-center justify-center rounded-md text-neutral-400 " +
    "transition-colors hover:bg-neutral-200/70 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent " +
    "dark:text-neutral-500 dark:hover:bg-neutral-700/60 dark:hover:text-white";
  const headerBtn =
    "inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium " +
    "text-neutral-700 transition-colors hover:border-neutral-400 disabled:opacity-40 disabled:hover:border-neutral-200 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Таблица: ${card.title || "без названия"}`}
    >
      <div
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            Таблица{" "}
            <InfoTooltip
              side="bottom"
              text="Ширину столбцов и высоту строк можно тянуть мышью за границы. Ctrl+Z / Ctrl+Y — отмена/повтор внутри редактора. CSV и XLSX для импорта и экспорта."
            />
          </span>
          <input
            value={card.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Название таблицы"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-neutral-900 outline-none placeholder:text-neutral-300 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => patch({ hasHeader: !card.hasHeader })} className={headerBtn}>
              Заголовок: {card.hasHeader ? "вкл" : "выкл"}
            </button>
            <button type="button" onClick={resetSizes} disabled={!hasCustomSizes} className={headerBtn}
              title="Сбросить ширину столбцов и высоту строк">
              Сбросить размеры
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className={headerBtn}>
              <UploadIcon size={14} /> Импорт
            </button>
            <button type="button" onClick={() => downloadCSV(card.title || "таблица", cells)} className={headerBtn}>
              <DownloadIcon size={14} /> CSV
            </button>
            <button type="button" onClick={() => downloadXLSX(card.title || "таблица", cells)} className={headerBtn}>
              <DownloadIcon size={14} /> XLSX
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
              aria-label="Закрыть"
            >
              <CloseIcon size={16} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={SPREADSHEET_ACCEPT}
            className="hidden"
            onChange={(e) => { onImport(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>

        {error && (
          <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-300">
            {error}
          </div>
        )}

        {/* Grid — scrollable container with virtual row windowing */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto bg-neutral-50 p-4 dark:bg-neutral-950/40"
        >
          <div className="inline-block overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <table className="border-collapse text-[13px]" style={{ tableLayout: "fixed", width: tableWidth }}>
              <colgroup>
                <col style={{ width: HANDLE_COL_W }} />
                {widths.map((w, ci) => <col key={ci} style={{ width: w }} />)}
                <col style={{ width: ADD_COL_W }} />
              </colgroup>
              <thead>
                <tr className="bg-neutral-100/80 dark:bg-neutral-800/60">
                  <th className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-100/80 dark:border-neutral-700 dark:bg-neutral-800/60" />
                  {Array.from({ length: cols }).map((_, ci) => (
                    <th key={ci} className="relative border-b border-l border-neutral-200 px-2 py-1 dark:border-neutral-700">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                          {colLabel(ci)}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <button type="button" onClick={() => insertColAt(ci)} className={ctrlBtn} title="Вставить столбец слева">
                            <PlusIcon size={12} />
                          </button>
                          <button type="button" onClick={() => removeColAt(ci)} disabled={cols <= 1}
                            className={ctrlBtn} title="Удалить столбец">
                            <CloseIcon size={11} />
                          </button>
                        </span>
                      </div>
                      <GridResizeHandle axis="x" size={widths[ci]} min={MIN_COL_WIDTH} max={MAX_COL_WIDTH}
                        onResize={(w) => setColW(ci, w)} />
                    </th>
                  ))}
                  <th className="border-b border-l border-neutral-200 px-1 dark:border-neutral-700">
                    <button type="button" onClick={insertColEnd} className={ctrlBtn} title="Добавить столбец">
                      <PlusIcon size={12} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* WS-PERF: top virtual spacer */}
                {topSpacerH > 0 && (
                  <tr aria-hidden style={{ height: topSpacerH }}>
                    <td colSpan={cols + 2} style={{ padding: 0 }} />
                  </tr>
                )}

                {cells.slice(firstRow, lastRow).map((row, i) => {
                  const ri = firstRow + i;
                  const isHeader = card.hasHeader && ri === 0;
                  return (
                    <tr
                      key={ri}
                      style={{ height: heights[ri] }}
                      className={
                        isHeader
                          ? "bg-neutral-100/70 dark:bg-neutral-800/50"
                          : "hover:bg-neutral-50 even:bg-neutral-50/40 dark:hover:bg-neutral-800/40 dark:even:bg-neutral-800/20"
                      }
                    >
                      <td className="sticky left-0 z-10 relative border-b border-r border-neutral-200 bg-inherit text-center dark:border-neutral-800">
                        <button type="button" onClick={() => removeRowAt(ri)} disabled={cells.length <= 1}
                          className={`${ctrlBtn} mx-auto`} title="Удалить строку">
                          <CloseIcon size={11} />
                        </button>
                        <GridResizeHandle axis="y" size={heights[ri]} min={MIN_ROW_HEIGHT} max={MAX_ROW_HEIGHT}
                          onResize={(h) => setRowH(ri, h)} />
                      </td>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-b border-l border-neutral-100 p-0 align-top dark:border-neutral-800/70">
                          <input
                            value={cell}
                            onChange={(e) => {
                              tblBeginHistory();
                              setCells(setCell(cells, ri, ci, e.target.value));
                            }}
                            placeholder={isHeader ? "Заголовок" : ""}
                            className={`h-full w-full bg-transparent px-2.5 py-1.5 outline-none placeholder:text-neutral-300 focus:bg-white dark:placeholder:text-neutral-600 dark:focus:bg-neutral-950/40 ${
                              isHeader
                                ? "font-semibold text-neutral-800 dark:text-neutral-100"
                                : "text-neutral-700 dark:text-neutral-200"
                            }`}
                          />
                        </td>
                      ))}
                      <td className="border-b border-l border-neutral-100 dark:border-neutral-800/70" />
                    </tr>
                  );
                })}

                {/* WS-PERF: bottom virtual spacer */}
                {bottomSpacerH > 0 && (
                  <tr aria-hidden style={{ height: bottomSpacerH }}>
                    <td colSpan={cols + 2} style={{ padding: 0 }} />
                  </tr>
                )}

                {/* Add-row handle */}
                <tr>
                  <td className="sticky left-0 z-10 border-r border-neutral-200 bg-white text-center dark:border-neutral-800 dark:bg-neutral-900">
                    <button type="button" onClick={insertRowEnd} className={`${ctrlBtn} mx-auto`} title="Добавить строку">
                      <PlusIcon size={12} />
                    </button>
                  </td>
                  <td colSpan={cols + 1} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
          <span className="text-neutral-400 dark:text-neutral-500">
            {cells.length > VIRTUAL_THRESHOLD && (
              <span title="Виртуальный рендеринг активен">⚡ виртуализация</span>
            )}
          </span>
          <span className="tabular-nums">
            {cells.length} строк · {cols} столбцов
          </span>
        </div>
      </div>
    </div>
  );
}
