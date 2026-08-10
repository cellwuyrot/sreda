"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArtSurface, { type ArtStyle, type ArtTool } from "./ArtSurface";
import LayersPanel from "./LayersPanel";
import {
  MAX_CANVAS,
  MIN_CANVAS,
  addShape,
  alignShapes,
  assignToLayer,
  bringToFront,
  canEditShape,
  distributeShapes,
  duplicateShapes,
  isSafeImageSrc,
  moveShapes,
  parseScene,
  removeShapes,
  replaceShapes,
  sendToBack,
  stepOrder,
  type AlignMode,
  type ArtScene,
  type ArtShape,
} from "@/lib/tzart";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commit,
  commitFrom,
  initHistory,
  redo as historyRedo,
  reset as historyReset,
  undo as historyUndo,
  type History,
} from "@/lib/tzartHistory";

/**
 * TZartstation — редактор изображений рабочей среды.
 *
 * Заменяет прежний режим рисунка. Разница не в количестве кнопок: тот редактор
 * писал пиксели и отдавал PNG, поэтому всё нарисованное застывало навсегда, а
 * каждая отмена стоила целой картинки в памяти. Здесь на холсте лежат объекты —
 * фигуры, мазки кисти, надписи и вставленные фотографии, — разложенные по слоям.
 * Любой из них в любой момент можно передвинуть, повернуть, перекрасить,
 * притушить или отправить под соседний.
 *
 * Что взято из привычного набора «фотошопа» и почему именно это:
 *
 *   • слои с глазом, замком и прозрачностью — без них любая работа сложнее
 *     одного наброска превращается в борьбу с порядком объектов;
 *   • рамка с восемью ручками и поворотом — то, чем правят уже нарисованное;
 *   • кисть и ластик — быстрый набросок поверх снимка;
 *   • вставка картинки как объекта — снимок экрана можно обвести и подписать, не
 *     выходя в другую программу;
 *   • отмена на шестьдесят шагов, дублирование, выравнивание, порядок
 *     наложения, сетка с привязкой;
 *   • выгрузка в PNG и SVG — результат нужен снаружи.
 *
 * Чего сознательно нет: пиксельных фильтров, масок и режимов наложения. Это
 * редактор поверх рабочей доски, а не замена настоящему графическому пакету;
 * каждая из этих вещей тянет за собой растровый движок, а вместе с ним — те
 * самые мегабайты в состоянии среды, от которых мы уходили.
 *
 * Байты картинок сюда не попадают: файл уезжает в хранилище, в сцене остаётся
 * адрес. Поэтому сцена с десятком фотографий весит килобайты и не переполняет
 * рабочую среду.
 */

const PALETTE = [
  "#111827", "#ffffff", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899",
];

const TOOLS: { id: ArtTool; label: string; glyph: string; code: string }[] = [
  { id: "select", label: "Выбор и правка (V)", glyph: "⬚", code: "KeyV" },
  { id: "brush", label: "Кисть (B)", glyph: "✎", code: "KeyB" },
  { id: "eraser", label: "Ластик — удаляет объект целиком (E)", glyph: "⌫", code: "KeyE" },
  { id: "rect", label: "Прямоугольник (R)", glyph: "▭", code: "KeyR" },
  { id: "ellipse", label: "Овал (O)", glyph: "◯", code: "KeyO" },
  { id: "line", label: "Линия (L)", glyph: "╱", code: "KeyL" },
  { id: "arrow", label: "Стрелка (A)", glyph: "➜", code: "KeyA" },
  { id: "text", label: "Надпись (T)", glyph: "T", code: "KeyT" },
];

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const GRID_STEP = 20;

export function newArtId(): string {
  return `sh_${Math.random().toString(36).slice(2, 10)}`;
}

export default function TZartstationEditor({
  scene: rawScene,
  onChange,
  onClose,
  title = "TZartstation",
  channelId = null,
  readOnly = false,
}: {
  scene: unknown;
  onChange: (scene: ArtScene) => void;
  onClose: () => void;
  title?: string;
  channelId?: string | null;
  readOnly?: boolean;
}) {
  /* Пока редактор открыт, сцена принадлежит ему: снаружи она только читается
     при открытии. Иначе каждая собственная правка возвращалась бы сверху и
     перебивала то, что человек делает прямо сейчас. */
  const [history, setHistory] = useState<History<ArtScene>>(() => initHistory(parseScene(rawScene)));
  const scene = history.present;

  const [tool, setTool] = useState<ArtTool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string>(() => scene.layers[scene.layers.length - 1]!.id);
  const [zoom, setZoom] = useState(1);
  const [gridOn, setGridOn] = useState(false);
  const [snapOn, setSnapOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<ArtStyle>({
    fill: "#3b82f6",
    stroke: "#111827",
    strokeWidth: 3,
    fontSize: 24,
    opacity: 1,
  });

  const viewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const clipboardRef = useRef<ArtShape[]>([]);
  /* Состояние до начала длящейся правки (ползунок под пальцем). Пока оно есть,
     история не пополняется — шаг запишется один, по отпусканию. */
  const liveBaseRef = useRef<ArtScene | null>(null);

  const selected = useMemo(() => scene.shapes.filter((s) => selection.includes(s.id)), [scene, selection]);
  const single = selected.length === 1 ? selected[0]! : null;

  /* Текущая сцена ссылкой: нужна обработчикам, чтобы не пересоздавать их на
     каждую правку и не читать состояние внутри обновления. */
  const sceneRef = useRef(scene);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  /** Правка сцены. commit=false — правка ещё идёт, шаг истории будет один. */
  const apply = useCallback((next: ArtScene, commitStep: boolean) => {
    if (commitStep) {
      liveBaseRef.current = null;
      setHistory((h) => commit(h, next));
      return;
    }
    if (!liveBaseRef.current) liveBaseRef.current = sceneRef.current;
    setHistory((h) => historyReset(h, next));
  }, []);

  /* Отпустили кнопку мыши — длящаяся правка закончилась одним шагом. */
  useEffect(() => {
    const end = () => {
      if (!liveBaseRef.current) return;
      const base = liveBaseRef.current;
      liveBaseRef.current = null;
      setHistory((h) => commitFrom(h, base));
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  /* Наружу отдаём готовое состояние. Первый проход пропускаем: открытие
     редактора — не правка, и помечать среду изменённой из-за него незачем. */
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    onChangeRef.current(scene);
  }, [scene]);

  const editableIds = useCallback(
    (ids: string[]) => scene.shapes.filter((s) => ids.includes(s.id) && canEditShape(scene, s)).map((s) => s.id),
    [scene],
  );

  const patchSelected = useCallback(
    (patch: Partial<ArtShape>, commitStep = true) => {
      if (readOnly || selected.length === 0) return;
      const next = selected.filter((s) => canEditShape(scene, s)).map((s) => ({ ...s, ...patch }));
      if (next.length === 0) return;
      apply(replaceShapes(scene, next), commitStep);
    },
    [apply, readOnly, scene, selected],
  );

  const deleteSelected = useCallback(() => {
    if (readOnly || selection.length === 0) return;
    apply(removeShapes(scene, selection), true);
    setSelection([]);
  }, [apply, readOnly, scene, selection]);

  const duplicateSelected = useCallback(() => {
    if (readOnly || selection.length === 0) return;
    const result = duplicateShapes(scene, editableIds(selection), newArtId);
    if (result.ids.length === 0) return;
    apply(result.scene, true);
    setSelection(result.ids);
  }, [apply, editableIds, readOnly, scene, selection]);

  const undo = useCallback(() => {
    setHistory((h) => historyUndo(h));
    setSelection([]);
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => historyRedo(h));
    setSelection([]);
  }, []);

  /* ── Вставка картинки ────────────────────────────────────────────────────
     Байты уезжают в хранилище тем же путём, что вложения переписки: в сцене
     остаётся адрес. Так холст с десятком снимков весит килобайты и не
     переполняет рабочую среду. */
  const insertImage = useCallback(
    async (file: File | undefined) => {
      if (!file || readOnly) return;
      setBusy(true);
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        if (channelId) form.append("channelId", channelId);
        const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !body?.url) throw new Error(body?.error || "Не удалось загрузить картинку");
        const url = body.url;
        if (!isSafeImageSrc(url)) throw new Error("Неожиданный адрес файла");

        const size = await naturalSize(url);
        /* Вписываем в полотно: снимок экрана шириной 3000 точек иначе лёг бы
           далеко за краем, и найти его было бы нечем. */
        const k = Math.min(1, (scene.w * 0.8) / size.w, (scene.h * 0.8) / size.h);
        const w = Math.round(size.w * k);
        const h = Math.round(size.h * k);
        const shape: ArtShape = {
          id: newArtId(),
          kind: "image",
          layerId: activeLayerId,
          x: Math.round((scene.w - w) / 2),
          y: Math.round((scene.h - h) / 2),
          w,
          h,
          src: url,
        };
        apply(addShape(scene, shape), true);
        setSelection([shape.id]);
        setTool("select");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить картинку");
      } finally {
        setBusy(false);
      }
    },
    [activeLayerId, apply, channelId, readOnly, scene],
  );

  /* ── Горячие клавиши ─────────────────────────────────────────────────────
     Инструменты слушают e.code, а не e.key: на русской раскладке «B» приходит
     как «и», и клавиши перестали бы работать ровно у тех, для кого написан
     этот интерфейс. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape") {
        e.preventDefault();
        if (typing) (target as HTMLInputElement).blur();
        else if (selection.length) setSelection([]);
        else onClose();
        return;
      }
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.code === "KeyY") {
        e.preventDefault();
        redo();
        return;
      }
      if (readOnly) return;

      if (mod && e.code === "KeyD") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && e.code === "KeyA") {
        e.preventDefault();
        setSelection(scene.shapes.filter((s) => canEditShape(scene, s)).map((s) => s.id));
        return;
      }
      if (mod && e.code === "KeyC") {
        clipboardRef.current = selected;
        return;
      }
      if (mod && e.code === "KeyV") {
        if (clipboardRef.current.length === 0) return;
        e.preventDefault();
        let next = scene;
        const ids: string[] = [];
        for (const shape of clipboardRef.current) {
          const copy = { ...shape, id: newArtId(), x: shape.x + 24, y: shape.y + 24, layerId: activeLayerId };
          next = addShape(next, copy);
          ids.push(copy.id);
        }
        apply(next, true);
        setSelection(ids);
        return;
      }
      if (mod && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        if (single) apply(stepOrder(scene, single.id, e.code === "BracketRight" ? 1 : -1), true);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key.startsWith("Arrow") && selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        apply(moveShapes(scene, selection, dx, dy), true);
        return;
      }
      if (!mod) {
        const found = TOOLS.find((t) => t.code === e.code);
        if (found) setTool(found.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeLayerId,
    apply,
    deleteSelected,
    duplicateSelected,
    onClose,
    readOnly,
    redo,
    scene,
    selected,
    selection,
    single,
    undo,
  ]);

  /** Вписать полотно в видимую область. */
  const fitZoom = useCallback(() => {
    const box = viewRef.current?.getBoundingClientRect();
    if (!box) return;
    const k = Math.min((box.width - 48) / scene.w, (box.height - 48) / scene.h);
    setZoom(Math.max(0.1, Math.min(4, Math.round(k * 20) / 20)));
  }, [scene.w, scene.h]);

  const stepZoom = (direction: 1 | -1) => {
    const index = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001);
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (index < 0 ? 3 : index) + direction))]!;
    setZoom(next);
  };

  const exportAs = async (format: "png" | "svg") => {
    const svg = viewRef.current?.querySelector("svg");
    if (!svg) return;
    setBusy(true);
    setError(null);
    try {
      const markup = await serializeScene(svg, scene.w, scene.h);
      const name = title.replace(/[^\wа-яё \-]+/gi, "").trim() || "tzartstation";
      if (format === "svg") {
        download(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, `${name}.svg`);
        return;
      }
      download(await rasterize(markup, scene.w, scene.h), `${name}.png`);
    } catch {
      setError("Не удалось выгрузить изображение");
    } finally {
      setBusy(false);
    }
  };

  const alignBy = (mode: AlignMode) => apply(alignShapes(scene, editableIds(selection), mode), true);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Заголовок */}
        <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-4 py-2.5 dark:border-white/10">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</span>
            <span className="text-[11px] text-neutral-400">
              {scene.shapes.length} об. · {scene.layers.length} сл.
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => stepZoom(-1)} title="Уменьшить" className={ghostBtn}>−</button>
            <span className="w-12 text-center text-[12px] tabular-nums text-neutral-500">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => stepZoom(1)} title="Увеличить" className={ghostBtn}>+</button>
            <button type="button" onClick={fitZoom} title="Вписать в окно" className={ghostBtn}>Вписать</button>
            <button type="button" onClick={() => setZoom(1)} title="Настоящий размер" className={ghostBtn}>1:1</button>
            <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-white/10" />
            <button type="button" onClick={onClose} aria-label="Закрыть" className={ghostBtn}>✕</button>
          </div>
        </div>

        {!readOnly && (
          <>
            {/* Инструменты */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 px-4 py-2 dark:border-white/10">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.label}
                  onClick={() => setTool(t.id)}
                  className={toolBtn(tool === t.id)}
                >
                  <span aria-hidden className="text-[13px] leading-none">{t.glyph}</span>
                </button>
              ))}

              <button
                type="button"
                title="Вставить картинку"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className={toolBtn(false)}
              >
                🖼
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void insertImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />

              <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" />

              <button type="button" onClick={undo} disabled={!historyCanUndo(history)} title="Отменить (Ctrl+Z)" className={toolBtn(false)}>↩</button>
              <button type="button" onClick={redo} disabled={!historyCanRedo(history)} title="Вернуть (Ctrl+Shift+Z)" className={toolBtn(false)}>↪</button>

              <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" />

              <button
                type="button"
                title="Сетка"
                onClick={() => setGridOn((v) => !v)}
                className={toolBtn(gridOn)}
              >
                ▦
              </button>
              <button
                type="button"
                title="Привязка к сетке"
                onClick={() => setSnapOn((v) => !v)}
                className={toolBtn(snapOn)}
              >
                🧲
              </button>

              <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" />

              <label className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                Полотно
                <input
                  type="number"
                  min={MIN_CANVAS}
                  max={MAX_CANVAS}
                  value={scene.w}
                  onChange={(e) => apply({ ...scene, w: clampCanvasInput(e.target.value, scene.w) }, true)}
                  className={numInput}
                />
                ×
                <input
                  type="number"
                  min={MIN_CANVAS}
                  max={MAX_CANVAS}
                  value={scene.h}
                  onChange={(e) => apply({ ...scene, h: clampCanvasInput(e.target.value, scene.h) }, true)}
                  className={numInput}
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400" title="Фон полотна">
                Фон
                <input
                  type="color"
                  value={scene.bg ?? "#ffffff"}
                  onChange={(e) => apply({ ...scene, bg: e.target.value }, false)}
                  className={colorInput}
                />
              </label>

              {error && <span className="text-[11px] text-red-500">{error}</span>}
              {busy && <span className="text-[11px] text-neutral-400">Загрузка…</span>}
            </div>

            {/* Свойства выбранного */}
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-white/10">
              <ColorField
                label="Контур"
                value={single?.stroke ?? style.stroke}
                onChange={(color, live) => {
                  setStyle((s) => ({ ...s, stroke: color }));
                  patchSelected({ stroke: color }, !live);
                }}
              />
              <ColorField
                label="Заливка"
                value={single?.fill ?? style.fill}
                onChange={(color, live) => {
                  setStyle((s) => ({ ...s, fill: color }));
                  patchSelected({ fill: color }, !live);
                }}
              />
              <button
                type="button"
                title="Без заливки"
                onClick={() => patchSelected({ fill: undefined })}
                className={toolBtn(false)}
              >
                ⊘
              </button>

              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                Толщина
                <input
                  type="range"
                  min={1}
                  max={40}
                  value={single?.strokeWidth ?? style.strokeWidth}
                  onChange={(e) => {
                    const strokeWidth = Number(e.target.value);
                    setStyle((s) => ({ ...s, strokeWidth }));
                    patchSelected({ strokeWidth }, false);
                  }}
                  className="h-1 w-20 accent-violet-600 dark:accent-cyan-400"
                />
              </label>

              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                Прозрачность
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round((single?.opacity ?? style.opacity) * 100)}
                  onChange={(e) => {
                    const opacity = Number(e.target.value) / 100;
                    setStyle((s) => ({ ...s, opacity }));
                    patchSelected({ opacity }, false);
                  }}
                  className="h-1 w-20 accent-violet-600 dark:accent-cyan-400"
                />
              </label>

              {(single?.kind === "text" || tool === "text") && (
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Кегль
                  <input
                    type="number"
                    min={8}
                    max={200}
                    value={single?.fontSize ?? style.fontSize}
                    onChange={(e) => {
                      const fontSize = Math.max(8, Math.min(200, Number(e.target.value) || 18));
                      setStyle((s) => ({ ...s, fontSize }));
                      patchSelected({ fontSize });
                    }}
                    className={numInput}
                  />
                </label>
              )}

              {single?.kind === "text" && (
                <>
                  <button type="button" title="Полужирный" onClick={() => patchSelected({ bold: !single.bold })} className={toolBtn(!!single.bold)}>
                    <b>Ж</b>
                  </button>
                  <button type="button" title="Курсив" onClick={() => patchSelected({ italic: !single.italic })} className={toolBtn(!!single.italic)}>
                    <i>К</i>
                  </button>
                  <input
                    value={single.text ?? ""}
                    onChange={(e) => patchSelected({ text: e.target.value.slice(0, 500) }, false)}
                    placeholder="Текст надписи"
                    className="min-w-[160px] flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-white/10 dark:bg-neutral-800"
                  />
                </>
              )}

              <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" />

              <button type="button" title="На передний план" disabled={!single} onClick={() => single && apply(bringToFront(scene, single.id), true)} className={toolBtn(false)}>⤒</button>
              <button type="button" title="На задний план" disabled={!single} onClick={() => single && apply(sendToBack(scene, single.id), true)} className={toolBtn(false)}>⤓</button>
              <button type="button" title="Дублировать (Ctrl+D)" disabled={!selection.length} onClick={duplicateSelected} className={toolBtn(false)}>⧉</button>
              <button type="button" title="Удалить (Del)" disabled={!selection.length} onClick={deleteSelected} className={toolBtn(false)}>🗑</button>

              {selected.length > 1 && (
                <>
                  <span className="mx-1 h-6 w-px bg-neutral-200 dark:bg-white/10" />
                  <button type="button" title="Выровнять по левому краю" onClick={() => alignBy("left")} className={toolBtn(false)}>⇤</button>
                  <button type="button" title="Выровнять по центру" onClick={() => alignBy("hcenter")} className={toolBtn(false)}>⇹</button>
                  <button type="button" title="Выровнять по правому краю" onClick={() => alignBy("right")} className={toolBtn(false)}>⇥</button>
                  <button type="button" title="Выровнять по верху" onClick={() => alignBy("top")} className={toolBtn(false)}>⤒</button>
                  <button type="button" title="Выровнять по низу" onClick={() => alignBy("bottom")} className={toolBtn(false)}>⤓</button>
                  <button type="button" title="Разложить по горизонтали" onClick={() => apply(distributeShapes(scene, editableIds(selection), "x"), true)} className={toolBtn(false)}>≡</button>
                </>
              )}

              {selection.length > 0 && scene.layers.length > 1 && (
                <select
                  title="Перенести на слой"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    apply(assignToLayer(scene, editableIds(selection), e.target.value), true);
                    e.target.value = "";
                  }}
                  className="rounded-lg border border-neutral-200 bg-white px-1.5 py-1 text-[11px] dark:border-white/10 dark:bg-neutral-800"
                >
                  <option value="">На слой…</option>
                  {scene.layers.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}
            </div>
          </>
        )}

        {/* Холст и слои */}
        <div className="flex min-h-0 flex-1">
          <div ref={viewRef} className="flex-1 overflow-auto bg-neutral-200/70 p-6 dark:bg-neutral-950">
            <div className="mx-auto w-fit shadow-lg">
              <ArtSurface
                scene={scene}
                onChange={apply}
                tool={tool}
                style={style}
                selection={selection}
                onSelection={setSelection}
                onDrawEnd={() => setTool("select")}
                activeLayerId={activeLayerId}
                readOnly={readOnly}
                zoom={zoom}
                grid={gridOn || snapOn ? GRID_STEP : 0}
                makeId={newArtId}
                className="block"
              />
            </div>
          </div>

          {!readOnly && (
            <LayersPanel
              scene={scene}
              activeLayerId={activeLayerId}
              onActiveLayer={setActiveLayerId}
              onChange={apply}
              makeId={() => `ly_${Math.random().toString(36).slice(2, 8)}`}
            />
          )}
        </div>

        {/* Низ */}
        <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-2.5 dark:border-white/10">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void exportAs("png")} className={ghostBtn} title="Выгрузить растровую картинку">
              PNG
            </button>
            <button type="button" onClick={() => void exportAs("svg")} className={ghostBtn} title="Выгрузить векторный файл">
              SVG
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-violet-500 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Мелочи разметки ───────────────────────────────────────────────────────── */

const ghostBtn =
  "rounded-lg border border-neutral-200 px-2 py-1 text-[12px] text-neutral-500 transition-colors hover:text-neutral-900 disabled:opacity-30 dark:border-white/10 dark:text-neutral-400 dark:hover:text-white";

const numInput =
  "w-16 rounded-md border border-neutral-200 bg-white px-1 py-0.5 text-[11px] dark:border-white/10 dark:bg-neutral-800";

const colorInput =
  "h-6 w-7 cursor-pointer rounded border border-neutral-200 bg-transparent p-0.5 dark:border-white/10";

function toolBtn(active: boolean): string {
  return `flex h-7 w-7 items-center justify-center rounded-lg border text-[12px] transition-colors disabled:opacity-30 ${
    active
      ? "border-violet-600 bg-violet-600/10 text-violet-600 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-400"
      : "border-neutral-200 text-neutral-500 hover:text-neutral-900 dark:border-white/10 dark:text-neutral-400 dark:hover:text-white"
  }`;
}

function clampCanvasInput(value: string, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, Math.round(n)));
}

/** Палитра плюс свой цвет. Живое значение из палитры пишется сразу шагом. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string, live: boolean) => void;
}) {
  return (
    <span className="flex items-center gap-1" title={label}>
      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</span>
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${label}: ${color}`}
          onClick={() => onChange(color, false)}
          className={`h-4 w-4 rounded-full border ${
            value === color ? "border-neutral-900 dark:border-white" : "border-neutral-300 dark:border-white/20"
          }`}
          style={{ background: color }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value, true)}
        aria-label={`${label}: свой цвет`}
        className={colorInput}
      />
    </span>
  );
}

/* ── Выгрузка ──────────────────────────────────────────────────────────────── */

/** Размер картинки в её собственных точках. */
function naturalSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 640, h: img.naturalHeight || 480 });
    img.onerror = () => resolve({ w: 640, h: 480 });
    img.src = src;
  });
}

/**
 * Разметка сцены для выгрузки.
 *
 * Две вещи, без которых файл выходит не тем, что на экране: со снимка убираются
 * рамки выделения и сетка (это интерфейс, а не рисунок), а адреса картинок
 * заменяются самими байтами. Второе обязательно: SVG, открытый как картинка, по
 * соображениям безопасности не подгружает ничего снаружи, и все вставленные
 * снимки в выгрузке оказались бы пустыми прямоугольниками.
 */
async function serializeScene(svg: SVGSVGElement, width: number, height: number): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.querySelectorAll("[data-export='skip']").forEach((node) => node.remove());

  const images = Array.from(clone.querySelectorAll("image"));
  await Promise.all(
    images.map(async (node) => {
      const href = node.getAttribute("href") || node.getAttribute("xlink:href");
      if (!href || href.startsWith("data:")) return;
      try {
        const res = await fetch(href);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("read"));
          reader.readAsDataURL(blob);
        });
        node.setAttribute("href", dataUrl);
      } catch {
        node.remove();
      }
    }),
  );

  return new XMLSerializer().serializeToString(clone);
}

/** Из разметки — растровая картинка того же размера. */
function rasterize(markup: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("svg"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

function download(href: string, name: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
