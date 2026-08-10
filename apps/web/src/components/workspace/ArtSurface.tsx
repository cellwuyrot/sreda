"use client";

import { useCallback, useRef, useState } from "react";
import { ArtDefs, ArtShapeView } from "./artShapes";
import {
  HANDLES,
  addShape,
  appendPoint,
  boundsOf,
  boundsOfMany,
  canEditShape,
  effectiveOpacity,
  handlePoint,
  isDrawn,
  moveShape,
  normalizeBox,
  pickShape,
  removeShape,
  replaceShapes,
  resizeShape,
  rotateShapeTo,
  shapesInRect,
  visibleShapes,
  type ArtKind,
  type ArtScene,
  type ArtShape,
  type Box,
  type Handle,
} from "@/lib/tzart";

/**
 * Поверхность рисования TZartstation.
 *
 * Одна и та же поверхность работает и в карточке на холсте, и в полноэкранном
 * редакторе: инструменты, панели и слои снаружи, здесь — мышь и разметка. Так
 * рисование в маленькой карточке и в большом редакторе ведёт себя одинаково, а
 * не «почти одинаково», как вышло бы у двух похожих компонентов.
 *
 * Отрисовка — SVG, а не canvas, и это осознанно. У объектов в SVG есть узлы: их
 * можно выделять и двигать без пересчёта пикселей, они не мылятся при
 * увеличении, и сцена остаётся текстом в килобайты вместо картинки в мегабайты.
 *
 * Все решения — попадание курсора, растягивание за ручку, поворот, порядок
 * наложения — приняты в lib/tzart и покрыты тестами. Здесь только состояние
 * указателя.
 *
 * Одно важное соглашение: пока кнопка мыши зажата, сцена НЕ меняется. Черновик
 * живёт в состоянии компонента и рисуется поверх; наружу уходит один готовый
 * результат по отпусканию. Иначе каждое движение мыши было бы отдельным шагом
 * истории и отдельной отправкой состояния на сервер.
 */

export type ArtTool = "select" | "brush" | "eraser" | ArtKind;

export interface ArtStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  opacity: number;
}

type Drag =
  | { mode: "draw"; shape: ArtShape }
  | { mode: "brush"; shape: ArtShape }
  | { mode: "move"; startX: number; startY: number; origin: ArtShape[] }
  | { mode: "resize"; handle: Handle; origin: ArtShape }
  | { mode: "rotate"; origin: ArtShape }
  | { mode: "marquee"; startX: number; startY: number; additive: boolean }
  | { mode: "erase" };

type Draft =
  | { mode: "shape"; shapes: ArtShape[] }
  | { mode: "marquee"; rect: Box }
  | null;

/** Ручка поворота висит над верхним краем рамки, в пикселях полотна. */
const ROTATE_OFFSET = 26;

export default function ArtSurface({
  scene,
  onChange,
  tool,
  style,
  selection,
  onSelection,
  onDrawEnd,
  activeLayerId,
  readOnly = false,
  zoom = 1,
  grid = 0,
  className = "",
  makeId,
}: {
  scene: ArtScene;
  /** commit=true — законченное действие, его записывает история. */
  onChange: (scene: ArtScene, commit: boolean) => void;
  tool: ArtTool;
  style: ArtStyle;
  selection: string[];
  onSelection: (ids: string[]) => void;
  /** Вызывается после того, как объект нарисован: инструмент возвращается к выбору. */
  onDrawEnd?: (id: string) => void;
  activeLayerId: string;
  readOnly?: boolean;
  zoom?: number;
  /** Шаг сетки в пикселях полотна. 0 — сетки нет. */
  grid?: number;
  className?: string;
  makeId: () => string;
}) {
  const [draft, setDraft] = useState<Draft>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);

  /** Координаты указателя в системе полотна, а не экрана. */
  const pointAt = useCallback(
    (e: React.PointerEvent): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      /* Полотно масштабируется под ширину области, поэтому переводим через
         отношение сторон, а не вычитанием: иначе объект появлялся бы не под
         курсором на любом размере, кроме исходного. */
      const kx = scene.w / (rect.width || 1);
      const ky = scene.h / (rect.height || 1);
      return { x: (e.clientX - rect.left) * kx, y: (e.clientY - rect.top) * ky };
    },
    [scene.w, scene.h],
  );

  const snap = useCallback(
    (value: number) => (grid > 0 ? Math.round(value / grid) * grid : value),
    [grid],
  );

  const selected = scene.shapes.filter((s) => selection.includes(s.id));
  const single = selected.length === 1 ? selected[0]! : null;

  /**
   * Ручка под курсором. Берётся с запасом: попасть мышью в точку тяжело, а
   * запас делится на увеличение — на большом холсте ручки не должны разрастаться
   * в кляксы, на маленьком в них надо попадать.
   *
   * Обычная функция, а не запомненная: её вызывает только обработчик нажатия,
   * и запоминать тут нечего.
   */
  const handleAt = (x: number, y: number): Handle | "rotate" | null => {
    if (!single || !canEditShape(scene, single)) return null;
    const pad = 8 / zoom;
    const b = boundsOf(single);
    const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const rotateAnchor = { x: center.x, y: b.y - ROTATE_OFFSET / zoom };
    const rotateHandle = rotate(rotateAnchor, center, single.rotation ?? 0);
    if (Math.hypot(x - rotateHandle.x, y - rotateHandle.y) <= pad + 2 / zoom) return "rotate";
    for (const handle of HANDLES) {
      const p = handlePoint(single, handle);
      if (Math.abs(x - p.x) <= pad && Math.abs(y - p.y) <= pad) return handle;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly || e.button !== 0) return;
    const { x, y } = pointAt(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === "eraser") {
      dragRef.current = { mode: "erase" };
      eraseAt(x, y);
      return;
    }

    if (tool === "brush") {
      const shape: ArtShape = {
        id: makeId(),
        kind: "path",
        layerId: activeLayerId,
        x,
        y,
        w: 0,
        h: 0,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        opacity: style.opacity,
        points: appendPoint([], x, y),
      };
      dragRef.current = { mode: "brush", shape };
      setDraft({ mode: "shape", shapes: [shape] });
      return;
    }

    if (tool === "select") {
      const grabbed = handleAt(x, y);
      if (grabbed && single) {
        dragRef.current =
          grabbed === "rotate" ? { mode: "rotate", origin: single } : { mode: "resize", handle: grabbed, origin: single };
        return;
      }

      const hit = pickShape(scene, x, y);
      if (hit) {
        const next = e.shiftKey
          ? selection.includes(hit.id)
            ? selection.filter((id) => id !== hit.id)
            : [...selection, hit.id]
          : selection.includes(hit.id)
            ? selection
            : [hit.id];
        onSelection(next);
        const origin = scene.shapes.filter((s) => next.includes(s.id) && canEditShape(scene, s));
        if (origin.length) dragRef.current = { mode: "move", startX: x, startY: y, origin };
        return;
      }

      if (!e.shiftKey) onSelection([]);
      dragRef.current = { mode: "marquee", startX: x, startY: y, additive: e.shiftKey };
      setDraft({ mode: "marquee", rect: { x, y, w: 0, h: 0 } });
      return;
    }

    /* Остальное — фигуры, которые рисуют протягиванием. */
    const sx = snap(x);
    const sy = snap(y);
    const shape: ArtShape = {
      id: makeId(),
      kind: tool,
      layerId: activeLayerId,
      x: sx,
      y: sy,
      w: tool === "text" ? 160 : 0,
      h: tool === "text" ? style.fontSize * 1.4 : 0,
      fill: tool === "line" || tool === "arrow" || tool === "text" ? undefined : style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      opacity: style.opacity,
      text: tool === "text" ? "Текст" : undefined,
      fontSize: style.fontSize,
    };
    dragRef.current = { mode: "draw", shape };
    setDraft({ mode: "shape", shapes: [shape] });
  };

  const eraseAt = (x: number, y: number) => {
    const hit = pickShape(scene, x, y);
    if (hit) onChange(removeShape(scene, hit.id), true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || readOnly) return;
    const { x, y } = pointAt(e);

    if (drag.mode === "erase") {
      eraseAt(x, y);
      return;
    }

    if (drag.mode === "brush") {
      const points = appendPoint(drag.shape.points ?? [], x, y);
      if (points === drag.shape.points) return;
      const next = { ...drag.shape, points };
      dragRef.current = { mode: "brush", shape: next };
      setDraft({ mode: "shape", shapes: [next] });
      return;
    }

    if (drag.mode === "draw") {
      if (drag.shape.kind === "text") return; // надпись не тянется
      const next = { ...drag.shape, w: snap(x) - drag.shape.x, h: snap(y) - drag.shape.y };
      setDraft({ mode: "shape", shapes: [next] });
      return;
    }

    if (drag.mode === "move") {
      const dx = snap(x - drag.startX);
      const dy = snap(y - drag.startY);
      setDraft({ mode: "shape", shapes: drag.origin.map((s) => moveShape(s, dx, dy)) });
      return;
    }

    if (drag.mode === "resize") {
      setDraft({ mode: "shape", shapes: [resizeShape(drag.origin, drag.handle, x, y, e.shiftKey)] });
      return;
    }

    if (drag.mode === "rotate") {
      setDraft({ mode: "shape", shapes: [rotateShapeTo(drag.origin, x, y, e.shiftKey)] });
      return;
    }

    setDraft({ mode: "marquee", rect: { x: drag.startX, y: drag.startY, w: x - drag.startX, h: y - drag.startY } });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const current = draft;
    setDraft(null);
    if (!drag || readOnly) return;

    if (drag.mode === "erase") return;

    if (drag.mode === "marquee") {
      if (!current || current.mode !== "marquee") return;
      const found = shapesInRect(scene, current.rect).map((s) => s.id);
      onSelection(drag.additive ? Array.from(new Set([...selection, ...found])) : found);
      return;
    }

    if (!current || current.mode !== "shape") return;
    const shapes = current.shapes;

    if (drag.mode === "draw" || drag.mode === "brush") {
      const made = shapes[0]!;
      /* Случайный щелчок не должен оставлять невидимый объект нулевого
         размера: его потом не выделить и не удалить. */
      if (!isDrawn(made)) return;
      const finished = drag.mode === "brush" ? made : normalizeBox(made);
      onChange(addShape(scene, finished), true);
      onSelection([finished.id]);
      onDrawEnd?.(finished.id);
      return;
    }

    onChange(replaceShapes(scene, shapes), true);
  };

  /* Черновик рисуется поверх сцены: пока кнопка зажата, сама сцена не меняется. */
  const overrides = new Map<string, ArtShape>();
  let pending: ArtShape | null = null;
  if (draft?.mode === "shape") {
    for (const shape of draft.shapes) {
      if (scene.shapes.some((s) => s.id === shape.id)) overrides.set(shape.id, shape);
      else pending = shape;
    }
  }

  const rendered = visibleShapes(scene).map((s) => overrides.get(s.id) ?? s);
  const frameShapes = selected.map((s) => overrides.get(s.id) ?? s);
  const multiBox = frameShapes.length > 1 ? boundsOfMany(frameShapes) : null;
  const singleFrame = frameShapes.length === 1 ? frameShapes[0]! : null;
  const marquee = draft?.mode === "marquee" ? draft.rect : null;

  const cursor = readOnly
    ? "default"
    : tool === "select"
      ? "default"
      : tool === "eraser"
        ? "cell"
        : "crosshair";

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${scene.w} ${scene.h}`}
      width={scene.w * zoom}
      height={scene.h * zoom}
      className={`select-none ${className}`}
      style={{ touchAction: "none", cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <defs>
        <ArtDefs markerId="tzart-arrow" />
        {grid > 0 && (
          <pattern id="tzart-grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path
              d={`M ${grid} 0 L 0 0 0 ${grid}`}
              fill="none"
              stroke="rgba(120,120,120,0.25)"
              strokeWidth={1 / zoom}
            />
          </pattern>
        )}
      </defs>

      <rect x={0} y={0} width={scene.w} height={scene.h} fill={scene.bg ?? "#ffffff"} />
      {/* Сетка и рамки помечены как «не выгружать»: это интерфейс, а не рисунок. */}
      {grid > 0 && <rect data-export="skip" x={0} y={0} width={scene.w} height={scene.h} fill="url(#tzart-grid)" />}

      {rendered.map((shape) => (
        <ArtShapeView key={shape.id} shape={shape} opacity={effectiveOpacity(scene, shape)} markerId="tzart-arrow" />
      ))}
      {pending && <ArtShapeView shape={pending} opacity={pending.opacity ?? 1} markerId="tzart-arrow" />}

      {!readOnly && singleFrame && (
        <SelectionFrame shape={singleFrame} zoom={zoom} withHandles={!draft} />
      )}
      {!readOnly && multiBox && (
        <rect
          data-export="skip"
          x={multiBox.x}
          y={multiBox.y}
          width={multiBox.w}
          height={multiBox.h}
          fill="none"
          stroke="#a855f7"
          strokeWidth={1.5 / zoom}
          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
          pointerEvents="none"
        />
      )}

      {marquee && (
        <rect
          data-export="skip"
          x={Math.min(marquee.x, marquee.x + marquee.w)}
          y={Math.min(marquee.y, marquee.y + marquee.h)}
          width={Math.abs(marquee.w)}
          height={Math.abs(marquee.h)}
          fill="rgba(168,85,247,0.10)"
          stroke="#a855f7"
          strokeWidth={1 / zoom}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

function rotate(p: { x: number; y: number }, c: { x: number; y: number }, degrees: number) {
  if (!degrees) return p;
  const rad = (degrees * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad) };
}

/**
 * Рамка вокруг выбранного объекта с ручками.
 *
 * Ручки делятся на масштаб экрана: при увеличении холста они обязаны остаться
 * прежнего размера, иначе на большом увеличении рамка превращается в кляксы, а
 * на маленьком в неё невозможно попасть.
 */
function SelectionFrame({ shape, zoom, withHandles }: { shape: ArtShape; zoom: number; withHandles: boolean }) {
  const b = boundsOf(shape);
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const size = 7 / zoom;
  const line = 1.5 / zoom;
  const transform = shape.rotation ? `rotate(${shape.rotation} ${center.x} ${center.y})` : undefined;
  const canTransform = shape.kind !== "path" && shape.kind !== "line" && shape.kind !== "arrow";

  return (
    <g pointerEvents="none" data-export="skip">
      <g transform={transform}>
        <rect
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill="none"
          stroke="#a855f7"
          strokeWidth={line}
          strokeDasharray={`${5 / zoom} ${3 / zoom}`}
        />
        {withHandles && canTransform && (
          <>
            <line x1={center.x} y1={b.y} x2={center.x} y2={b.y - ROTATE_OFFSET / zoom} stroke="#a855f7" strokeWidth={line} />
            <circle cx={center.x} cy={b.y - ROTATE_OFFSET / zoom} r={size * 0.8} fill="#ffffff" stroke="#a855f7" strokeWidth={line} />
          </>
        )}
      </g>
      {withHandles &&
        canTransform &&
        HANDLES.map((handle) => {
          const p = handlePoint(shape, handle);
          return (
            <rect
              key={handle}
              x={p.x - size / 2}
              y={p.y - size / 2}
              width={size}
              height={size}
              fill="#ffffff"
              stroke="#a855f7"
              strokeWidth={line}
            />
          );
        })}
    </g>
  );
}
