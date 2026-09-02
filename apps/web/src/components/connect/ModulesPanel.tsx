"use client";

import { isModuleType } from "@/lib/channelModules";
import { useDragOrder } from "./useDragOrder"; // FIX-MODDRAG
import { MembersList, type MemberListEntry } from "./GroupDialogs";
import { COLLAPSED_WIDTH, CollapsedStrip, PanelChevron, VIEW_TITLE, usePanelView } from "./panelCollapse";

/* Module (special) channels rendered as clickable cards on the right,
   mirroring the main community sections panel.

   FIX-PANELVIEW3: показ панели берётся из общего модуля `panelCollapse.tsx` —
   те же три состояния (участники → разделы → скрыто) и та же полоса 60px, что в
   `SectionsPanel`. Здесь была своя копия логики, и она отставала: панель
   сжималась до 150px — отсюда «в TZ Connect одно, в других другое». Пока
   механика жила в двух файлах, расхождение было делом времени. */

interface ModChannel { id: string; name: string; type: string; hidden?: boolean }

type Meta = { label: string; tint: string; bg: string; icon: JSX.Element };

const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/* Какие типы считаются модулями — общий список lib/channelModules.ts, тот же,
   по которому список каналов их из себя исключает, а настройки группы умеют их
   добавлять. Здесь остаётся только оформление: иконка, цвет, подпись.
   Оформление APPEALS сохранено намеренно: тип канала никуда не делся (канал
   обращений главного сообщества), просто модулем он не считается и живёт в
   общем списке каналов — раньше на десктопе он показывался сразу в двух местах. */
const META: Record<string, Meta> = {
  APPEALS: { label: "Обращения", tint: "#e11d48", bg: "rgba(225,29,72,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /><path d="M8 9h8M8 13h5" /></svg>) },
  NEWS: { label: "Новости", tint: "#d97706", bg: "rgba(217,119,6,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><path d="M3 11l11-4v10L3 13zM14 7l5-2v14l-5-2M7 13v4a2 2 0 002 2" /></svg>) },
  QA: { label: "Вопросы-ответы", tint: "#7c3aed", bg: "rgba(124,58,237,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><path d="M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4" /><circle cx="12" cy="17.5" r="0.6" fill="currentColor" /><path d="M21 12a9 9 0 11-3.7-7.3" /></svg>) },
  WIKI: { label: "База знаний", tint: "#0891b2", bg: "rgba(8,145,178,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19h15" /><path d="M9 7h6M9 11h6" /></svg>) },
  CALENDAR: { label: "Календарь", tint: "#059669", bg: "rgba(5,150,105,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>) },
  DOCS: { label: "Документы", tint: "#2563eb", bg: "rgba(37,99,235,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v4h4M9 13h6M9 17h6" /></svg>) },
  TASKS: { label: "Задачи", tint: "#e11d48", bg: "rgba(225,29,72,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>) },
  CANVAS: { label: "Рабочая среда", tint: "#a855f7", bg: "rgba(168,85,247,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M3 13l4-3 3 2 4-4 4 4" /><path d="M9 21h6" /></svg>) },
  COMMUNITY: { label: "Общественность", tint: "#0ea5e9", bg: "rgba(14,165,233,0.14)", icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" {...sw}><circle cx="9" cy="8" r="2.5" /><circle cx="16" cy="9" r="2" /><path d="M4.5 18a4.5 4.5 0 019 0" /><path d="M13.5 18a3.5 3.5 0 017 0" /></svg>) },
};

export default function ModulesPanel({
  channels, selectedChannel, groupId, members, membersTotal, canSeeMembers = true, variant = "desktop", onSelect,
  canManage = false, onRefresh, ownerHasPremium = true, isGroupOwner = false,
}: {
  channels: ModChannel[];
  selectedChannel: string | null;
  groupId: string;
  /** Первая страница участников — приходит из снимка сообщества уровнем выше. */
  members: MemberListEntry[];
  /** Всего участников в группе: счётчик в заголовке и признак «есть что догрузить». */
  membersTotal?: number;
  canSeeMembers?: boolean;
  /** desktop = отдельная колонка справа; mobile = встроенный блок внутри списка каналов. */
  variant?: "desktop" | "mobile";
  onSelect: (ch: ModChannel) => void;
  /** FIX-MODDRAG: кому разрешено менять порядок разделов перетаскиванием. */
  canManage?: boolean;
  /** Переспросить состав группы после сохранённого порядка. */
  onRefresh?: () => void;
  /** FIX-PREMIUM-EXPIRED: false = у владельца истекла подписка, только просмотр. */
  ownerHasPremium?: boolean;
  /** Баннер об истечении видит только создатель группы. */
  isGroupOwner?: boolean;
}) {
  const isMobile = variant === "mobile";
  const mods = channels.filter((c) => isModuleType(c.type) && !c.hidden);

  /* FIX-MODDRAG: в обычных группах разделы шли тем порядком, в каком их когда-то
     создали, и переставить их было негде: перетаскивание было только у плиток
     главной группы (SectionsPanel) и у каналов левой колонки. Порядок живёт в
     sortOrder канала и сохраняется тем же PUT /api/channels/reorder. */
  const commitOrder = async (ids: string[]) => {
    await fetch("/api/channels/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelIds: ids, groupId }),
    }).catch(() => {});
    onRefresh?.();
  };
  // FIX-PREMIUM-EXPIRED
  const premiumExpired = !ownerHasPremium;
  const effectiveCanManage = canManage && !premiumExpired;
  const expiredBanner = premiumExpired && isGroupOwner ? (
    <div className="mx-2 mb-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <span>Подписка владельца истекла — только просмотр</span>
    </div>
  ) : null;
  const drag = useDragOrder({ enabled: effectiveCanManage, onReorder: commitOrder });
  // Показ панели — общая механика с SectionsPanel, один источник истины.
  /* FIX-PREMIUM: без Premium разделы полностью скрыты — только участники+сворачивание. */
  const { view, cycle, collapsed, hint } = usePanelView(groupId, canSeeMembers, ownerHasPremium);
  const stripOnly = collapsed && !isMobile;

  /* Пустой список модулей больше не прячет блок целиком: заголовок — ещё и вход
     в участников, а прежняя кнопка «Участники» внизу каналов убрана. Спрятав
     заголовок, мы отняли бы единственный вход. */
  if (isMobile && mods.length === 0 && !canSeeMembers) return null;

  const Header = (
    <div
      className={isMobile ? "flex items-center justify-between mb-2" : "p-3"}
      style={isMobile ? undefined : { borderBottom: "1px solid var(--cn-border)", flexShrink: 0 }}
    >
      <button
        type="button"
        onClick={cycle}
        className="flex items-center gap-1.5 rounded-lg px-1 -mx-1 py-0.5 hover:bg-[var(--cn-hover)] transition-colors"
        title={hint}
        aria-label={hint}
        aria-expanded={!collapsed}
      >
        <span
          className={isMobile ? "text-[11px] font-bold uppercase tracking-wider" : "font-bold text-sm"}
          style={{ color: isMobile ? "var(--cn-muted)" : "var(--cn-text)" }}
        >
          {VIEW_TITLE[view]}
          {view === "members" && ` — ${membersTotal ?? members.length}`}
        </span>
        <PanelChevron collapsed={collapsed} />
      </button>
      {!isMobile && view === "sections" && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--cn-muted)" }}>Рабочие модули группы</p>
      )}
    </div>
  );

  const memberList = view === "members" && (
    <div className={isMobile ? "" : "flex-1 overflow-y-auto p-2"}>
      {members.length === 0
        ? <p className="py-6 text-center text-xs" style={{ color: "var(--cn-muted)" }}>Участников нет.</p>
        /* Остальные страницы список догружает сам по groupId. */
        : <MembersList members={members} groupId={groupId} total={membersTotal} />}
    </div>
  );

  const cards = view === "sections" && (
    <div className={isMobile ? "grid grid-cols-2 gap-2" : "flex-1 overflow-y-auto p-2 space-y-1.5"}>
      {mods.length === 0 && (
        <div className="px-3 py-8 text-center text-xs" style={{ color: "var(--cn-muted)" }}>Разделов пока нет.<br/>Добавьте их в настройках группы → «Рабочая среда».</div>
      )}
      {expiredBanner}
      {mods.map((ch) => {
          const m = META[ch.type] ?? META.DOCS;
          const active = selectedChannel === ch.id;
          return (
            <div
              key={ch.id}
              /* FIX-MODDRAG: тянется вся карточка — обычный клик по ней работает как раньше. */
              className={drag.itemClass(ch.id)}
              {...drag.itemProps(ch.id, mods.map((item) => item.id))}
            >
            <button
              onClick={() => onSelect(ch)}
              aria-current={active ? "true" : undefined}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all focus-visible:outline-none focus-visible:ring-2"
              style={{
                background: active ? "var(--cn-hover, rgba(127,127,127,0.12))" : "transparent",
                border: active ? "1px solid var(--cn-border)" : "1px solid transparent",
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--cn-hover, rgba(127,127,127,0.07))"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0" style={{ background: m.bg, color: m.tint }}>{m.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate" style={{ color: "var(--cn-text)" }}>{ch.name}</span>
                <span className="block text-[11px] truncate" style={{ color: "var(--cn-muted)" }}>{m.label}</span>
              </span>
              <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cn-muted)" }} {...sw}><path d="M9 6l6 6-6 6" /></svg>
            </button>
            </div>
          );
        })}
    </div>
  );

  // Мобильный вариант — встроенный блок (обёртку с отступом/границей добавляет
  // вызывающий ChannelSidebar). Десктопный — отдельная колонка справа.
  if (isMobile) {
    return (
      <div>
        {Header}
        {memberList}
        {cards}
      </div>
    );
  }

  return (
    <aside
      className="max-md:hidden flex flex-col h-full flex-shrink-0 transition-[width] duration-200"
      style={{
        width: stripOnly ? COLLAPSED_WIDTH : 288,
        borderLeft: "1px solid var(--cn-border)",
        background: "var(--cn-sidebar-bg, transparent)",
      }}
    >
      {stripOnly ? <CollapsedStrip onClick={cycle} hint={hint} /> : (
        <>
          {Header}
          {memberList}
          {cards}
        </>
      )}
    </aside>
  );
}