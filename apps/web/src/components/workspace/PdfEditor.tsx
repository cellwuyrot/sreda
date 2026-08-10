"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentCard, PdfAnnotation, newId } from "./types";
import { loadPdf, exportAnnotatedPdf, extractPageText, ExtractedTextRun, LINE_HEIGHT } from "./pdf";
import { DocumentIcon, DownloadIcon, ExternalIcon, PlusIcon, TrashIcon } from "./icons";

type CSS = React.CSSProperties;

/** Minimal shape of a pdf.js render task — enough to await and cancel it. */
interface RenderTaskLike {
  promise: Promise<void>;
  cancel: () => void;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const MIN_FONT = 8;
const MAX_FONT = 72;
const DEFAULT_FONT = 16;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * PDF viewer + annotation editor. Renders one page at a time with pdf.js and
 * lets the user drop, drag and edit text annotations on top. Annotations are
 * stored on the card (non-destructive); "Скачать PDF" flattens them into a
 * downloadable file.
 */
export default function PdfEditor({
  card,
  patch,
  pdfUrl,
}: {
  card: DocumentCard;
  patch: (p: Partial<DocumentCard>) => void;
  pdfUrl: string | null;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<"select" | "text">("select");
  const [textLayer, setTextLayer] = useState(false);
  const [pageRuns, setPageRuns] = useState<ExtractedTextRun[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTaskLike | null>(null);
  const pageDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  // Extracted text runs cached per page so re-visiting a page is instant.
  const runsCacheRef = useRef<Map<number, ExtractedTextRun[]>>(new Map());

  const annotations = card.annotations ?? [];
  const pageAnnotations = annotations.filter((a) => a.page === pageIndex);
  // Notes (free-floating) vs. edits of the PDF's own text layer.
  const pageNotes = pageAnnotations.filter((a) => a.origin === undefined);
  const pageEdits = pageAnnotations.filter((a) => a.origin !== undefined);
  /** Deterministic id so re-editing the same run updates one annotation. */
  const runKey = (page: number, i: number) => `pt-${page}-${i}`;

  const setAnnotations = useCallback(
    (next: PdfAnnotation[]) => patch({ annotations: next }),
    [patch],
  );

  const updateAnnotation = useCallback(
    (id: string, p: Partial<PdfAnnotation>) =>
      setAnnotations((card.annotations ?? []).map((a) => (a.id === id ? { ...a, ...p } : a))),
    [card.annotations, setAnnotations],
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      setAnnotations((card.annotations ?? []).filter((a) => a.id !== id));
      setSelectedId((s) => (s === id ? null : s));
      setEditingId((e) => (e === id ? null : e));
    },
    [card.annotations, setAnnotations],
  );

  // Parse the stored PDF and pick an initial fit-to-width zoom.
  useEffect(() => {
    let cancelled = false;
    if (!card.src) {
      setDoc(null);
      setNumPages(0);
      return;
    }
    setError("");
    loadPdf(card.src)
      .then(async (loaded) => {
        if (cancelled) return;
        setDoc(loaded);
        setNumPages(loaded.numPages);
        setPageIndex(0);
        const page = await loaded.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        // Fall back to a sensible width when the container hasn't been laid out
        // yet (clientWidth can be 0 on the first tick inside the modal).
        const cw = containerRef.current?.clientWidth || 800;
        if (!cancelled) setScale(clampScale((cw - 24) / vp.width));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось открыть PDF.");
      });
    return () => {
      cancelled = true;
    };
  }, [card.src]);

  // Render the current page whenever the document, page or zoom changes.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
    doc.getPage(pageIndex + 1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const unscaled = page.getViewport({ scale: 1 });
      pageDimsRef.current = { w: unscaled.width, h: unscaled.height };
      setView({ w: canvas.width, h: canvas.height });
      const task = page.render({ canvasContext: ctx, viewport }) as unknown as RenderTaskLike;
      renderTaskRef.current = task;
      task.promise.catch(() => {
        /* cancelled renders reject — ignore */
      });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, scale]);

  // A freshly loaded document invalidates any cached text runs.
  useEffect(() => {
    runsCacheRef.current = new Map();
    setPageRuns(null);
  }, [doc]);

  // While the text layer is on, load (and cache) the current page's text runs.
  useEffect(() => {
    if (!textLayer || !doc) {
      setPageRuns(null);
      return;
    }
    const cached = runsCacheRef.current.get(pageIndex);
    if (cached) {
      setPageRuns(cached);
      return;
    }
    let cancelled = false;
    setExtracting(true);
    extractPageText(doc, pageIndex)
      .then((runs) => {
        if (cancelled) return;
        runsCacheRef.current.set(pageIndex, runs);
        setPageRuns(runs);
      })
      .catch(() => {
        if (!cancelled) setPageRuns([]);
      })
      .finally(() => {
        if (!cancelled) setExtracting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [textLayer, doc, pageIndex]);

  /** Upsert (or clear) the edit annotation for run `i` on the current page. */
  const setRunText = useCallback(
    (i: number, run: ExtractedTextRun, text: string) => {
      const key = runKey(pageIndex, i);
      const rest = (card.annotations ?? []).filter((a) => a.id !== key);
      // Reverting to the original text drops the edit entirely.
      if (text === run.text) {
        setAnnotations(rest);
        return;
      }
      const edit: PdfAnnotation = {
        id: key,
        page: pageIndex,
        x: run.x,
        y: run.y,
        size: run.size,
        text,
        origin: run.text,
        boxW: run.width,
      };
      setAnnotations([...rest, edit]);
    },
    [pageIndex, card.annotations, setAnnotations],
  );

  // Place a new annotation where the user clicks while in "text" mode.
  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (mode !== "text") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const ann: PdfAnnotation = { id: newId(), page: pageIndex, x, y, text: "", size: DEFAULT_FONT };
    setAnnotations([...(card.annotations ?? []), ann]);
    setSelectedId(ann.id);
    setEditingId(ann.id);
    setMode("select");
  };

  const onAnnPointerDown = (e: React.PointerEvent, ann: PdfAnnotation) => {
    if (editingId === ann.id) return; // let the textarea handle it
    e.stopPropagation();
    setSelectedId(ann.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: ann.id, sx: e.clientX, sy: e.clientY, ox: ann.x, oy: ann.y, moved: false };
  };

  const onAnnPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    const dims = pageDimsRef.current;
    const nx = Math.max(0, Math.min(dims.w, d.ox + dx));
    const ny = Math.max(0, Math.min(dims.h, d.oy + dy));
    updateAnnotation(d.id, { x: nx, y: ny });
  };

  const onAnnPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d) (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const changeFont = (id: string, delta: number) => {
    const ann = (card.annotations ?? []).find((a) => a.id === id);
    if (!ann) return;
    updateAnnotation(id, { size: Math.max(MIN_FONT, Math.min(MAX_FONT, ann.size + delta)) });
  };

  const onExport = async () => {
    if (!card.src) return;
    setBusy(true);
    setError("");
    try {
      await exportAnnotatedPdf(card.src, annotations, card.fileName || card.title || "документ.pdf");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить PDF.");
    } finally {
      setBusy(false);
    }
  };

  const selected = selectedId ? annotations.find((a) => a.id === selectedId) ?? null : null;
  const wrapStyle: CSS = { width: view.w || undefined, height: view.h || undefined };
  const zoomPct = Math.round(scale * 100);

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium " +
    "text-neutral-700 transition-colors hover:border-neutral-400 disabled:opacity-30 disabled:hover:border-neutral-200 " +
    "dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500";
  const iconBtn =
    "flex h-7 w-7 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 " +
    "dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Editor toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        {/* Pages */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconBtn}
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            disabled={pageIndex <= 0}
            aria-label="Предыдущая страница"
          >
            ‹
          </button>
          <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            стр {numPages ? pageIndex + 1 : 0} / {numPages}
          </span>
          <button
            type="button"
            className={iconBtn}
            onClick={() => setPageIndex((i) => Math.min(numPages - 1, i + 1))}
            disabled={pageIndex >= numPages - 1}
            aria-label="Следующая страница"
          >
            ›
          </button>
        </div>

        <span className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button type="button" className={iconBtn} onClick={() => setScale((s) => clampScale(s / 1.15))} aria-label="Отдалить">
            −
          </button>
          <span className="min-w-[3rem] text-center text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{zoomPct}%</span>
          <button type="button" className={iconBtn} onClick={() => setScale((s) => clampScale(s * 1.15))} aria-label="Приблизить">
            +
          </button>
        </div>

        <span className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />

        {/* Edit the PDF's own text layer */}
        <button
          type="button"
          onClick={() => {
            setTextLayer((t) => !t);
            setMode("select");
            setSelectedId(null);
            setEditingId(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            textLayer
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-950"
              : "border-neutral-200 text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
          }`}
          title="Редактировать текст самого PDF"
        >
          <DocumentIcon size={14} /> Править текст
        </button>

        {/* Add a free-floating note */}
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "text" ? "select" : "text"));
            setTextLayer(false);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            mode === "text"
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-950"
              : "border-neutral-200 text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
          }`}
          title="Добавить текстовую надпись поверх страницы"
        >
          <PlusIcon size={14} /> Надпись
        </button>

        {/* Selected annotation controls */}
        {selected && (
          <div className="flex items-center gap-1 rounded-lg border border-neutral-200 px-1.5 py-1 dark:border-neutral-700">
            <span className="px-1 text-[11px] text-neutral-400 dark:text-neutral-500">Размер</span>
            <button type="button" className={iconBtn} onClick={() => changeFont(selected.id, -2)} aria-label="Меньше шрифт">
              A−
            </button>
            <span className="min-w-[2rem] text-center text-xs tabular-nums text-neutral-600 dark:text-neutral-300">{selected.size}</span>
            <button type="button" className={iconBtn} onClick={() => changeFont(selected.id, 2)} aria-label="Больше шрифт">
              A+
            </button>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
              onClick={() => removeAnnotation(selected.id)}
              aria-label="Удалить надпись"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={btn} title="Открыть оригинал в новой вкладке">
              <ExternalIcon size={14} /> Оригинал
            </a>
          )}
          <button
            type="button"
            onClick={onExport}
            disabled={busy || !card.src}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            title="Скачать PDF с правками"
          >
            <DownloadIcon size={14} /> {busy ? "Сохранение…" : "Скачать PDF"}
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-300">
          {error}
        </div>
      )}

      {/* Hint */}
      <div className="border-b border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        {textLayer
          ? extracting
            ? "Читаю текстовый слой страницы…"
            : pageRuns && pageRuns.length === 0
              ? "На этой странице нет выделяемого текста (возможно, скан). Добавьте надпись поверх."
              : "Кликните по фрагменту текста и правьте его прямо на странице · изменяются только правленые фрагменты."
          : mode === "text"
            ? "Кликните по странице, чтобы поставить надпись."
            : "«Править текст» — редактировать текст PDF · «Надпись» — добавить подпись поверх · правки сохраняются автоматически."}
      </div>

      {/* Page canvas + annotation overlay */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-neutral-100 p-3 dark:bg-neutral-950/60"
        onPointerDown={() => setSelectedId(null)}
      >
        {!card.src ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">Файл не загружен.</div>
        ) : (
          <div className="mx-auto" style={wrapStyle}>
            <div className="relative shadow-sm" style={wrapStyle}>
              <canvas ref={canvasRef} className="block rounded-sm bg-white" />
              {/* Annotation layer */}
              <div
                className="absolute inset-0"
                style={{ cursor: mode === "text" ? "crosshair" : "default" }}
                onPointerDown={(e) => {
                  // Only handle clicks on the empty layer (not on an annotation).
                  if (e.target === e.currentTarget) {
                    onOverlayPointerDown(e);
                    if (mode !== "text") setSelectedId(null);
                  }
                }}
              >
                {pageNotes.map((ann) => {
                  const isEditing = editingId === ann.id;
                  const style: CSS = {
                    left: ann.x * scale,
                    top: ann.y * scale,
                    fontSize: ann.size * scale,
                    lineHeight: LINE_HEIGHT,
                  };
                  if (isEditing) {
                    return (
                      <textarea
                        key={ann.id}
                        autoFocus
                        value={ann.text}
                        onChange={(e) => updateAnnotation(ann.id, { text: e.target.value })}
                        onBlur={() => {
                          setEditingId(null);
                          if (!ann.text.trim()) removeAnnotation(ann.id);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") {
                            e.preventDefault();
                            (e.currentTarget as HTMLTextAreaElement).blur();
                          }
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="absolute z-10 resize-none whitespace-pre rounded-[3px] border border-neutral-900/60 bg-white/95 px-1 py-0 font-sans text-neutral-900 shadow-sm outline-none dark:border-white/70"
                        style={{ ...style, minWidth: 40 * scale + 20, minHeight: ann.size * scale * LINE_HEIGHT + 6 }}
                        spellCheck={false}
                      />
                    );
                  }
                  return (
                    <div
                      key={ann.id}
                      onPointerDown={(e) => onAnnPointerDown(e, ann)}
                      onPointerMove={onAnnPointerMove}
                      onPointerUp={onAnnPointerUp}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingId(ann.id);
                        setSelectedId(ann.id);
                      }}
                      className={`absolute whitespace-pre rounded-[3px] px-1 font-sans text-neutral-900 ${
                        selectedId === ann.id ? "outline outline-1 outline-neutral-900/70 dark:outline-white/70" : ""
                      }`}
                      style={{ ...style, cursor: mode === "text" ? "crosshair" : "move" }}
                      title="Перетащите · двойной клик — редактировать"
                    >
                      {ann.text || "\u00A0"}
                    </div>
                  );
                })}

                {/* Text-layer editing: one editable box over each extracted run.
                    Boxes sit on an opaque background so they mask the original
                    glyphs beneath; a ring marks runs whose text was changed. */}
                {textLayer &&
                  pageRuns &&
                  pageRuns.map((run, i) => {
                    const key = runKey(pageIndex, i);
                    const edit = pageEdits.find((a) => a.id === key);
                    const changed = edit !== undefined;
                    const st: CSS = {
                      left: run.x * scale,
                      top: run.y * scale,
                      width: Math.max(run.width * scale, 8) + 10,
                      height: run.size * scale * LINE_HEIGHT + 2,
                      fontSize: run.size * scale,
                      lineHeight: LINE_HEIGHT,
                    };
                    return (
                      <input
                        key={key}
                        value={edit ? edit.text : run.text}
                        onChange={(e) => setRunText(i, run, e.target.value)}
                        onPointerDown={(e) => e.stopPropagation()}
                        spellCheck={false}
                        title={changed ? `Оригинал: ${run.text}` : "Правьте текст этого фрагмента"}
                        className={`absolute z-10 rounded-[2px] bg-white px-0.5 py-0 font-sans text-neutral-900 outline-none ${
                          changed
                            ? "ring-1 ring-neutral-900/60 dark:ring-white/70"
                            : "ring-0 hover:ring-1 hover:ring-neutral-400/70 focus:ring-1 focus:ring-neutral-900/50"
                        }`}
                        style={st}
                      />
                    );
                  })}

                {/* View mode: applied text edits, masking the original run. */}
                {!textLayer &&
                  pageEdits.map((ann) => (
                    <div
                      key={ann.id}
                      className="absolute whitespace-pre bg-white px-0.5 font-sans text-neutral-900"
                      style={{
                        left: ann.x * scale,
                        top: ann.y * scale,
                        minWidth: (ann.boxW ?? 0) * scale,
                        minHeight: ann.size * scale * LINE_HEIGHT,
                        fontSize: ann.size * scale,
                        lineHeight: LINE_HEIGHT,
                      }}
                      title={`Изменено (было: ${ann.origin ?? ""})`}
                    >
                      {ann.text || "\u00A0"}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
