"use client";

import { useState, type DragEvent } from "react";

/* FIX-DRAGORDER: единая механика «нажал ЛКМ, потянул, отпустил» для любого
   вертикального списка каналов и разделов. Порядок живёт в sortOrder канала,
   поэтому собственного состояния у хука нет — только подсветка перетаскивания;
   сохранение делает вызывающая сторона (PUT /api/channels/reorder). */

export type DragItemProps = {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
};

function moved(ids: string[], from: string, to: string): string[] {
  const fromAt = ids.indexOf(from);
  const toAt = ids.indexOf(to);
  if (fromAt < 0 || toAt < 0) return ids;
  const rest = ids.filter((id) => id !== from);
  const at = rest.indexOf(to);
  rest.splice(fromAt < toAt ? at + 1 : at, 0, from);
  return rest;
}

export function useDragOrder({
  enabled,
  onReorder,
}: {
  enabled: boolean;
  onReorder: (ids: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const itemProps = (id: string, ids: string[]): DragItemProps => {
    if (!enabled || ids.length < 2) return {};
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", id);
        } catch {
          /* некоторые сборки Electron запрещают setData — перетаскивание работает и без него */
        }
      },
      onDragOver: (e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overId !== id) setOverId(id);
      },
      onDragLeave: () => setOverId((o) => (o === id ? null : o)),
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const from = dragId;
        setDragId(null);
        setOverId(null);
        if (!from || from === id) return;
        const next = moved(ids, from, id);
        if (next.join(",") !== ids.join(",")) onReorder(next);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverId(null);
      },
    };
  };

  /* Подсветка отдельно от обработчиков: у рядов и плиток свои классы,
     и подменять им style из хука нельзя — он там уже занят. */
  const itemClass = (id: string) =>
    `${dragId === id ? " opacity-40" : ""}${overId === id ? " ring-1 ring-violet-500/70 dark:ring-cyan-400/70 rounded-lg" : ""}`;

  return { dragId, overId, itemProps, itemClass };
}
