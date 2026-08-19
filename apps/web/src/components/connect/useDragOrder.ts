"use client";
​
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
​
/* FIX-DRAGORDER: единая механика «нажал ЛКМ, потянул, отпустил» для любого
   вертикального списка каналов, групп каналов и разделов. Порядок живёт в
   sortOrder канала, поэтому собственного состояния списка у хука нет — только
   подсветка перетаскивания; сохранение делает вызывающая сторона.
​
   FIX-DRAGORDER2: раньше здесь был штатный HTML5-drag (draggable + onDragStart).
   Строка канала — это кнопка во всю ширину, а Chromium не начинает
   перетаскивание, когда жест начался на элементе управления: каналы вне
   группы практически не брались вовсе. Теперь жест собирается вручную из
   pointer-событий: нажатие → сдвиг на несколько пикселей → отпускание.
   Обычный клик при этом жив: подавляется только тот, который завершил
   перетаскивание. Сенсорные жесты не трогаем — там прокрутка. */
​
const START_DISTANCE = 5;
​
export type DragItemProps = {
  "data-drag-id"?: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture?: (e: ReactMouseEvent<HTMLElement>) => void;
};
​
function moved(ids: string[], from: string, to: string): string[] {
  const fromAt = ids.indexOf(from);
  const toAt = ids.indexOf(to);
  if (fromAt < 0 || toAt < 0) return ids;
  const rest = ids.filter((id) => id !== from);
  const at = rest.indexOf(to);
  rest.splice(fromAt < toAt ? at + 1 : at, 0, from);
  return rest;
}
​
/* Куда целимся: берём элемент под курсором и поднимаемся вверх до первого
   соседа из того же списка. Подъём нужен для групп каналов: внутри них
   лежат свои перетаскиваемые строки, и курсор почти всегда над ребёнком. */
function targetIdAt(x: number, y: number, ids: string[]): string | null {
  let el: Element | null = document.elementFromPoint(x, y);
  while (el) {
    if (el instanceof HTMLElement) {
      const id = el.dataset.dragId;
      if (id && ids.includes(id)) return id;
    }
    el = el.parentElement;
  }
  return null;
}
​
export function useDragOrder({
  enabled,
  onReorder,
}: {
  enabled: boolean;
  onReorder: (ids: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const session = useRef<{
    id: string;
    ids: string[];
    x: number;
    y: number;
    started: boolean;
    over: string | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const reorderRef = useRef(onReorder);
  /* Свежая ссылка на onReorder нужна обработчикам окна, но писать в ref во время
     отрисовки нельзя (react-hooks/refs) — обновляем после отрисовки. */
  useEffect(() => {
    reorderRef.current = onReorder;
  }, [onReorder]);
​
  const reset = useCallback(() => {
    session.current = null;
    setDragId(null);
    setOverId(null);
    if (typeof document !== "undefined") document.body.style.userSelect = "";
  }, []);
​
  useEffect(() => {
    if (!enabled) return;
​
    const onMove = (e: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      if (!s.started) {
        if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) < START_DISTANCE) return;
        s.started = true;
        setDragId(s.id);
        document.body.style.userSelect = "none";
      }
      const over = targetIdAt(e.clientX, e.clientY, s.ids);
      s.over = over && over !== s.id ? over : null;
      setOverId(s.over);
    };
​
    const onUp = () => {
      const s = session.current;
      reset();
      if (!s || !s.started) return;
      /* После перетаскивания браузер всё равно пришлёт click по строке —
         иначе канал ещё и открывался бы на каждое перемещение. */
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 300);
      if (!s.over) return;
      const next = moved(s.ids, s.id, s.over);
      if (next.join(",") !== s.ids.join(",")) reorderRef.current(next);
    };
​
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      reset();
    };
  }, [enabled, reset]);
​
  const itemProps = (id: string, ids: string[]): DragItemProps => {
    if (!enabled || ids.length < 2) return {};
    return {
      "data-drag-id": id,
      onPointerDown: (e) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        session.current = { id, ids: [...ids], x: e.clientX, y: e.clientY, started: false, over: null };
      },
      onClickCapture: (e) => {
        if (!suppressClick.current) return;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  };
​
  /* Подсветка отдельно от обработчиков: у рядов и плиток свои классы,
     и подменять им style из хука нельзя — он там уже занят. */
  const itemClass = (id: string) =>
    `${dragId === id ? " opacity-40" : ""}${overId === id ? " ring-1 ring-violet-500/70 dark:ring-cyan-400/70 rounded-lg" : ""}`;
​
  return { dragId, overId, itemProps, itemClass };
}
​