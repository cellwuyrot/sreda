"use client";

import { useEffect, useState } from "react";

/**
 * FIX-PANELVIEW3: одна механика правой колонки на все группы.
 *
 * Колонку рисуют два разных компонента: `SectionsPanel` (блоковый режим —
 * главное сообщество и группы с включёнными разделами) и `ModulesPanel` (обычные
 * группы, «рабочие модули»). Логика показа была реализована в них дважды, копией,
 * и копии разъезжались — отсюда «в TZ Connect одно, в других другое». Здесь она
 * лежит целиком: состояние, кнопка цикла и свёрнутая полоса.
 *
 * Три состояния по кругу: участники → разделы → скрыто. Свёрнутое состояние —
 * полоса 60px, а не нулевая ширина: полоса сама себе кнопка разворота, и панель
 * не может исчезнуть безвозвратно.
 */

export type PanelView = "members" | "sections" | "collapsed";

/** Ширина свёрнутой полосы. Одно число на оба компонента. */
export const COLLAPSED_WIDTH = 60;

const NEXT: Record<PanelView, PanelView> = {
  members: "sections",
  sections: "collapsed",
  collapsed: "members",
};

/* Когда список участников закрыт (главное сообщество для обычных участников),
   режим участников выпадает из цикла — иначе кнопка вела бы в пустой экран. */
const NEXT_WITHOUT_MEMBERS: Record<PanelView, PanelView> = {
  members: "sections",
  sections: "collapsed",
  collapsed: "sections",
};

/** Нет Premium — Sections выпадает из цикла; только Participants ↔ Collapsed. */
const NEXT_MEMBERS_ONLY: Record<PanelView, PanelView> = {
  members: "collapsed",
  sections: "collapsed",   // недостижимое состояние — сразу в collapsed
  collapsed: "members",
};

const HINT: Record<PanelView, string> = {
  members: "Показать разделы",
  sections: "Скрыть панель",
  collapsed: "Показать участников",
};

const HINT_WITHOUT_MEMBERS: Record<PanelView, string> = {
  members: "Показать разделы",
  sections: "Скрыть панель",
  collapsed: "Показать разделы",
};

const HINT_MEMBERS_ONLY: Record<PanelView, string> = {
  members: "Свернуть панель",
  sections: "Свернуть панель",
  collapsed: "Показать участников",
};

export const VIEW_TITLE: Record<PanelView, string> = {
  members: "Участники",
  sections: "Разделы",
  collapsed: "Разделы",
};

const viewKey = (groupId: string) => `tz-sections-view:${groupId}`;
/** Ключ ещё более старой, двухсостоянийной версии — читаем для миграции. */
const legacyKey = (groupId: string) => `tz-sections-collapsed:${groupId}`;

function isView(value: unknown): value is PanelView {
  return value === "members" || value === "sections" || value === "collapsed";
}

export function usePanelView(groupId: string, canSeeMembers: boolean, hasSections = true) {
  const [view, setView] = useState<PanelView>("sections");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(viewKey(groupId));
      if (isView(saved)) {
        setView(saved === "members" && !canSeeMembers ? "sections" : saved);
        return;
      }
      setView(localStorage.getItem(legacyKey(groupId)) === "1" ? "collapsed" : "sections");
    } catch {
      /* приватный режим — просто без сохранения */
    }
  }, [groupId, canSeeMembers]);

  const cycle = () => {
    setView((prev) => {
      /* FIX-PREMIUM: без Premium секции недоступны — цикл только Participants ↔ Collapsed. */
      const nextMap = !hasSections
        ? NEXT_MEMBERS_ONLY
        : canSeeMembers
          ? NEXT
          : NEXT_WITHOUT_MEMBERS;
      const next = nextMap[prev];
      try {
        localStorage.setItem(viewKey(groupId), next);
      } catch {
        /* приватный режим */
      }
      return next;
    });
  };

  /* Без Premium: если в saved-state был выбран «Разделы» — сбрасываем на «Участники». */
  const effectiveView = !hasSections && view === "sections" ? "members" : view;

  const hintMap = !hasSections
    ? HINT_MEMBERS_ONLY
    : canSeeMembers
      ? HINT
      : HINT_WITHOUT_MEMBERS;

  return {
    view: effectiveView,
    cycle,
    collapsed: effectiveView === "collapsed",
    hint: hintMap[effectiveView],
  };
}

/** Стрелка в заголовке: вниз — раскрыто, влево — свёрнуто. */
export function PanelChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
      style={{ color: "var(--cn-muted)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * Свёрнутая полоса 60px. Занимает всю высоту и целиком является кнопкой: куда бы
 * пользователь ни попал по полосе, панель развернётся.
 */
export function CollapsedStrip({ onClick, hint }: { onClick: () => void; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-label={hint}
      aria-expanded={false}
      className="flex h-full w-full flex-col items-center gap-2 pt-3.5 transition-colors hover:bg-[var(--cn-hover)]"
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "var(--cn-muted)" }}
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {/* Вертикальная подпись: в 60px горизонтальная не поместится, а полоса без
          подписи читается как обрезанный элемент вёрстки. */}
      <span
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "var(--cn-muted)", writingMode: "vertical-rl" }}
      >
        Разделы
      </span>
    </button>
  );
}
