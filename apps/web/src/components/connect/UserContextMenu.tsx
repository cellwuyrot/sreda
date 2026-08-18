"use client";

// Меню по правому клику на имени или аватаре в чате.
//
// MODERATION: состав меню больше не собирается здесь из булевых флагов
// `canModerate` / `canAssignRoles`. Компонент получает роль смотрящего и роль
// цели и спрашивает `allowedActions` из `@/lib/groupModeration` — тот самый
// модуль, которым проверяют себя серверные маршруты. Смысл в том, чтобы меню
// и сервер отвечали на вопрос «можно ли» одним и тем же кодом: раньше клиент
// показывал «Заблокировать» модератору на администраторе, а сервер это
// отклонял, и человек узнавал о правиле только по красной надписи.
//
// Список на клиенте — подсказка, а не разрешение. Каждый маршрут проверяет
// ранги сам; здесь мы лишь не рисуем заведомо мёртвые пункты.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS
import GlowAvatar from "@/components/ui/GlowAvatar";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import {
import { bannerImgStyle } from "@/lib/bannerFraming"; // FIX-BGCROP
  allowedActions,
  assignableRoles,
  DELETE_AND_TIMEOUT_MINUTES,
  PURGE_SCOPES,
  ROLE_LABEL,
  TIMEOUT_OPTIONS,
  type ModerationAction,
} from "@/lib/groupModeration";

export interface CtxMenuUser {
  id: string;
  name: string;
  username?: string | null;
  avatar?: string | null;
  /** Сайтовая роль — нужна аватару для свечения, а не для прав. */
  role?: string;
  avatarGlowEnabled?: boolean;
  avatarGlowColors?: string | null;
  lastSeen?: string | null;
  profileBanner?: string | null;
}

/** Цветной тег сообщества. У каждого сообщества свой набор. */
export interface CtxMenuTag {
  name: string;
  color: string;
}

export interface CtxMenuRole {
  id: string;
  name: string;
  color: string;
}

/** Сообщение, на котором вызвали меню. Без него пункты «удалить…» не нужны. */
export interface CtxMenuMessage {
  id: string;
  channelId: string;
}

interface UserContextMenuProps {
  user: CtxMenuUser;
  x: number;
  y: number;
  currentUserId: string;
  groupId: string | null;
  /** GroupMember.id цели — нужен тайм-ауту, кику и смене роли. */
  targetMemberId: string | null;
  /** Роль смотрящего в этой группе. */
  viewerRole: string | null;
  /** Роль цели, либо null, если цель уже не состоит в группе. */
  targetRole: string | null;
  /** Сообщение, на котором открыли меню. */
  message: CtxMenuMessage | null;
  /** Теги цели в этом сообществе — часть мини-профиля. */
  targetTags: CtxMenuTag[];
  /** Курсор вошёл в карточку — родитель отменяет отложенное закрытие. */
  onPointerKeep?: () => void;
  /** Курсор ушёл с карточки — родитель решает, закрывать ли её. */
  onPointerAway?: () => void;
  roles: CtxMenuRole[];
  targetRoleIds: string[];
  nickname: string | null;
  ignored: boolean;
  onClose: () => void;
  onMention: () => void;
  onOpenDm: (userId: string) => void;
  onSetNickname: (nick: string | null) => void;
  onToggleIgnore: () => void;
}

type FriendState = "loading" | "none" | "friends" | "outgoing" | "incoming";

type FriendsResponse = {
  friends?: { id: string; friendshipId?: string }[];
  pending?: { id: string; sender?: { id: string } }[];
  sent?: { id: string; receiver?: { id: string } }[];
};

const REPORT_REASONS = [
  { value: "spam", label: "Спам или реклама" },
  { value: "insult", label: "Оскорбления" },
  { value: "nsfw", label: "Непристойное содержимое" },
  { value: "flood", label: "Флуд" },
  { value: "scam", label: "Мошенничество" },
  { value: "other", label: "Другое" },
] as const;

const ITEM = "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left transition-colors text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.07] disabled:opacity-50 disabled:cursor-default";
const DANGER = "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left transition-colors text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-default";

function Divider() {
  return <div className="my-1 border-t border-neutral-200 dark:border-white/10" />;
}

type SubMenu = "timeout" | "roles" | "purge" | "report" | "setrole" | null;

export default function UserContextMenu({
  user, x, y, currentUserId, groupId, targetMemberId, viewerRole, targetRole,
  message, targetTags, onPointerKeep, onPointerAway, roles, targetRoleIds, nickname, ignored, onClose, onMention, onOpenDm, onSetNickname, onToggleIgnore,
}: UserContextMenuProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, maxHeight: 0 });
  /* Меню уезжает в портал на body. Раньше оно рисовалось внутри чата, и его
     срезал ближайший предок с ограничением отрисовки: `position: fixed` в
     таком предке ведёт себя как absolute, поэтому нижние пункты уходили под
     край переписки и «Пожаловаться» было не достать. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [friendState, setFriendState] = useState<FriendState>("loading");
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [assignedRoles, setAssignedRoles] = useState<Set<string>>(new Set(targetRoleIds));
  const [openSub, setOpenSub] = useState<SubMenu>(null);
  /** Черновик никнейма: null — поле закрыто, строка — идёт ввод. */
  const [nickDraft, setNickDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isSelf = user.id === currentUserId;

  /* Единый расчёт прав — тот же, которым пользуются серверные маршруты. */
  const actions = useMemo<ModerationAction[]>(() => {
    if (!groupId) return [];
    return allowedActions({
      role: viewerRole,
      targetRole,
      isSelf,
      hasMessage: !!message,
    });
  }, [groupId, viewerRole, targetRole, isSelf, message]);

  const can = useCallback((a: ModerationAction) => actions.includes(a), [actions]);
  const grantableRoles = useMemo(() => assignableRoles(viewerRole), [viewerRole]);

  /* Меню держим в пределах экрана. Высоту считаем по `scrollHeight`, а не по
     текущей: раскрытый подсписок причин жалобы длиннее экрана, и без потолка
     с прокруткой нижние пункты просто некуда деть. */
  useLayoutEffect(() => {
    const place = () => {
      const el = menuRef.current;
      if (!el) return;
      const margin = 10;
      const available = window.innerHeight - margin * 2;
      const height = Math.min(el.scrollHeight, available);

      /* Если снизу от точки клика меню не помещается — раскрываем его ВВЕРХ,
         а не прижимаем к нижней кромке. Прижатие давало обрезанный низ, когда
         замер прошёл раньше, чем список действий отрисовался целиком: высота
         тогда получалась меньше настоящей, и последние пункты уезжали за
         экран. Раскрытие вверх от якоря такого промаха не допускает. */
      let top = y;
      if (y + height > window.innerHeight - margin) top = y - height;
      top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

      setPos({
        left: Math.max(margin, Math.min(x, window.innerWidth - el.offsetWidth - margin)),
        top,
        maxHeight: available,
      });
    };

    place();
    /* Второй замер после отрисовки: к этому моменту шрифты и вложенные списки
       уже на месте, и высота окончательная. */
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [x, y, openSub, friendState, error, notice, mounted]);

  // Закрытие по клику вне меню и по Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Состояние дружбы: пункт контекстный — добавить / принять / убрать.
  useEffect(() => {
    if (isSelf) return;
    let alive = true;
    fetch("/api/friends", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<FriendsResponse>) : null))
      .then((data) => {
        if (!alive) return;
        if (!data) { setFriendState("none"); return; }
        const friend = (data.friends ?? []).find((f) => f.id === user.id);
        if (friend) { setFriendState("friends"); setFriendshipId(friend.friendshipId ?? null); return; }
        const incoming = (data.pending ?? []).find((p) => p.sender?.id === user.id);
        if (incoming) { setFriendState("incoming"); setFriendshipId(incoming.id); return; }
        const outgoing = (data.sent ?? []).find((s) => s.receiver?.id === user.id);
        if (outgoing) { setFriendState("outgoing"); setFriendshipId(outgoing.id); return; }
        setFriendState("none");
      })
      .catch(() => { if (alive) setFriendState("none"); });
    return () => { alive = false; };
  }, [isSelf, user.id]);

  const api = useCallback(async (url: string, method: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && typeof data.error === "string" && data.error) || "Не удалось выполнить действие");
        return false;
      }
      return true;
    } catch {
      setError("Ошибка сети");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const openProfile = () => {
    if (user.username) router.push(`/profile/${encodeURIComponent(user.username)}`); // PROFILE-WALL2
    onClose();
  };

  /* Никнейм вводится полем прямо в меню.
     Раньше здесь стоял window.prompt — и в десктоп-оболочке пункт не делал
     ничего: Electron диалог prompt() не реализует, вызов молча возвращает null.
     В браузере окно появлялось, в приложении — нет. */
  const saveNickname = () => {
    if (nickDraft === null) return;
    const value = nickDraft.trim();
    onSetNickname(value ? value : null);
    onClose();
  };

  const clearNickname = () => {
    onSetNickname(null);
    onClose();
  };

  const handleFriend = async () => {
    if (friendState === "none") {
      if (await api("/api/friends", "POST", { userId: user.id, username: user.username ?? undefined })) {
        setFriendState("outgoing");
        setNotice("Запрос отправлен");
      }
    } else if (friendState === "friends" && friendshipId) {
      if (await api(`/api/friends/${friendshipId}`, "DELETE")) {
        setFriendState("none");
        setNotice("Удалён из друзей");
      }
    } else if (friendState === "incoming" && friendshipId) {
      if (await api(`/api/friends/${friendshipId}`, "PATCH", { action: "accept" })) {
        setFriendState("friends");
        setNotice("Теперь вы друзья");
      }
    }
  };

  /* ── Жалоба ───────────────────────────────────────────────────────────── */

  const sendReport = async (reason: string) => {
    if (!groupId) return;
    if (await api(`/api/groups/${groupId}/reports`, "POST", {
      targetId: user.id,
      messageId: message?.id ?? undefined,
      reason,
    })) {
      setOpenSub(null);
      setNotice("Жалоба отправлена модераторам");
    }
  };

  /* ── Меры ─────────────────────────────────────────────────────────────── */

  const removeMessage = async (): Promise<boolean> => {
    if (!message) return false;
    return api(`/api/messages?messageId=${encodeURIComponent(message.id)}`, "DELETE");
  };

  const onDeleteMessage = async () => {
    if (await removeMessage()) setNotice("Сообщение удалено");
  };

  const onDeleteAndTimeout = async () => {
    if (!groupId || !targetMemberId) return;
    if (!(await removeMessage())) return;
    if (await api(`/api/groups/${groupId}/members/${targetMemberId}/timeout`, "POST", { minutes: DELETE_AND_TIMEOUT_MINUTES })) {
      setNotice(`Удалено, ограничение на ${DELETE_AND_TIMEOUT_MINUTES} минут`);
    }
  };

  const onDeleteAndBan = async () => {
    if (!groupId) return;
    if (!window.confirm(
      `Удалить сообщение и заблокировать ${user.name}?\n\nОстальные сообщения останутся — для массовой чистки есть пункт «Очистить сообщения».`,
    )) return;
    if (!(await removeMessage())) return;
    if (await api(`/api/groups/${groupId}/bans`, "POST", { userId: user.id })) {
      setNotice("Сообщение удалено, пользователь заблокирован");
    }
  };

  const onPurge = async (scope: string, label: string) => {
    if (!groupId) return;
    if (!window.confirm(`${label} от ${user.name}?\n\nЭто необратимо.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/moderation/purge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, scope }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && typeof data.error === "string" && data.error) || "Не удалось очистить сообщения");
        return;
      }
      setOpenSub(null);
      setNotice(`Удалено сообщений: ${data?.deleted ?? 0}`);
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const applyTimeout = async (minutes: number) => {
    if (!groupId || !targetMemberId) return;
    if (await api(`/api/groups/${groupId}/members/${targetMemberId}/timeout`, "POST", { minutes })) {
      setOpenSub(null);
      setNotice("Таймаут выдан");
    }
  };

  const removeTimeout = async () => {
    if (!groupId || !targetMemberId) return;
    if (await api(`/api/groups/${groupId}/members/${targetMemberId}/timeout`, "DELETE")) {
      setOpenSub(null);
      setNotice("Таймаут снят");
    }
  };

  const kickUser = async () => {
    if (!groupId || !targetMemberId) return;
    if (!window.confirm(`Исключить ${user.name} из группы? Вернуться по приглашению он сможет.`)) return;
    if (await api(`/api/groups/${groupId}/members/${targetMemberId}`, "DELETE")) {
      setNotice("Участник исключён");
    }
  };

  const banUser = async () => {
    if (!groupId) return;
    if (!window.confirm(`Заблокировать ${user.name}? Он будет исключён и не сможет вернуться по приглашению.`)) return;
    if (await api(`/api/groups/${groupId}/bans`, "POST", { userId: user.id })) {
      setNotice("Пользователь заблокирован");
    }
  };

  const setRole = async (role: string) => {
    if (!groupId || !targetMemberId) return;
    if (await api(`/api/groups/${groupId}/members/${targetMemberId}`, "PATCH", { role })) {
      setOpenSub(null);
      setNotice(`Новая роль: ${ROLE_LABEL[role] ?? role}`);
    }
  };

  const toggleRole = async (roleId: string) => {
    if (!groupId) return;
    const has = assignedRoles.has(roleId);
    const ok = await api(`/api/groups/${groupId}/roles/${roleId}/members`, has ? "DELETE" : "POST", { userId: user.id });
    if (ok) {
      setAssignedRoles((prev) => {
        const next = new Set(prev);
        if (has) next.delete(roleId);
        else next.add(roleId);
        return next;
      });
    }
  };

  const sub = (name: Exclude<SubMenu, null>) => () => setOpenSub(openSub === name ? null : name);
  /* Стрелка подменю рисуется, а не набирается символом. Знаки ▸ и ▾ в разных
     системных шрифтах выглядят по-разному: где-то это едва различимая точка,
     где-то жирный клин не по размеру строки. У векторной стрелки одинаковая
     толщина линии на всех платформах, и она разворачивается при раскрытии. */
  const caret = (name: Exclude<SubMenu, null>) => (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3 h-3 flex-shrink-0 opacity-70 transition-transform ${openSub === name ? "rotate-90" : ""}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );

  const showModeration = can("delete-message") || can("purge") || can("timeout") || can("kick") || can("ban");
  const showAdmin = (can("assign-tags") && roles.length > 0) || (can("set-role") && grantableRoles.length > 0);

  if (!mounted) return null;

  /* Мини-профиль. Ник, роль и теги переехали сюда из ленты сообщений: в чате
     они повторялись у каждого автора и съедали строку. Роль и теги здесь —
     всегда те, что действуют в ЭТОМ сообществе, поэтому у одного человека в
     разных сообществах мини-профиль выглядит по-разному. */
  const menu = (
    <div
      ref={menuRef}
      /* Прокручивается только список действий, шапка с профилем закреплена:
         раньше уезжала вся карточка целиком, и человек, докрутив до нижних
         пунктов, переставал видеть, к кому они относятся. */
      className="fixed z-[200] w-60 flex flex-col rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl select-none animate-fade-in overflow-hidden"
      style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight || undefined }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={onPointerKeep}
      onMouseLeave={onPointerAway}
    >
      {/* Шапка-баннер: раньше её рисовала отдельная карточка по наведению, и
          две панели налезали друг на друга. Теперь окно одно. */}
      <div className="relative h-14 flex-shrink-0 overflow-hidden rounded-t-[10px] bg-gradient-to-br from-violet-500/30 to-indigo-600/20 dark:from-cyan-500/20 dark:to-violet-600/20">
        {user.profileBanner && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={user.profileBanner} alt="" className="absolute inset-0 h-full w-full object-cover" style={bannerImgStyle(user.profileBanner)} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
      </div>

      <div className="flex items-start gap-2.5 px-2.5 pt-2 pb-2 -mt-5 relative flex-shrink-0">
        <GlowAvatar
          user={{
            id: user.id,
            name: user.name,
            avatar: user.avatar ?? null,
            role: user.role ?? "MEMBER",
            avatarGlowEnabled: user.avatarGlowEnabled,
            avatarGlowColors: user.avatarGlowColors ?? null,
          }}
          size={38}
        />
        <div className="min-w-0 flex-1 pt-5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-semibold text-neutral-900 dark:text-white truncate">{nickname || user.name}</span>
            {isOnline(user.lastSeen ?? null) && <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />}
          </div>
          {user.username && <div className="text-[11px] text-neutral-400 truncate">@{user.username}</div>}
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {isOnline(user.lastSeen ?? null)
              ? "В сети"
              : user.lastSeen
                ? `Был(а) ${timeAgo(user.lastSeen)}`
                : "Не в сети"}
          </div>
          {(targetRole || targetTags.length > 0) && (
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {targetRole && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: "var(--cn-accent-dim)", color: "var(--cn-accent-text)" }}
                >
                  {ROLE_LABEL[targetRole] ?? targetRole}
                </span>
              )}
              {targetTags.map((t) => (
                <span
                  key={t.name}
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ backgroundColor: `${t.color}26`, color: t.color }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {groupId && (targetRole || targetTags.length > 0) && (
            <div className="text-[10px] text-neutral-400 mt-1">в этом сообществе</div>
          )}
        </div>
      </div>
      <div className="px-1.5 pb-1.5 flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <Divider />
      {user.username && <button className={ITEM} onClick={openProfile}>Профиль</button>}
      {!isSelf && <button className={ITEM} onClick={onMention}>Упомянуть</button>}
      {!isSelf && <button className={ITEM} onClick={() => onOpenDm(user.id)}>Написать сообщение</button>}
      {nickDraft === null ? (
        <>
          <button className={ITEM} onClick={() => setNickDraft(nickname ?? "")}>
            {nickname ? "Изменить никнейм" : "Добавить никнейм"}
          </button>
          {/* Убрать ник можно было только одним способом: открыть окно ввода и
              стереть текст. Отдельный пункт появляется, когда ник задан. */}
          {nickname && (
            <button className={ITEM} onClick={clearNickname}>Убрать никнейм</button>
          )}
        </>
      ) : (
        <div className="px-2.5 py-2 space-y-1.5">
          <input
            autoFocus
            value={nickDraft}
            maxLength={32}
            onChange={(e) => setNickDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); saveNickname(); }
              /* Escape закрывает поле, а не всё меню: обработчик меню слушает
                 клавишу на документе, поэтому событие дальше не пускаем. */
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setNickDraft(null); }
            }}
            placeholder={user.name}
            className="w-full rounded-lg border border-neutral-200 dark:border-white/15 bg-transparent px-2 py-1 text-[13px] text-neutral-900 dark:text-white outline-none focus:border-neutral-400 dark:focus:border-white/30"
          />
          <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
            Виден только вам, на этом устройстве
          </p>
          <div className="flex gap-1.5">
            <button
              className="flex-1 rounded-lg bg-neutral-900 dark:bg-white/15 px-2 py-1 text-[12px] text-white transition-colors hover:bg-neutral-800 dark:hover:bg-white/25"
              onClick={saveNickname}
            >
              Сохранить
            </button>
            <button
              className="flex-1 rounded-lg border border-neutral-200 dark:border-white/15 px-2 py-1 text-[12px] text-neutral-600 dark:text-neutral-300 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
              onClick={() => setNickDraft(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {!isSelf && (
        <>
          <Divider />
          <button
            className={ITEM}
            disabled={busy || friendState === "loading" || friendState === "outgoing"}
            onClick={handleFriend}
          >
            {friendState === "loading" ? "Проверка друзей…"
              : friendState === "friends" ? "Убрать из друзей"
              : friendState === "incoming" ? "Принять в друзья"
              : friendState === "outgoing" ? "Запрос отправлен"
              : "Добавить в друзья"}
          </button>
          <button className={ignored ? ITEM : DANGER} onClick={() => { onToggleIgnore(); onClose(); }}>
            {ignored ? "Не игнорировать" : "Игнорировать"}
          </button>
          {/* Жалоба доступна всем: игнор защищает одного смотрящего и никому
              ничего не сообщает, жалоба зовёт того, кто может вмешаться. */}
          {groupId && (
            <>
              <button className={ITEM} onClick={sub("report")}>
                <span>Пожаловаться</span>
                {caret("report")}
              </button>
              {openSub === "report" && (
                <div className="pl-2">
                  {REPORT_REASONS.map((r) => (
                    <button key={r.value} className={ITEM} disabled={busy} onClick={() => sendReport(r.value)}>{r.label}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {showModeration && groupId && (
        <>
          <Divider />
          {can("delete-message") && (
            <button className={DANGER} disabled={busy} onClick={onDeleteMessage}>Удалить сообщение</button>
          )}
          {can("delete-and-timeout") && targetMemberId && (
            <button className={DANGER} disabled={busy} onClick={onDeleteAndTimeout}>Удалить и ограничить</button>
          )}
          {can("delete-and-ban") && (
            <button className={DANGER} disabled={busy} onClick={onDeleteAndBan}>Удалить и забанить</button>
          )}
          {can("purge") && (
            <>
              <button className={DANGER} onClick={sub("purge")}>
                <span>Очистить сообщения</span>
                {caret("purge")}
              </button>
              {openSub === "purge" && (
                <div className="pl-2">
                  {PURGE_SCOPES.map((s) => (
                    <button key={s.value} className={ITEM} disabled={busy} onClick={() => onPurge(s.value, s.label)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {can("timeout") && targetMemberId && (
            <>
              <button className={DANGER} onClick={sub("timeout")}>
                <span>Таймаут</span>
                {caret("timeout")}
              </button>
              {openSub === "timeout" && (
                <div className="pl-2">
                  {TIMEOUT_OPTIONS.map((o) => (
                    <button key={o.minutes} className={ITEM} disabled={busy} onClick={() => applyTimeout(o.minutes)}>{o.label}</button>
                  ))}
                  {can("untimeout") && (
                    <button className={ITEM} disabled={busy} onClick={removeTimeout}>Снять таймаут</button>
                  )}
                </div>
              )}
            </>
          )}
          {can("kick") && targetMemberId && (
            <button className={DANGER} disabled={busy} onClick={kickUser}>Исключить из группы</button>
          )}
          {can("ban") && (
            <button className={DANGER} disabled={busy} onClick={banUser}>Заблокировать</button>
          )}
        </>
      )}

      {showAdmin && groupId && (
        <>
          <Divider />
          {can("set-role") && targetMemberId && grantableRoles.length > 0 && (
            <>
              <button className={ITEM} onClick={sub("setrole")}>
                <span>Роль в группе</span>
                {caret("setrole")}
              </button>
              {openSub === "setrole" && (
                <div className="pl-2">
                  {grantableRoles.map((r) => (
                    <button key={r} className={ITEM} disabled={busy || r === targetRole} onClick={() => setRole(r)}>
                      <span>{ROLE_LABEL[r]}</span>
                      {r === targetRole && <span className="text-green-500"><CheckIcon size={12} style={{ color: "inherit" }} /></span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {can("assign-tags") && roles.length > 0 && (
            <>
              <button className={ITEM} onClick={sub("roles")}>
                <span>Теги</span>
                {caret("roles")}
              </button>
              {openSub === "roles" && (
                <div className="pl-2 max-h-44 overflow-y-auto">
                  {roles.map((r) => (
                    <button key={r.id} className={ITEM} disabled={busy} onClick={() => toggleRole(r.id)}>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
                        <span className="truncate">{r.name}</span>
                      </span>
                      {assignedRoles.has(r.id) && <span className="text-green-500"><CheckIcon size={12} style={{ color: "inherit" }} /></span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {(error || notice) && (
        <div className={`px-2.5 py-1 text-[11px] ${error ? "text-red-500" : "text-green-500"}`}>{error ?? notice}</div>
      )}
      </div>
    </div>
  );

  return createPortal(menu, document.body);
}
