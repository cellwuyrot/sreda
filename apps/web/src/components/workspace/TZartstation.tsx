"use client";

import { useMemo } from "react";
import { ArtDefs, ArtShapeView } from "./artShapes";
import { effectiveOpacity, parseScene, visibleShapes } from "@/lib/tzart";

/**
 * Карточка TZartstation на холсте рабочей среды: показ сцены и вход в редактор.
 *
 * Почему карточка только показывает. Полный набор — слои, ручки трансформации,
 * палитры — не помещается в узел шириной в триста точек: получился бы редактор,
 * в котором панели занимают больше места, чем сам рисунок. Поэтому на доске
 * лежит рисунок в натуральных пропорциях, а правится он в полноэкранном
 * редакторе по щелчку. Ровно так же на этой доске устроены таблица и документ.
 *
 * Предпросмотр рисуется тем же кодом, что и полотно редактора (см. artShapes),
 * поэтому совпадает с содержимым до точки и не требует ни отдельной картинки, ни
 * сохранённого снимка.
 */
export default function TZartstation({
  scene: rawScene,
  onOpen,
}: {
  scene: unknown;
  onOpen?: () => void;
}) {
  const scene = useMemo(() => parseScene(rawScene), [rawScene]);
  const shapes = visibleShapes(scene);

  if (shapes.length === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-6 text-center text-[12px] text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-200"
      >
        <span className="text-base" aria-hidden>🎨</span>
        Нажмите, чтобы открыть TZartstation
        <span className="text-[11px] text-neutral-300 dark:text-neutral-600">слои, кисть, фигуры, картинки</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Открыть в TZartstation"
      className="group block w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
    >
      <svg
        viewBox={`0 0 ${scene.w} ${scene.h}`}
        className="block w-full transition-transform duration-200 group-hover:scale-[1.02]"
        style={{ aspectRatio: `${scene.w} / ${scene.h}`, background: scene.bg ?? "#ffffff" }}
      >
        <defs>
          <ArtDefs markerId="tzart-preview-arrow" />
        </defs>
        {shapes.map((shape) => (
          <ArtShapeView
            key={shape.id}
            shape={shape}
            opacity={effectiveOpacity(scene, shape)}
            markerId="tzart-preview-arrow"
          />
        ))}
      </svg>
    </button>
  );
}
