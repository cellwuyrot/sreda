"use client";

// TZ.Connect — список сообществ с drag&drop-сортировкой и папками (как в Discord).
// ПОЛНАЯ ЗАМЕНА прежнего GroupListPanel.tsx. Пропсы не изменились,
// поэтому connect/page.tsx править не нужно.
//
// Возможности:
// - зажать мышью и перетащить сообщество вверх/вниз — изменение порядка;
// - бросить одно сообщество на другое — создаётся папка;
// - клик по папке — свернуть/развернуть; двойной клик по имени — переименовать;
// - перетаскивание внутрь/наружу папки; папка из одного элемента растворяется;
// - раскладка хранится на сервере (/api/groups/layout) — общая для веба и десктопа.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client"; // FIX-VOICEBADGE
import { CastleIcon } from "@/components/ui/ConnectIcons";
import { FolderIcon, LinkIcon, PlusIcon } from "@/components/ui/ConnectIconsExtra";

interface Group {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  isMain?: boolean;
  _count: { members: number; channels: number };
}

interface GroupListPanelProps {
  groups: Group[];
  selectedGroup: string | null;
  onSelectGroup: (id: string) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  /** FIX-NTF2: непрочитанные по сообществам: число, упоминания и список чатов. */
  groupUnread?: Record<string, { count: number; mention: boolean; channels: string[] }>;
}

type LayoutGroup = { type: "group"; id: string };
type LayoutFolder = { type: "folder"; id: string; name: string; collapsed: boolean; groupIds: string[] };
type LayoutItem = LayoutGroup | LayoutFolder;

type DropTarget =
  | { kind: "root-insert"; beforeKey: string | null }
  | { kind: "combine"; targetGroupId: string }
  | { kind: "folder-insert"; folderId: string; beforeGroupId: string | null };

type DragInfo = {
  groupId: string;
  active: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

function newFolderId(): string {
  return "fld-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── Стили (инлайн, чтобы не зависеть от глобальных классов) ──

const rowInnerStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", minWidth: 0, textAlign: "left" };
const rowTextStyle: React.CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0, flex: 1 };
const nameTextStyle: React.CSSProperties = { fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const metaTextStyle: React.CSSProperties = { fontSize: 11, opacity: 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const chevBaseStyle: React.CSSProperties = { display: "inline-block", transition: "transform 0.15s ease", fontSize: 11, opacity: 0.7, width: 12, flexShrink: 0 };
const chevOpenStyle: React.CSSProperties = { ...chevBaseStyle, transform: "rotate(90deg)" };
const folderChildrenStyle: React.CSSProperties = { borderLeft: "2px solid rgba(128,128,128,0.18)", marginLeft: 14 };
const miniGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, width: 40, height: 40, padding: 2, borderRadius: 10, background: "var(--cn-accent-dim, rgba(128,128,128,0.12))", flexShrink: 0 };
const folderIconBoxStyle: React.CSSProperties = { width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cn-accent-dim, rgba(128,128,128,0.12))", fontSize: 18, flexShrink: 0 };
const renameInputStyle: React.CSSProperties = { fontSize: 13, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--cn-accent, #7aa2ff)", background: "transparent", color: "inherit", flex: 1, minWidth: 0 };

// FIX-NTF2: Бейдж непрочитанных напротив сообщества/папки.
const unreadBadgeStyle: React.CSSProperties = { minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

function GroupAvatar(props: { icon: string | null; name: string; isMain?: boolean; small?: boolean }) {
  const { icon, name, isMain, small } = props;
  const [imgError, setImgError] = useState(false);
  const px = small ? 16 : isMain ? 48 : 40;
  const boxStyle: React.CSSProperties = {
    width: px,
    height: px,
    minWidth: px,
    borderRadius: small ? 5 : 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    background: "var(--cn-accent-dim, rgba(128,128,128,0.15))",
    color: "var(--cn-accent-text, inherit)",
    fontWeight: 600,
    fontSize: small ? 8 : isMain ? 16 : 13,
    flexShrink: 0,
  };
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const fallback = <div style={boxStyle}>{initials || "?"}</div>;
  if (!icon || imgError) return fallback;
  const isSingleEmoji = [...icon].length <= 2 && !icon.startsWith("/") && !icon.startsWith("http");
  if (isSingleEmoji) return <div style={boxStyle}>{icon}</div>;
  if (icon.startsWith("/") || icon.startsWith("http")) {
    const imgStyle: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
    return (
      <div style={boxStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt={name} width={px} height={px} style={imgStyle} onError={() => setImgError(true)} />
      </div>
    );
  }
  return fallback;
}

/* FIX-VOICEBADGE: стилизованный рупор — один и тот же знак и у строки сообщества,
   и в плашке внизу, чтобы связь между ними читалась без подписей. */
function MegaphoneIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l4 3V7L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M14 8.5a4 4 0 0 1 0 7" />
      <path d="M17 6a7 7 0 0 1 0 12" />
    </svg>
  );
}

type VoiceGroups = Record<string, { count: number; channelIds: string[] }>;

export default function GroupListPanel(props: GroupListPanelProps) {
  const { groups, selectedGroup, onSelectGroup, onCreateGroup, onJoinGroup, groupUnread = {} } = props;

  const [layout, setLayout] = useState<LayoutItem[] | null>(null);
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  /* FIX-VOICEBADGE: список сообществ не знал, что где-то говорят: присутствие жило
     только в колонке каналов открытого сообщества. Сводный запрос отдаёт только свои
     сообщества, так что скрытое от человека нигде не всплывает. */
  const [voiceGroups, setVoiceGroups] = useState<VoiceGroups>({});

  useEffect(() => {
    const sock = io({ path: "/api/socketio", transports: ["websocket", "polling"] });
    const ask = () => { if (sock.connected) sock.emit("get-all-voice-users"); };
    sock.on("all-voice-groups", (payload: VoiceGroups) => setVoiceGroups(payload ?? {}));
    sock.on("connect", ask);
    sock.io.on("reconnect", ask);
    /* 15 с: плашка справочная, секундная точность ей не нужна. */
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") ask();
    }, 15000);
    const onVisible = () => { if (document.visibilityState === "visible") ask(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      sock.disconnect();
    };
  }, []);

  const voiceTotal = Object.values(voiceGroups).reduce((sum, v) => sum + v.count, 0);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didDragRef = useRef(false);
  const dragRef = useRef<DragInfo | null>(null);
  const dropRef = useRef<DropTarget | null>(null);

  const groupById = useMemo(() => {
    const m = new Map<string, Group>();
    groups.forEach((g) => m.set(g.id, g));
    return m;
  }, [groups]);

  // Главное сообщество (TZ Connect) закреплено сверху и НЕ участвует
  // в перетаскивании, сортировке и группировке по папкам.
  const mainGroup = useMemo(() => groups.find((g) => g.isMain) ?? null, [groups]);
  const orderableGroups = useMemo(() => groups.filter((g) => !g.isMain), [groups]);

  // Приводим сохранённую раскладку к актуальному списку групп:
  // убираем несуществующие, добавляем новые в конец, растворяем пустые папки.
  // Главное сообщество исключено из раскладки (оно закреплено отдельно).
  const normalize = useCallback(
    (stored: LayoutItem[] | null): LayoutItem[] => {
      const known = new Set(orderableGroups.map((g) => g.id));
      const seen = new Set<string>();
      const result: LayoutItem[] = [];
      for (const item of stored ?? []) {
        if (!item || typeof item !== "object") continue;
        if (item.type === "group") {
          if (known.has(item.id) && !seen.has(item.id)) {
            seen.add(item.id);
            result.push({ type: "group", id: item.id });
          }
        } else if (item.type === "folder") {
          const ids = (item.groupIds || []).filter((id) => known.has(id) && !seen.has(id));
          ids.forEach((id) => seen.add(id));
          if (ids.length >= 2) {
            result.push({ type: "folder", id: item.id, name: item.name || "Папка", collapsed: !!item.collapsed, groupIds: ids });
          } else if (ids.length === 1) {
            result.push({ type: "group", id: ids[0] });
          }
        }
      }
      for (const g of orderableGroups) {
        if (!seen.has(g.id)) result.push({ type: "group", id: g.id });
      }
      return result;
    },
    [orderableGroups]
  );

  const items = useMemo(() => normalize(layout), [layout, normalize]);

  // Загрузка раскладки с сервера (один раз при монтировании)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/groups/layout", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        let stored: LayoutItem[] | null = null;
        if (body && typeof body.data === "string") {
          try {
            const parsed = JSON.parse(body.data) as { items?: LayoutItem[] };
            if (Array.isArray(parsed.items)) stored = parsed.items;
          } catch {
            /* битые данные — начинаем с пустой раскладки */
          }
        }
        setLayout(stored ?? []);
      })
      .catch(() => {
        if (!cancelled) setLayout([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Сохранение (дебаунс 400 мс)
  const commit = useCallback((next: LayoutItem[]) => {
    setLayout(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const data = JSON.stringify({ v: 1, items: next });
      fetch("/api/groups/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      }).catch(() => {});
    }, 400);
  }, []);

  const setRowRef = useCallback((key: string) => {
    return (el: HTMLDivElement | null) => {
      if (el) rowRefs.current.set(key, el);
      else rowRefs.current.delete(key);
    };
  }, []);

  // ── Вычисление цели броска по координате курсора ──
  const computeDropTarget = useCallback(
    (clientY: number, draggedId: string): DropTarget | null => {
      const rootKeys: (string | null)[] = items.map((it) => (it.type === "group" ? "g:" + it.id : "fh:" + it.id));
      rootKeys.push(null); // «после последнего»

      type RowMeta = {
        key: string;
        rootIndex: number;
        kind: "group" | "folder-header" | "folder-child";
        groupId?: string;
        folderId?: string;
        collapsed?: boolean;
        firstChildId?: string | null;
        nextChildId?: string | null;
      };

      const rows: RowMeta[] = [];
      items.forEach((item, rootIndex) => {
        if (item.type === "group") {
          rows.push({ key: "g:" + item.id, rootIndex, kind: "group", groupId: item.id });
        } else {
          rows.push({ key: "fh:" + item.id, rootIndex, kind: "folder-header", folderId: item.id, collapsed: item.collapsed, firstChildId: item.groupIds[0] ?? null });
          if (!item.collapsed) {
            item.groupIds.forEach((gid, ci) => {
              rows.push({ key: "fc:" + item.id + ":" + gid, rootIndex, kind: "folder-child", folderId: item.id, groupId: gid, nextChildId: item.groupIds[ci + 1] ?? null });
            });
          }
        }
      });

      for (const row of rows) {
        const el = rowRefs.current.get(row.key);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientY > rect.bottom) continue;
        if (clientY < rect.top) {
          return { kind: "root-insert", beforeKey: rootKeys[row.rootIndex] ?? null };
        }
        const ratio = (clientY - rect.top) / Math.max(rect.height, 1);
        if (row.kind === "group") {
          if (row.groupId === draggedId) return null;
          if (ratio > 0.3 && ratio < 0.7) return { kind: "combine", targetGroupId: row.groupId as string };
          if (ratio <= 0.3) return { kind: "root-insert", beforeKey: rootKeys[row.rootIndex] ?? null };
          return { kind: "root-insert", beforeKey: rootKeys[row.rootIndex + 1] ?? null };
        }
        if (row.kind === "folder-header") {
          if (ratio <= 0.25) return { kind: "root-insert", beforeKey: rootKeys[row.rootIndex] ?? null };
          if (ratio >= 0.75 && row.collapsed) return { kind: "root-insert", beforeKey: rootKeys[row.rootIndex + 1] ?? null };
          if (ratio >= 0.75 && !row.collapsed) return { kind: "folder-insert", folderId: row.folderId as string, beforeGroupId: row.firstChildId ?? null };
          return { kind: "folder-insert", folderId: row.folderId as string, beforeGroupId: null };
        }
        // folder-child
        if (row.groupId === draggedId) return null;
        if (ratio < 0.5) return { kind: "folder-insert", folderId: row.folderId as string, beforeGroupId: row.groupId ?? null };
        return { kind: "folder-insert", folderId: row.folderId as string, beforeGroupId: row.nextChildId ?? null };
      }
      return { kind: "root-insert", beforeKey: null };
    },
    [items]
  );

  // ── Применение броска ──
  const applyDrop = useCallback(
    (draggedId: string, target: DropTarget) => {
      // 1) вынуть перетаскиваемое сообщество из текущей позиции
      let next: LayoutItem[] = [];
      for (const item of items) {
        if (item.type === "group") {
          if (item.id !== draggedId) next.push({ type: "group", id: item.id });
        } else {
          const ids = item.groupIds.filter((id) => id !== draggedId);
          next.push({ type: "folder", id: item.id, name: item.name, collapsed: item.collapsed, groupIds: ids });
        }
      }
      // 2) вставить в целевую позицию
      if (target.kind === "combine") {
        const idx = next.findIndex((it) => it.type === "group" && it.id === target.targetGroupId);
        if (idx >= 0) {
          const folder: LayoutFolder = { type: "folder", id: newFolderId(), name: "Папка", collapsed: false, groupIds: [target.targetGroupId, draggedId] };
          next[idx] = folder;
        } else {
          next.push({ type: "group", id: draggedId });
        }
      } else if (target.kind === "folder-insert") {
        const folder = next.find((it): it is LayoutFolder => it.type === "folder" && it.id === target.folderId);
        if (folder) {
          if (target.beforeGroupId) {
            const at = folder.groupIds.indexOf(target.beforeGroupId);
            if (at >= 0) folder.groupIds.splice(at, 0, draggedId);
            else folder.groupIds.push(draggedId);
          } else {
            folder.groupIds.push(draggedId);
          }
        } else {
          next.push({ type: "group", id: draggedId });
        }
      } else {
        const entry: LayoutGroup = { type: "group", id: draggedId };
        if (target.beforeKey) {
          const at = next.findIndex((it) => (it.type === "group" ? "g:" + it.id : "fh:" + it.id) === target.beforeKey);
          if (at >= 0) next.splice(at, 0, entry);
          else next.push(entry);
        } else {
          next.push(entry);
        }
      }
      // 3) растворить папки, где осталось меньше двух сообществ
      next = next.flatMap((it): LayoutItem[] => {
        if (it.type === "folder") {
          if (it.groupIds.length === 0) return [];
          if (it.groupIds.length === 1) return [{ type: "group", id: it.groupIds[0] }];
        }
        return [it];
      });
      commit(next);
    },
    [items, commit]
  );

  // ── Drag&drop на pointer-событиях (удержание + перетаскивание) ──
  const beginDrag = useCallback(
    (e: React.PointerEvent, groupId: string) => {
      if (e.button !== 0) return;
      // Главное сообщество закреплено и не перетаскивается.
      if (mainGroup && groupId === mainGroup.id) return;
      didDragRef.current = false;
      const info: DragInfo = { groupId, active: false, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY };
      dragRef.current = info;
      setDrag(info);

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        const dx = ev.clientX - cur.startX;
        const dy = ev.clientY - cur.startY;
        const active = cur.active || Math.abs(dx) + Math.abs(dy) > 7;
        const updated: DragInfo = { ...cur, x: ev.clientX, y: ev.clientY, active };
        dragRef.current = updated;
        setDrag(updated);
        if (active) {
          didDragRef.current = true;
          const t = computeDropTarget(ev.clientY, cur.groupId);
          dropRef.current = t;
          setDropTarget(t);
          ev.preventDefault();
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const cur = dragRef.current;
        const t = dropRef.current;
        dragRef.current = null;
        dropRef.current = null;
        setDrag(null);
        setDropTarget(null);
        if (cur && cur.active && t) applyDrop(cur.groupId, t);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [computeDropTarget, applyDrop, mainGroup]
  );

  const toggleFolder = useCallback(
    (folderId: string) => {
      const next = items.map((it): LayoutItem => (it.type === "folder" && it.id === folderId ? { ...it, collapsed: !it.collapsed } : it));
      commit(next);
    },
    [items, commit]
  );

  const saveFolderName = useCallback(
    (folderId: string) => {
      setEditingFolderId(null);
      const name = editingName.trim();
      if (!name) return;
      const next = items.map((it): LayoutItem => (it.type === "folder" && it.id === folderId ? { ...it, name } : it));
      commit(next);
    },
    [editingName, items, commit]
  );

  const isDraggingId = drag && drag.active ? drag.groupId : null;

  // ── Рендер строки сообщества ──
  // pinned — главное сообщество: закреплено, без drag&drop и папок.
  const renderGroupRow = (g: Group, opts: { inFolder: boolean; folderId?: string; pinned?: boolean }) => {
    const isActive = selectedGroup === g.id;
    const key = opts.pinned ? "main:" + g.id : opts.inFolder ? "fc:" + opts.folderId + ":" + g.id : "g:" + g.id;
    const combine = !opts.pinned && !!dropTarget && dropTarget.kind === "combine" && !opts.inFolder && dropTarget.targetGroupId === g.id;
    const insertBefore =
      !opts.pinned &&
      ((!!dropTarget && dropTarget.kind === "root-insert" && !opts.inFolder && dropTarget.beforeKey === "g:" + g.id) ||
        (!!dropTarget && dropTarget.kind === "folder-insert" && opts.inFolder && dropTarget.folderId === opts.folderId && dropTarget.beforeGroupId === g.id));

    const rowStyle: React.CSSProperties = opts.pinned ? {} : { touchAction: "none" };
    if (isActive) {
      rowStyle.background = "var(--cn-accent-dim)";
      rowStyle.color = "var(--cn-accent-text)";
      rowStyle.borderLeftColor = "var(--cn-accent)";
      rowStyle.fontWeight = 600;
    }
    if (isDraggingId === g.id) rowStyle.opacity = 0.35;
    if (combine) {
      rowStyle.outline = "2px solid var(--cn-accent, #7aa2ff)";
      rowStyle.outlineOffset = -2;
      rowStyle.borderRadius = 8;
    }
    if (insertBefore) rowStyle.boxShadow = "0 -2px 0 0 var(--cn-accent, #7aa2ff)";
    if (opts.inFolder) rowStyle.paddingLeft = 18;

    return (
      <div key={key} ref={setRowRef(key)}>
        <button
          type="button"
          className="cn-channel-btn"
          style={rowStyle}
          onPointerDown={(e) => beginDrag(e, g.id)}
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            onSelectGroup(g.id);
          }}
        >
          <span style={rowInnerStyle}>
            <GroupAvatar icon={g.icon} name={g.name} isMain={g.isMain} />
            <span style={rowTextStyle}>
              <span style={nameTextStyle}>{g.name}</span>
              <span style={metaTextStyle}>
                {g._count.members} участников · {g._count.channels} каналов
              </span>
            </span>
            {/* FIX-VOICEBADGE: кто-то в голосовом канале этого сообщества */}
            {(voiceGroups[g.id]?.count ?? 0) > 0 && (
              <span
                title={"В голосовом канале: " + voiceGroups[g.id]?.count}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, padding: "1px 6px", borderRadius: 9, fontSize: 10, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,0.14)" }}
              >
                <MegaphoneIcon size={12} />
                {voiceGroups[g.id]?.count}
              </span>
            )}
            {/* FIX-NTF2: число непрочитанных; тултип — в каких чатах; красный — есть упоминание */}
            {(groupUnread[g.id]?.count ?? 0) > 0 && (
              <span
                title={"Непрочитанные: " + (groupUnread[g.id]?.channels ?? []).join(", ")}
                style={{ ...unreadBadgeStyle, background: groupUnread[g.id]?.mention ? "#ef4444" : "var(--cn-accent, #7aa2ff)" }}
              >
                {(groupUnread[g.id]?.count ?? 0) > 99 ? "99+" : groupUnread[g.id]?.count}
              </span>
            )}
          </span>
        </button>
      </div>
    );
  };

  // ── Рендер папки ──
  const renderFolder = (f: LayoutFolder) => {
    const key = "fh:" + f.id;
    const children = f.groupIds.map((id) => groupById.get(id)).filter((g): g is Group => !!g);
    const containsSelected = !!selectedGroup && f.groupIds.includes(selectedGroup);
    // FIX-NTF2: сумма непрочитанных по сообществам внутри папки
    const folderUnread = f.groupIds.reduce((total, id) => total + (groupUnread[id]?.count ?? 0), 0);
    const folderMention = f.groupIds.some((id) => groupUnread[id]?.mention);
    const insertBefore = !!dropTarget && dropTarget.kind === "root-insert" && dropTarget.beforeKey === key;
    const appendTarget = !!dropTarget && dropTarget.kind === "folder-insert" && dropTarget.folderId === f.id && dropTarget.beforeGroupId === null;

    const headStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: 8,
      width: "100%",
      padding: "8px 10px",
      cursor: "pointer",
      borderRadius: 8,
      background: containsSelected && f.collapsed ? "var(--cn-accent-dim)" : "transparent",
      userSelect: "none",
    };
    if (insertBefore) headStyle.boxShadow = "0 -2px 0 0 var(--cn-accent, #7aa2ff)";
    if (appendTarget) {
      headStyle.outline = "2px solid var(--cn-accent, #7aa2ff)";
      headStyle.outlineOffset = -2;
    }

    return (
      <div key={key}>
        <div ref={setRowRef(key)}>
          <div style={headStyle} onClick={() => toggleFolder(f.id)} role="button" title="Свернуть/развернуть папку">
            <span style={f.collapsed ? chevBaseStyle : chevOpenStyle}>▸</span>
            {f.collapsed ? (
              <div style={miniGridStyle}>
                {children.slice(0, 4).map((g) => (
                  <GroupAvatar key={g.id} small icon={g.icon} name={g.name} />
                ))}
              </div>
            ) : (
              <div style={folderIconBoxStyle}><FolderIcon size={18} /></div>
            )}
            {editingFolderId === f.id ? (
              <input
                autoFocus
                value={editingName}
                style={renameInputStyle}
                onChange={(e) => setEditingName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveFolderName(f.id);
                  if (e.key === "Escape") setEditingFolderId(null);
                }}
                onBlur={() => saveFolderName(f.id)}
              />
            ) : (
              <span
                style={rowTextStyle}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingFolderId(f.id);
                  setEditingName(f.name);
                }}
              >
                <span style={nameTextStyle}>{f.name}</span>
                <span style={metaTextStyle}>{f.groupIds.length} сообщества(-)</span>
              </span>
            )}
            {/* FIX-NTF2: непрочитанные в свёрнутой папке тоже видны */}
            {folderUnread > 0 && (
              <span style={{ ...unreadBadgeStyle, background: folderMention ? "#ef4444" : "var(--cn-accent, #7aa2ff)" }}>
                {folderUnread > 99 ? "99+" : folderUnread}
              </span>
            )}
          </div>
        </div>
        {!f.collapsed && (
          <div style={folderChildrenStyle}>
            {children.map((g) => renderGroupRow(g, { inFolder: true, folderId: f.id }))}
          </div>
        )}
      </div>
    );
  };

  // ── Призрак под курсором при перетаскивании ──
  const draggedGroup = drag && drag.active ? groupById.get(drag.groupId) : null;
  let ghost: React.ReactNode = null;
  if (drag && drag.active && draggedGroup) {
    const ghostStyle: React.CSSProperties = {
      position: "fixed",
      left: drag.x + 12,
      top: drag.y + 6,
      zIndex: 1000,
      pointerEvents: "none",
      padding: "5px 10px",
      borderRadius: 8,
      background: "var(--cn-accent-dim, rgba(122,162,255,0.2))",
      border: "1px solid var(--cn-accent, #7aa2ff)",
      fontSize: 12,
      backdropFilter: "blur(6px)",
    };
    ghost = <div style={ghostStyle}>{draggedGroup.name}</div>;
  }

  const listStyle: React.CSSProperties = drag && drag.active ? { userSelect: "none", flex: 1, overflowY: "auto", padding: "4px 6px" } : { flex: 1, overflowY: "auto", padding: "4px 6px" };
  const panelRootStyle: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 };
  const headerStyle: React.CSSProperties = { padding: "12px 14px 8px", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 };
  const emptyStyle: React.CSSProperties = { padding: "24px 14px", textAlign: "center", opacity: 0.6, fontSize: 13 };
  const footerStyle: React.CSSProperties = { padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid rgba(128,128,128,0.15)" };
  const footerBtnStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px dashed rgba(128,128,128,0.35)", background: "transparent", cursor: "pointer", fontSize: 13, color: "inherit", textAlign: "left" };

  return (
    <div style={panelRootStyle}>
      <div style={headerStyle}>
        <CastleIcon />
        <span>Сообщества</span>
      </div>

      <div style={listStyle}>
        {groups.length === 0 ? (
          <div style={emptyStyle}>Вы пока не в группах</div>
        ) : (
          <>
            {/* Главное сообщество TZ Connect — закреплено сверху, вне DnD/папок */}
            {(mainGroup ? [mainGroup] : []).map((g) => renderGroupRow(g, { inFolder: false, pinned: true }))}
            {items.map((item) => {
              if (item.type === "group") {
                const g = groupById.get(item.id);
                if (!g) return null;
                return renderGroupRow(g, { inFolder: false });
              }
              return renderFolder(item);
            })}
          </>
        )}
      </div>

      {/* FIX-VOICEBADGE: мини-окно слева снизу — где именно сейчас говорят. Клик по
          сообществу сразу переключает туда — иначе подсказка сообщала бы о
          разговоре и оставляла искать его руками. */}
      {voiceTotal > 0 && (
        <div style={{ margin: "0 8px 6px", padding: "7px 9px", borderRadius: 10, border: "1px solid rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.10)", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#22c55e" }}>
            <MegaphoneIcon size={13} />
            В голосовых каналах: {voiceTotal}
          </span>
          {Object.entries(voiceGroups).map(([gid, info]) => {
            const g = groupById.get(gid);
            if (!g || info.count === 0) return null;
            return (
              <button
                key={gid}
                type="button"
                onClick={() => onSelectGroup(gid)}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: 0, border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 11, textAlign: "left" }}
                title={"Открыть " + g.name}
              >
                <GroupAvatar icon={g.icon} name={g.name} small />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                <span style={{ opacity: 0.75 }}>{info.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div style={footerStyle}>
        <button type="button" style={footerBtnStyle} onClick={onCreateGroup}>
          <PlusIcon size={16} /> Создать сообщество
        </button>
        <button type="button" style={footerBtnStyle} onClick={onJoinGroup}>
          <LinkIcon size={16} /> Присоединиться
        </button>
      </div>

      {ghost}
    </div>
  );
}
