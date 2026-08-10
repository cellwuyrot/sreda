"use client";

// FIX-DRAW: встроенный редактор рисунков — мини-«фотошоп» для рабочей среды и чата.
// Инструменты: карандаш, ластик, линия, стрелка, прямоугольник, эллипс;
// палитра цветов, толщина линии, заливка фигур, отмена/повтор (Ctrl+Z / Ctrl+Y),
// экспорт в PNG (data URL) через onSave.

import { useCallback, useEffect, useRef, useState } from "react";

export type DrawTool = "pencil" | "eraser" | "line" | "arrow" | "rect" | "ellipse";

type Point = { x: number; y: number };

const COLORS = [
  "#111111", "#ffffff", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

const TOOLS: Array<{ id: DrawTool; label: string; icon: string }> = [
  { id: "pencil", label: "Карандаш", icon: "✏️" },
  { id: "eraser", label: "Ластик", icon: "🧽" },
  { id: "line", label: "Линия", icon: "╱" },
  { id: "arrow", label: "Стрелка", icon: "➜" },
  { id: "rect", label: "Прямоугольник", icon: "▭" },
  { id: "ellipse", label: "Эллипс", icon: "◯" },
];

const MAX_UNDO = 40;
const MAX_W = 1280;
const MAX_H = 800;
const DEFAULT_W = 960;
const DEFAULT_H = 600;

export default function DrawingEditor({
  initialImage,
  title = "Редактор рисунка",
  saveLabel = "Сохранить",
  onSave,
  onClose,
}: {
  /** Существующее изображение (URL или data URL), которое загружается на холст. */
  initialImage?: string;
  title?: string;
  saveLabel?: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<DrawTool>("pencil");
  const [color, setColor] = useState("#111111");
  const [stroke, setStroke] = useState(4);
  const [fill, setFill] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const drawingRef = useRef(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const lastRef = useRef<Point>({ x: 0, y: 0 });
  const initialImgRef = useRef<HTMLImageElement | null>(null);

  // 1) Определяем размер холста: по исходной картинке (с масштабированием до
  // MAX_W×MAX_H) или холст по умолчанию.
  useEffect(() => {
    let cancelled = false;
    if (!initialImage) {
      setSize({ w: DEFAULT_W, h: DEFAULT_H });
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
      initialImgRef.current = img;
      setSize({
        w: Math.max(1, Math.round(img.width * scale)),
        h: Math.max(1, Math.round(img.height * scale)),
      });
    };
    img.onerror = () => {
      if (!cancelled) setSize({ w: DEFAULT_W, h: DEFAULT_H });
    };
    img.src = initialImage;
    return () => {
      cancelled = true;
    };
  }, [initialImage]);

  // 2) Когда размер известен и холст смонтирован — белый фон + исходная картинка.
  useEffect(() => {
    if (!size) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.w, size.h);
    const img = initialImgRef.current;
    if (img) ctx.drawImage(img, 0, 0, size.w, size.h);
  }, [size]);

  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snap = canvas.toDataURL("image/png");
    setUndoStack((s) => [...s.slice(-(MAX_UNDO - 1)), snap]);
    setRedoStack([]);
  }, []);

  const restore = useCallback((dataUrl: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  }, []);

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const canvas = canvasRef.current;
      if (canvas) setRedoStack((r) => [...r, canvas.toDataURL("image/png")]);
      restore(s[s.length - 1]);
      return s.slice(0, -1);
    });
  }, [restore]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const canvas = canvasRef.current;
      if (canvas) setUndoStack((s) => [...s, canvas.toDataURL("image/png")]);
      restore(r[r.length - 1]);
      return r.slice(0, -1);
    });
  }, [restore]);

  // Горячие клавиши: Escape — закрыть, Ctrl/Cmd+Z — отмена, Ctrl/Cmd+Y или
  // Ctrl/Cmd+Shift+Z — повтор.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, undo, redo]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const applyStrokeStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.fillStyle = color;
    ctx.lineWidth = tool === "eraser" ? stroke * 3 : stroke;
  };

  const drawShape = (ctx: CanvasRenderingContext2D, from: Point, to: Point) => {
    applyStrokeStyle(ctx);
    ctx.beginPath();
    if (tool === "line" || tool === "arrow") {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      if (tool === "arrow") {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const head = Math.max(10, ctx.lineWidth * 3);
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
          to.x - head * Math.cos(angle - Math.PI / 6),
          to.y - head * Math.sin(angle - Math.PI / 6),
        );
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
          to.x - head * Math.cos(angle + Math.PI / 6),
          to.y - head * Math.sin(angle + Math.PI / 6),
        );
        ctx.stroke();
      }
    } else if (tool === "rect") {
      const x = Math.min(from.x, to.x);
      const y = Math.min(from.y, to.y);
      const w = Math.abs(to.x - from.x);
      const h = Math.abs(to.y - from.y);
      if (fill) ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    } else if (tool === "ellipse") {
      const cx = (from.x + to.x) / 2;
      const cy = (from.y + to.y) / 2;
      const rx = Math.abs(to.x - from.x) / 2;
      const ry = Math.abs(to.y - from.y) / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (fill) ctx.fill();
      ctx.stroke();
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pushUndo();
    drawingRef.current = true;
    const p = getPos(e);
    startRef.current = p;
    lastRef.current = p;
    if (tool === "pencil" || tool === "eraser") {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      applyStrokeStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.01, p.y + 0.01);
      ctx.stroke();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const p = getPos(e);
    if (tool === "pencil" || tool === "eraser") {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      applyStrokeStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
    } else {
      const overlay = overlayRef.current;
      const ctx = overlay?.getContext("2d");
      if (!overlay || !ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      drawShape(ctx, startRef.current, p);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const p = getPos(e);
    if (tool !== "pencil" && tool !== "eraser") {
      const overlay = overlayRef.current;
      const octx = overlay?.getContext("2d");
      if (overlay && octx) octx.clearRect(0, 0, overlay.width, overlay.height);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawShape(ctx, startRef.current, p);
    }
  };

  const clearAll = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    pushUndo();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/png"));
    onClose();
  };

  const toolBtn =
    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors";
  const showFill = tool === "rect" || tool === "ellipse";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-fit max-w-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-4 py-2.5 dark:border-white/10">
          <div className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-lg px-2 py-1 text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-white/10">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              title={t.label}
              className={`${toolBtn} ${
                tool === t.id
                  ? "border-violet-600 bg-violet-600/10 text-violet-600 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-400"
                  : "border-neutral-200 text-neutral-500 hover:text-neutral-900 dark:border-white/10 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}

          <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" aria-hidden />

          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              title={c}
              aria-label={`Цвет ${c}`}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${
                color === c
                  ? "scale-110 border-violet-600 dark:border-cyan-400"
                  : "border-neutral-300 dark:border-white/20"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Свой цвет"
            aria-label="Свой цвет"
            className="h-7 w-8 cursor-pointer rounded border border-neutral-200 bg-transparent p-0.5 dark:border-white/10"
          />

          <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" aria-hidden />

          <label className="flex items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
            Толщина
            <input
              type="range"
              min={1}
              max={24}
              value={stroke}
              onChange={(e) => setStroke(Number(e.target.value))}
              className="w-24 accent-violet-600 dark:accent-cyan-400"
            />
            <span className="w-6 tabular-nums">{stroke}</span>
          </label>

          {showFill && (
            <label className="flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={fill}
                onChange={(e) => setFill(e.target.checked)}
                className="accent-violet-600 dark:accent-cyan-400"
              />
              Заливка
            </label>
          )}

          <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" aria-hidden />

          <button
            type="button"
            onClick={undo}
            disabled={undoStack.length === 0}
            title="Отменить (Ctrl+Z)"
            className={`${toolBtn} border-neutral-200 text-neutral-500 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-neutral-400 dark:hover:text-white`}
          >
            ↩ Отменить
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={redoStack.length === 0}
            title="Вернуть (Ctrl+Y)"
            className={`${toolBtn} border-neutral-200 text-neutral-500 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-neutral-400 dark:hover:text-white`}
          >
            ↪ Вернуть
          </button>
          <button
            type="button"
            onClick={clearAll}
            title="Очистить холст"
            className={`${toolBtn} border-neutral-200 text-neutral-500 hover:text-red-500 dark:border-white/10 dark:text-neutral-400 dark:hover:text-red-400`}
          >
            Очистить
          </button>
        </div>

        <div className="relative overflow-auto bg-neutral-100 p-3 dark:bg-neutral-950">
          {size ? (
            <div className="relative mx-auto w-fit">
              <canvas
                ref={canvasRef}
                width={size.w}
                height={size.h}
                className="block max-h-[70vh] max-w-full rounded-lg border border-neutral-200 bg-white dark:border-white/10"
                style={{ touchAction: "none" }}
              />
              <canvas
                ref={overlayRef}
                width={size.w}
                height={size.h}
                className="absolute inset-0 h-full w-full cursor-crosshair rounded-lg"
                style={{ touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
          ) : (
            <div className="px-16 py-24 text-sm text-neutral-400">Загрузка…</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-2.5 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-[13px] text-neutral-500 transition-colors hover:text-neutral-900 dark:border-white/10 dark:text-neutral-400 dark:hover:text-white"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-violet-500 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
