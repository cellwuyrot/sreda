"use client";
​
import { useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import ModalBackdrop from "./ModalBackdrop";
import type { Channel } from "./sidebarTypes";
import { InfoIcon, QuestionIcon, ChatIcon, FileIcon } from "@/components/ui/ConnectIcons";
import BlockIcon, { BLOCK_ICON_POOL, blockIconKeyForName, isBlockIconKey } from "./BlockIcons";
import { MembersList, type MemberListEntry } from "./GroupDialogs";
import { COLLAPSED_WIDTH, CollapsedStrip, PanelChevron, VIEW_TITLE, usePanelView } from "./panelCollapse";
import InfoTooltip from "@/components/ui/InfoTooltip";
​
/* FIX-PANELVIEW3: три состояния по кругу — участники → разделы → скрыто.
   Механика лежит в `panelCollapse.tsx` и общая с `ModulesPanel`, поэтому во всех
   группах панель ведёт себя одинаково; раньше в каждом файле была своя копия, и
   они разъезжались.
​
   Список участников — общий `MembersList`, а не свой: у него уже есть аватары с
   подсветкой, роли и живой индикатор присутствия. Прежняя кнопка «Участники»
   внизу списка каналов убрана, поэтому вход в участников теперь один. */
​
/* ── Access helpers (single source of truth for block write-permission) ── */
​
export type Access = "ALL" | "MOD" | "ADMIN";
​
export function effectiveAccess(c: Channel): Access {
  // Legacy NEWS channels behave like MOD (admin + moderators)
  if (c.type === "NEWS" && (!c.postAccess || c.postAccess === "ALL")) return "MOD";
  const a = c.postAccess;
  return a === "ADMIN" || a === "MOD" ? a : "ALL";
}
​
function defaultIcon(a: Access): ReactNode {
  if (a === "ADMIN") return <InfoIcon size={20} tone="inactive" />;
  if (a === "MOD") return <QuestionIcon size={20} tone="inactive" />;
  return <ChatIcon size={20} tone="inactive" />;
}
​
/* ── Block icon rendering (монохромные векторные иконки, см. BlockIcons.tsx) ──
 * Приоритет: явно выбранная в настройках иконка-ключ → пользовательский эмодзи
 * (старые данные) → автоопределение по названию раздела → дефолт по доступу. */
function renderBlockIcon(block: Channel, access: Access, size = 22): ReactNode {
  const custom = (block as Channel & { icon?: string | null }).icon ?? null;
  if (custom) {
    if (isBlockIconKey(custom)) return <BlockIcon name={custom} size={size} />;
    // Совместимость со старыми данными: путь вида "/icons/block-ai.png"
    const legacy = custom.match(/block-([a-z]+)\.(?:png|svg)$/i)?.[1]?.toLowerCase();
    if (isBlockIconKey(legacy)) return <BlockIcon name={legacy} size={size} />;
    // Настоящий эмодзи (не путь к файлу) — показываем как есть.
    if (custom.trim() && !custom.startsWith("/")) return <span className="text-base leading-none">{custom}</span>;
  }
  const nameKey = blockIconKeyForName(block.name);
  if (nameKey) return <BlockIcon name={nameKey} size={size} />;
  return defaultIcon(access);
}
​
const ACCESS_LABEL: Record<Access, string> = {
  ADMIN: "Только чтение",
  MOD: "Вопросы-ответы",
  ALL: "Открытый",
};
​
// Семантические цвета бейджей доступа
const ACCESS_BADGE: Record<Access, { color: string; bg: string }> = {
  ADMIN: { color: "#9ca3af", bg: "rgba(156,163,175,0.16)" },
  MOD: { color: "#22d3ee", bg: "rgba(34,211,238,0.16)" },
  ALL: { color: "#34d399", bg: "rgba(52,211,153,0.16)" },
};
​
/* ── Props ── */
​
interface SectionsPanelProps {
  channels: Channel[];
  generalChannelId: string | null;
  selectedChannel: string | null;
  unreadCounts: Record<string, number>;
  canManage: boolean;
  groupId: string;
  /** Первая страница участников — приходит из снимка сообщества уровнем выше. */
  members: MemberListEntry[];
  /** Всего участников в группе: счётчик в заголовке и признак «есть что догрузить». */
  membersTotal?: number;
  /** В главном сообществе список участников закрыт для обычных участников. */
  canSeeMembers?: boolean;
  variant?: "desktop" | "mobile";
  onSelectChannel: (channel: Channel) => void;
  onRefresh: () => void;
  onDeleteChannel?: (channelId: string) => void;
  onToggleHideChannel?: (channelId: string, hidden: boolean) => void;
}
​
export default function SectionsPanel({
  channels, generalChannelId, selectedChannel, unreadCounts, canManage, groupId,
  members, membersTotal, canSeeMembers = true,
  variant = "desktop", onSelectChannel, onRefresh, onDeleteChannel, onToggleHideChannel,
}: SectionsPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
​
  const { view, cycle, collapsed, hint } = usePanelView(groupId, canSeeMembers);
​
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [settingsBlock, setSettingsBlock] = useState<Channel | null>(null);
  // undefined = closed, null = new top-level block, string = new list item under block id
​
  // Top-level "разделы" = non-voice channels that aren't the general chat and have no parent.
  // Order by sortOrder first (мэйн-сообщество наследует порядок услуг из админки),
  // then fall back to alphabetical for groups that never set an explicit order.
  const rawBlocks = channels
    .filter((c) => c.type !== "VOICE" && c.type !== "APPEALS" && !c.parentId && c.id !== generalChannelId)
    .sort((a, b) => {
      const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (so !== 0) return so;
      return a.name.localeCompare(b.name, "ru");
    });
​
  const childrenOf = (blockId: string) =>
    channels.filter((c) => c.parentId === blockId && c.type !== "VOICE");
​
  // Auto-group channels by shared name prefix before " — "
  // e.g. "ИИ-Автоматизация", "ИИ-Автоматизация — Вопросы", "ИИ-Автоматизация — Обсуждение"
  // → one block with two children, no DB change needed
  type AutoGroup = { block: Channel; kids: Channel[] };
  const groups: AutoGroup[] = [];
  const assigned = new Set<string>();
​
  for (const block of rawBlocks) {
    if (assigned.has(block.id)) continue;
    const prefix = block.name.split(" — ")[0].trim();
    const kids = rawBlocks.filter(
      (c) => c.id !== block.id && !assigned.has(c.id) && c.name.startsWith(prefix + " — ")
    );
    kids.forEach((k) => assigned.add(k.id));
    assigned.add(block.id);
    groups.push({ block, kids });
  }
​
  const blocks = groups.map((g) => g.block);
​
  const autoKidsOf = (blockId: string): Channel[] => {
    const g = groups.find((gr) => gr.block.id === blockId);
    return [...childrenOf(blockId), ...(g?.kids ?? [])];
  };
​
  const unreadFor = (c: Channel) => {
    let n = unreadCounts[c.id] ?? 0;
    for (const ch of autoKidsOf(c.id)) n += unreadCounts[ch.id] ?? 0;
    return n;
  };
​
  const isMobile = variant === "mobile";
​
  /* Свёрнутый вид — полоса 60px, которая сама себе кнопка разворота. На
     мобильном ширина не применяется: там панель встроена в список каналов, и
     «свёрнуто» означает просто скрытое содержимое при видимом заголовке. */
  const stripOnly = collapsed && !isMobile;
​
  return (
    <div
      className={isMobile ? "" : "flex-shrink-0 flex flex-col h-full transition-[width] duration-200"}
      style={isMobile ? undefined : {
        width: stripOnly ? COLLAPSED_WIDTH : 330,
        borderLeft: "1px solid var(--cn-border)",
        background: "var(--cn-sidebar)",
      }}
    >
      {stripOnly && <CollapsedStrip onClick={cycle} hint={hint} />}
​
      {/* Header */}
      {!stripOnly && (
      <div className={isMobile ? "flex items-center justify-between mb-2" : "flex items-center justify-between px-4 py-3.5"}
        style={isMobile ? undefined : { borderBottom: "1px solid var(--cn-border)" }}>
        <button
          type="button"
          onClick={cycle}
          className="flex items-center gap-1.5 rounded-lg px-1 -mx-1 py-0.5 hover:bg-[var(--cn-hover)] transition-colors"
          title={hint}
          aria-label={hint}
          aria-expanded={!collapsed}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--cn-muted)" }}>
            {VIEW_TITLE[view]}
            {view === "members" && ` — ${membersTotal ?? members.length}`}
          </span>
          <PanelChevron collapsed={collapsed} />
        </button>
        {canManage && view === "sections" && (
          <button
            onClick={() => setCreateParent(null)}
            className="text-xs font-medium text-accent border border-[var(--cn-border)] rounded-lg px-2.5 py-1 hover:bg-[var(--cn-hover)] transition-colors"
          >
            ＋ блок
          </button>
        )}
      </div>
      )}
​
      {/* Участники — общий список, тот же что был в отдельной колонке; остальные
          страницы он догружает сам по groupId. */}
      {view === "members" && (
        <div className={isMobile ? "" : "flex-1 overflow-y-auto p-2"}>
          {members.length === 0
            ? <p className="py-6 text-center text-sm" style={{ color: "var(--cn-muted)" }}>Участников нет.</p>
            : <MembersList members={members} groupId={groupId} total={membersTotal} />}
        </div>
      )}
​
      {/* Плитки блоков видны только в режиме разделов. */}
      {view === "sections" && (
      /* MOBILE-TILES: в двухколоночной сетке колонка уже длинных названий
         («ИИ-Автоматизация», «Баг репорт -обслуживание сайта»). Минимальная
         ширина грид-ячейки по умолчанию равна auto, а не нулю, поэтому ячейка
         растягивалась под самое длинное слово и текст выходил за рамку карточки
         и за край экрана.
​
         Комментарий здесь ОБЯЗАН быть обычным блок-комментарием, а не фигурным
         вида JSX: это позиция выражения внутри скобок, а не дети разметки. */
      <div className={isMobile ? "grid [grid-template-columns:repeat(2,minmax(0,1fr))] gap-2.5" : "flex-1 overflow-y-auto p-2 space-y-1.5"}>
        {blocks.length === 0 && (
          <div className="col-span-2 text-center text-sm py-6" style={{ color: "var(--cn-muted)" }}>
            {canManage ? "Пока нет разделов. Создайте первый блок." : "Разделов пока нет."}
          </div>
        )}
        {blocks.map((block) => {
          const access = effectiveAccess(block);
          const kids = autoKidsOf(block.id);
          const unread = unreadFor(block);
          const active = selectedChannel === block.id || kids.some((k) => k.id === selectedChannel);
          const isOpen = expanded[block.id] ?? false;
          return (
            <div
              key={block.id}
              className="rounded-xl border transition-colors group/block min-w-0 overflow-hidden" /* MOBILE-TILES */
              style={{
                borderColor: active ? "var(--cn-accent)" : "var(--cn-border)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0))",
                boxShadow: active ? "0 0 0 1px var(--cn-accent-dim)" : undefined,
              }}
            >
              <button
                onClick={() => {
                  if (kids.length > 0 && !isMobile) {
                    setExpanded((p) => ({ ...p, [block.id]: !isOpen }));
                  }
                  onSelectChannel(block);
                }}
                className="w-full text-left p-2.5 rounded-xl"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-none border"
                    style={{ background: "var(--cn-hover)", borderColor: "var(--cn-border)", color: "var(--cn-text)" }}
                  >
                    {renderBlockIcon(block, access)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* MOBILE-TILES: длинное слово переносится в любом месте, иначе
                        оно пробивает границу карточки на узком экране. */}
                    <div className="font-semibold text-sm leading-snug break-words [overflow-wrap:anywhere] hyphens-auto" lang="ru" style={{ color: "var(--cn-text)" }}>{block.name}</div>
                  </div>
                  {unread > 0 && (
                    <span className="ml-auto flex-none bg-accent text-[11px] font-extrabold rounded-full px-2 py-0.5" style={{ color: "#04121a" }}>
                      {unread}
                    </span>
                  )}
                  {/* Gear icon — admin only */}
                  {canManage && (onDeleteChannel || onToggleHideChannel) && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setSettingsBlock(block); }}
                        className="w-6 h-6 flex items-center justify-center rounded-md opacity-60 hover:opacity-100 hover:bg-white/10 transition-all flex-none"
                        title="Настройки блока"
                      >
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                      </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {kids.length > 0 && (
                    <span className="text-[11px]" style={{ color: "var(--cn-muted)" }}>{kids.length} в списке</span>
                  )}
                </div>
              </button>
​
              {/* Child "list" items */}
              {(isMobile || isOpen) && kids.length > 0 && (
                <div className="px-3 pb-2.5 space-y-1">
                  {kids.map((kid) => {
                    const kAccess = effectiveAccess(kid);
                    const kActive = selectedChannel === kid.id;
                    const kUnread = unreadCounts[kid.id] ?? 0;
                    return (
                      <button
                        key={kid.id}
                        onClick={() => onSelectChannel(kid)}
                        className="w-full min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors" /* MOBILE-TILES */
                        style={{
                          color: kActive ? "var(--cn-text)" : "var(--cn-muted)",
                          background: kActive ? "var(--cn-accent-dim)" : undefined,
                        }}
                      >
                        <span className="flex-none flex items-center">{kid.icon ? kid.icon : (kAccess === "ALL" ? <ChatIcon size={16} tone="inactive" /> : <FileIcon size={16} tone="inactive" />)}</span>
                        <span className="truncate flex-1 text-left">{kid.name}</span>
                        {kUnread > 0 && (
                          <span className="bg-accent text-[10px] font-extrabold rounded-full px-1.5" style={{ color: "#04121a" }}>{kUnread}</span>
                        )}
                      </button>
                    );
                  })}
                  {canManage && (
                    <button
                      onClick={() => setCreateParent(block.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-accent hover:bg-[var(--cn-hover)] transition-colors"
                    >
                      ＋ пункт списка
                    </button>
                  )}
                </div>
              )}
​
              {/* Admin: add list item even when block has no children yet */}
              {canManage && kids.length === 0 && (isMobile || isOpen || active) && (
                <div className="px-3 pb-2.5">
                  <button
                    onClick={() => setCreateParent(block.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-accent hover:bg-[var(--cn-hover)] transition-colors"
                  >
                    ＋ пункт списка
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
​
      {settingsBlock && (
        <BlockSettingsModal
          block={settingsBlock}
          kids={autoKidsOf(settingsBlock.id)}
          onClose={() => setSettingsBlock(null)}
          onRefresh={onRefresh}
        />
      )}
​
      {createParent !== undefined && (
        <BlockModal
          groupId={groupId}
          parentId={createParent ?? null}
          parentName={createParent ? blocks.find((b) => b.id === createParent)?.name : undefined}
          onClose={() => setCreateParent(undefined)}
          onCreated={() => { setCreateParent(undefined); onRefresh(); }}
        />
      )}
    </div>
  );
}
​
/* ── Create block / list modal (admin only) ── */
​
const FORM_TYPES: { v: string; label: string }[] = [
  { v: "TEXT", label: "Открытый чат" },
  { v: "NEWS", label: "Новости" },
  { v: "QA", label: "Вопрос-ответ" },
  { v: "WIKI", label: "База знаний" },
];
​
function BlockModal({
  groupId, parentId, parentName, onClose, onCreated,
}: {
  groupId: string;
  parentId: string | null;
  parentName?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isList = !!parentId;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [access, setAccess] = useState<Access>(isList ? "ALL" : "ADMIN");
  const [formType, setFormType] = useState<string>("TEXT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
​
  const create = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        type: isList ? formType : "NEWS",
        groupId,
        postAccess: access,
        parentId: parentId || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Ошибка создания");
      setLoading(false);
      return;
    }
    // Optionally set custom icon via PUT
    if (icon.trim()) {
      const created = await res.json().catch(() => null);
      if (created?.id) {
        await fetch(`/api/channels/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icon: icon.trim() }),
        }).catch(() => {});
      }
    }
    setLoading(false);
    onCreated();
  };
​
  const ACCESS_OPTIONS: { value: Access; label: string; hint: string }[] = [
    { value: "ADMIN", label: "Только чтение", hint: "пишет администратор" },
    { value: "MOD", label: "Админ + модераторы", hint: "вопросы-ответы" },
    { value: "ALL", label: "Для всех", hint: "пишут все участники" },
  ];
​
  return (
    <ModalBackdrop onClose={onClose}>
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">
        {isList ? "Новый пункт списка" : "Новый блок-раздел"}
      </h3>
      {isList && parentName && (
        <p className="text-xs text-neutral-500 dark:text-gray-400 mb-3">в блоке «{parentName}»</p>
      )}
      <div className="space-y-3 mt-3">
        <div className="flex gap-2">
          <input
            type="text" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={2}
            placeholder="🙂" aria-label="Иконка (эмодзи)"
            className="w-14 text-center bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-2 py-2.5 text-lg"
          />
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !loading) create(); }}
            placeholder={isList ? "Название пункта…" : "Название раздела…"}
            className="flex-1 bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400"
          />
        </div>
        <div>
          <p className="text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1.5">Кто может писать</p>
          <div className="space-y-1.5">
            {ACCESS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAccess(opt.value)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all border ${
                  access === opt.value
                    ? "bg-violet-50 dark:bg-cyan-400/15 text-accent border-violet-200 dark:border-cyan-400/30"
                    : "bg-neutral-50 dark:bg-neutral-700 text-neutral-600 dark:text-gray-300 border-neutral-200 dark:border-white/5"
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                <span className="text-[11px] opacity-70">· {opt.hint}</span>
              </button>
            ))}
          </div>
        </div>
        {isList && (
        <div>
          <p className="text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1.5">Форма дочернего пункта</p>
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
            className="w-full bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white"
          >
            {FORM_TYPES.map((ft) => (
              <option key={ft.v} value={ft.v}>{ft.label}</option>
            ))}
          </select>
        </div>
        )}
        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button onClick={create} disabled={loading || !name.trim()} size="md" className="flex-1">
            {loading ? "Создание…" : "Создать"}
          </Button>
          <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-gray-400 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-all text-sm">
            Отмена
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
​
/* ── Block settings modal (admin): rename, pick icon from pool, toggle & retype sub-items ── */
function BlockSettingsModal({
  block, kids, onClose, onRefresh,
}: {
  block: Channel;
  kids: Channel[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState(block.name);
  const [icon, setIcon] = useState<string | null>(
    (block as Channel & { icon?: string | null }).icon ?? null
  );
  const [items, setItems] = useState(() =>
    kids.map((k) => ({
      id: k.id,
      name: k.name,
      access: effectiveAccess(k),
      hidden: !!(k as Channel & { hidden?: boolean }).hidden,
      type: (k as Channel).type || "TEXT",
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
​
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/channels/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  };
​
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const ok = await patch(block.id, { name: name.trim(), icon });
      if (!ok) { setError("Не удалось сохранить блок"); setSaving(false); return; }
      for (const it of items) {
        const orig = kids.find((k) => k.id === it.id);
        if (!orig) continue;
        const body: Record<string, unknown> = {};
        if (effectiveAccess(orig) !== it.access) body.postAccess = it.access;
        if (!!(orig as Channel & { hidden?: boolean }).hidden !== it.hidden) body.hidden = it.hidden;
        if (((orig as Channel).type || "TEXT") !== (it as { type?: string }).type) body.type = (it as { type?: string }).type;
        if (Object.keys(body).length) await patch(it.id, body);
      }
      for (const id of deletedIds) { await fetch(`/api/channels/${id}`, { method: "DELETE" }); }
      onRefresh();
      onClose();
    } catch {
      setError("Ошибка сети");
      setSaving(false);
    }
  };
​
  return (
    <ModalBackdrop onClose={onClose}>
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">Настройки блока</h3>
​
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Название</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm mb-4"
      />
​
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Иконка блока</label>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setIcon(null)}
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-[10px] border ${icon === null ? "border-accent ring-2 ring-accent/50" : "border-neutral-200 dark:border-white/10"}`}
          style={{ background: "var(--cn-main)", color: "var(--cn-text)" }}
        >
          Авто
        </button>
        {BLOCK_ICON_POOL.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            title={label}
            onClick={() => setIcon(key)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center border ${icon === key ? "border-accent ring-2 ring-accent/50" : "border-neutral-200 dark:border-white/10"}`}
            style={{ background: "var(--cn-main)", color: "var(--cn-text)" }}
          >
            <BlockIcon name={key} size={22} />
          </button>
        ))}
      </div>
​
      {items.length > 0 && (
        <>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            Пункты блока
            <InfoTooltip text="Выключенный пункт просто пропадает у участников — сам он никуда не девается, и включить его обратно можно в любой момент." className="ml-1" />
          </label>
          <div className="flex flex-col gap-2 mb-2">
            {items.map((it) => (
              <div
                key={it.id}
                className="rounded-xl border p-2.5 transition-opacity"
                style={{ borderColor: "var(--cn-border)", background: "var(--cn-main)", opacity: it.hidden ? 0.5 : 1 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{it.name}</span>
                  <button
                    type="button"
                    onClick={() => setItems((arr) => arr.map((x) => x.id === it.id ? { ...x, hidden: !x.hidden } : x))}
                    className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
                    style={{ background: it.hidden ? "rgba(120,120,130,0.4)" : "#22d3ee" }}
                    aria-label="Включить или выключить пункт"
                  >
                    <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: it.hidden ? 2 : 18 }} />
                  </button>
                  <button
                    type="button"
                    title="Удалить пункт"
                    onClick={() => { setItems((arr) => arr.filter((x) => x.id !== it.id)); setDeletedIds((d) => [...d, it.id]); }}
                    className="ml-2 p-1 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>
                </div>
                <div className="mt-2">
                  <select
                    value={(it as { type?: string }).type || "TEXT"}
                    onChange={(e) => setItems((arr) => arr.map((x) => x.id === it.id ? { ...x, type: e.target.value } : x))}
                    className="text-[11px] rounded-lg px-2 py-1 border bg-transparent"
                    style={{ color: "var(--cn-text)", borderColor: "var(--cn-border)" }}
                  >
                    {FORM_TYPES.map((ft) => (
                      <option key={ft.v} value={ft.v} style={{ color: "#000" }}>{ft.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
​
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
​
      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-600 dark:text-gray-400 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-all text-sm"
        >
          Отмена
        </button>
        <button
          onClick={save}
          disabled={saving || !name.trim()}
          className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </ModalBackdrop>
  );
}
​