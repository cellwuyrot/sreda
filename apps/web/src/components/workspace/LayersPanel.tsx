"use client";

import { useState } from "react";
import {
  MAX_LAYERS,
  addLayer,
  moveLayer,
  patchLayer,
  removeLayer,
  shapeLayerId,
  type ArtScene,
} from "@/lib/tzart";

/**
 * Панель слоёв TZartstation.
 *
 * Слои перечислены сверху вниз в том порядке, в каком лежат на холсте: верхняя
 * строка — то, что видно поверх всего. В самой сцене порядок обратный (первым
 * рисуется нижний слой), и разворот делается здесь, а не в модели: снизу вверх
 * удобно рисовать, сверху вниз — смотреть.
 *
 * Что даёт каждая кнопка:
 *   • глаз — скрыть слой, не удаляя его;
 *   • замок — оставить видимым, но убрать из-под курсора. Ради этого слои и
 *     запирают: подложку видно, но она не мешается;
 *   • ползунок — приглушить весь слой целиком.
 *
 * Активный слой — тот, на который ложится всё новое. Без явной отметки человек
 * рисует «куда-то», а потом не находит нарисованное в скрытом слое.
 */
export default function LayersPanel({
  scene,
  activeLayerId,
  onActiveLayer,
  onChange,
  makeId,
}: {
  scene: ArtScene;
  activeLayerId: string;
  onActiveLayer: (id: string) => void;
  onChange: (scene: ArtScene, commit: boolean) => void;
  makeId: () => string;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);

  const counts = new Map<string, number>();
  for (const shape of scene.shapes) {
    const id = shapeLayerId(scene, shape);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const rows = [...scene.layers].reverse();

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-white/10">
        <span className="text-[12px] font-semibold text-neutral-900 dark:text-white">Слои</span>
        <button
          type="button"
          title="Новый слой"
          disabled={scene.layers.length >= MAX_LAYERS}
          onClick={() => {
            const id = makeId();
            onChange(addLayer(scene, id), true);
            onActiveLayer(id);
          }}
          className="rounded-md px-1.5 py-0.5 text-[15px] leading-none text-neutral-400 transition-colors hover:text-neutral-900 disabled:opacity-30 dark:hover:text-white"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {rows.map((layer, rowIndex) => {
          const index = scene.layers.length - 1 - rowIndex;
          const active = layer.id === activeLayerId;
          return (
            <div
              key={layer.id}
              onClick={() => onActiveLayer(layer.id)}
              className={`mb-1 rounded-lg border px-2 py-1.5 transition-colors ${
                active
                  ? "border-violet-500/60 bg-violet-500/10 dark:border-cyan-400/50 dark:bg-cyan-400/10"
                  : "border-transparent hover:bg-neutral-100 dark:hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={layer.visible ? "Скрыть слой" : "Показать слой"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(patchLayer(scene, layer.id, { visible: !layer.visible }), true);
                  }}
                  className={`text-[12px] leading-none ${layer.visible ? "opacity-90" : "opacity-30"}`}
                >
                  👁
                </button>
                <button
                  type="button"
                  title={layer.locked ? "Разрешить правку" : "Запереть слой"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(patchLayer(scene, layer.id, { locked: !layer.locked }), true);
                  }}
                  className={`text-[12px] leading-none ${layer.locked ? "opacity-90" : "opacity-30"}`}
                >
                  🔒
                </button>

                {renaming === layer.id ? (
                  <input
                    autoFocus
                    defaultValue={layer.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      onChange(patchLayer(scene, layer.id, { name: e.target.value || layer.name }), true);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 text-[11px] dark:border-white/20 dark:bg-neutral-800"
                  />
                ) : (
                  <button
                    type="button"
                    title="Переименовать"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenaming(layer.id);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-[11px] text-neutral-700 dark:text-neutral-200"
                  >
                    {layer.name}
                    <span className="ml-1 text-neutral-400">{counts.get(layer.id) ?? 0}</span>
                  </button>
                )}

                <button
                  type="button"
                  title="Выше"
                  disabled={index === scene.layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(moveLayer(scene, layer.id, 1), true);
                  }}
                  className="px-0.5 text-[10px] text-neutral-400 hover:text-neutral-900 disabled:opacity-20 dark:hover:text-white"
                >
                  ▲
                </button>
                <button
                  type="button"
                  title="Ниже"
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(moveLayer(scene, layer.id, -1), true);
                  }}
                  className="px-0.5 text-[10px] text-neutral-400 hover:text-neutral-900 disabled:opacity-20 dark:hover:text-white"
                >
                  ▼
                </button>
                <button
                  type="button"
                  title="Удалить слой вместе с содержимым"
                  disabled={scene.layers.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = removeLayer(scene, layer.id);
                    if (next === scene) return;
                    onChange(next, true);
                    if (active) onActiveLayer(next.layers[next.layers.length - 1]!.id);
                  }}
                  className="px-0.5 text-[11px] text-neutral-400 hover:text-red-500 disabled:opacity-20"
                >
                  ✕
                </button>
              </div>

              {active && (
                <label
                  className="mt-1 flex items-center gap-1.5 text-[10px] text-neutral-500 dark:text-neutral-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  Прозрачность
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(layer.opacity * 100)}
                    /* Живое значение идёт мимо истории: шаг запишется один, когда
                       отпустят ползунок (см. редактор). */
                    onChange={(e) => onChange(patchLayer(scene, layer.id, { opacity: Number(e.target.value) / 100 }), false)}
                    className="h-1 flex-1 accent-violet-600 dark:accent-cyan-400"
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
