"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Spinner from "@/components/ui/Spinner";
import { PlusIcon, TrashIcon } from "@/components/ui/ConnectIconsExtra";
import { MAX_STAGES, MAX_STAGE_TITLE, type OrderStage } from "@/lib/orderStages";

/**
 * STAGES: редактор этапов работ по услуге (шестерёнка в списке услуг).
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Услуги владелец заводит сам, и каталог наборов этапов не может знать заранее
 * про каждую. Пока набора нет, услуга берёт общий («Заявка принята · Задача
 * уточнена · Работы ведутся · Проверка · Готово»), а здесь его можно заменить
 * на настоящий. То, что сохранено тут, заказчик и видит у себя в кабинете.
 *
 * ── Почему у этапа есть невидимый идентификатор ─────────────────────────────
 *
 * Каждая строка списка тащит с собой `id`. Он не показывается и не правится, но
 * уходит на сервер вместе с названием: по нему в проектах отмечены выполненные
 * этапы. Переименование и перестановка сохраняют идентификатор, поэтому у
 * идущих работ ничего не сбивается. Новая строка идентификатора не имеет — его
 * присваивает сервер, чтобы два администратора, добавившие этап одновременно,
 * не выдали один и тот же номер.
 *
 * Удаление этапа снимает его отметку у всех проектов — и это единственная
 * необратимая операция здесь. Поэтому она спрашивает подтверждение.
 *
 * Оформление собрано из уже существующих классов страницы услуг
 * (bg-neutral-900 / border-white/10 / bg-cyan-500): новых цветов не вводится.
 */

/** Строка редактора: у нового этапа идентификатора ещё нет. */
interface DraftStage {
  id?: string;
  title: string;
  /** Ключ для React: идентификатор может отсутствовать, а строки переставляются. */
  key: string;
}

let draftCounter = 0;
function toDraft(stage: OrderStage): DraftStage {
  draftCounter += 1;
  return { id: stage.id, title: stage.title, key: `${stage.id}#${draftCounter}` };
}

export default function ServiceStagesModal({
  serviceId,
  serviceTitle,
  onClose,
}: {
  serviceId: string;
  serviceTitle: string;
  onClose: () => void;
}) {
  const [stages, setStages] = useState<DraftStage[]>([]);
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/services/${serviceId}/stages`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось загрузить этапы");
        return;
      }
      setStages(((data?.stages ?? []) as OrderStage[]).map(toDraft));
      setCustom(!!data?.custom);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rename = (index: number, title: string) => {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, title } : s)));
  };

  /* Перестановка меняет ТОЛЬКО порядок: идентификаторы едут вместе со строками,
     иначе отметки проектов переехали бы на соседние этапы. */
  const move = (index: number, delta: number) => {
    setStages((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const remove = (index: number) => {
    const stage = stages[index];
    if (!stage) return;
    /* Отметка этого этапа исчезнет у всех проектов услуги — откатить нечем. */
    if (stage.id && !window.confirm(`Удалить этап «${stage.title}»?\nУ проектов по этой услуге отметка о нём пропадёт.`)) return;
    setStages((prev) => prev.filter((_, i) => i !== index));
  };

  const add = () => {
    if (stages.length >= MAX_STAGES) {
      setError(`Не более ${MAX_STAGES} этапов`);
      return;
    }
    draftCounter += 1;
    setError("");
    setStages((prev) => [...prev, { title: "", key: `new#${draftCounter}` }]);
  };

  const save = async () => {
    const payload = stages
      .map((s) => ({ id: s.id, title: s.title.trim() }))
      .filter((s) => s.title.length > 0);
    if (payload.length === 0) {
      setError("Нужен хотя бы один этап");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/services/${serviceId}/stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось сохранить");
        return;
      }
      onClose();
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Вернуть набор этапов по умолчанию?\nВаши правки будут потеряны.")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/services/${serviceId}/stages`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось сбросить");
        return;
      }
      setStages(((data?.stages ?? []) as OrderStage[]).map(toDraft));
      setCustom(false);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-bold text-white">Этапы работы</h3>
          <p className="text-sm text-gray-500 mt-0.5">{serviceTitle}</p>
        </div>

        {loading ? (
          <div className="grid min-h-40 place-items-center"><Spinner /></div>
        ) : (
          <ol className="space-y-2">
            {stages.map((stage, i) => (
              <li key={stage.key} className="flex items-center gap-2">
                <span className="w-6 flex-shrink-0 text-xs text-gray-600 text-right">{i + 1}</span>
                <input
                  type="text"
                  value={stage.title}
                  maxLength={MAX_STAGE_TITLE}
                  onChange={(e) => rename(i, e.target.value)}
                  className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Выше"
                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-sm transition-colors disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === stages.length - 1}
                  aria-label="Ниже"
                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-sm transition-colors disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Удалить этап"
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <TrashIcon size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {!loading && (
          <button
            type="button"
            onClick={add}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors"
          >
            <PlusIcon size={16} />
            Добавить этап
          </button>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => void reset()}
            disabled={saving || loading || !custom}
            className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-lg text-sm transition-colors disabled:opacity-40"
          >
            По умолчанию
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-lg text-sm transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="flex-1 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
