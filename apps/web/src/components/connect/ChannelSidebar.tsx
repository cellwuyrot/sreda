"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { type GlowAvatarUser } from "@/components/ui/GlowAvatar";
import type { Channel, VoiceUser, GroupDetail, VoiceState, VoiceActions } from "./sidebarTypes";
import { ChannelSettingsModal } from "./ChannelSettingsModal";
import { ChannelItem } from "./ChannelItem";
import { VoiceUserRow, VoiceControlBtn, VoiceOccupantsStrip } from "./VoiceControls"; // FIX-VAVATAR
import SectionsPanel from "./SectionsPanel";
import ModulesPanel from "./ModulesPanel";
import GroupHeaderMenu from "./GroupHeaderMenu";
import CooperationButton from "./CooperationButton"; // FIX-COOP
import { MicIcon, MutedMicIcon, DeafenOffIcon, DeafenOnIcon, NsIcon, ScreenShareIcon, HangupIcon } from "./voiceIcons";
import { VoiceChannelIcon, ChatIcon, PrivateChatIcon, PrivateVoiceIcon } from "@/components/ui/ConnectIcons";
import ScreenSharePrivacyModal from "@/components/voice/ScreenSharePrivacyModal";
import { isModuleType } from "@/lib/channelModules";
import { isServiceLinkedChannel } from "@/lib/serviceChannels"; // FIX-SRVLINK
import { useDragOrder } from "./useDragOrder";
import { useDragUser } from "./useDragUser"; // FIX-DRAGORDER
/* GROUP-SKIN: шапка сообщества берётся из оформления группы. */
import { bannerCss, parseGroupTheme } from "@/lib/groupTheme";

/* ─── Props ─── */

interface ChannelSidebarProps {
  groupDetail: GroupDetail;
  selectedChannel: string | null;
  unreadCounts: Record<string, number>;
  mentionChannels?: Record<string, boolean>;
  canManage: boolean;
  isMainCommunity?: boolean;
  /** FIX-COOP: показать кнопку «Сотрудничество» в нижних действиях панели (главная группа). */
  showCooperation?: boolean;
  blockMode?: boolean;
  generalChannelId?: string | null;
  myProfileUser: GlowAvatarUser;
  userName: string;
  userUsername: string;
  userRole: string;
  onChannelClick: (channel: Channel) => void;
  onDeleteChannel: (channelId: string) => void;
  onCreateChannel: (options?: { parentId?: string | null; createCategory?: boolean; groupType?: "TEXT" | "VOICE"; defaultType?: string }) => void;
  onInvite: () => void;
  onProfileSettings: () => void;
  onOpenSettings?: () => void;
  /** Число участников для меню в шапке группы. */
  memberCount: number;
  onBack?: () => void;
  voiceState?: VoiceState;
  voiceActions?: VoiceActions;
  onVoiceExpand?: () => void;
  /** Вернуть в колонку контента то, что идёт в голосовом канале (показ экрана). */
  onVoiceFocus?: () => void;
  onGroupRefresh?: () => void;
  /** Leave the current community (hidden for the main community and for owners). */
  onLeaveGroup?: () => void;
}

export default function ChannelSidebar({
  groupDetail, selectedChannel, unreadCounts, mentionChannels = {}, canManage, isMainCommunity,
  showCooperation, blockMode, generalChannelId,
  myProfileUser, userName, userUsername, userRole,
  onChannelClick, onDeleteChannel, onCreateChannel,
  onInvite, onProfileSettings, onOpenSettings, memberCount, onBack,
  voiceState, voiceActions, onVoiceExpand, onVoiceFocus, onGroupRefresh, onLeaveGroup,
}: ChannelSidebarProps) {
  // FIX-PERF: Вычисление списков каналов вынесено в useMemo — пересчёт только
  // при изменении массива каналов или generalChannelId, а не при каждом рендере.
  // Какие типы — модули (показываются в блоке «Разделы», а не в общем списке
  // каналов) — решает общий список lib/channelModules.ts. Своя копия здесь
  // расходилась с копией в панели модулей: канал попадал то в оба места сразу,
  // то ни в одно.
  const categoryChannels = useMemo(
    () => groupDetail.channels.filter((c) => c.type === "CATEGORY"),
    [groupDetail.channels],
  );
  const textChannels = useMemo(
    () => groupDetail.channels.filter((c) => c.type !== "VOICE" && c.type !== "CATEGORY"),
    [groupDetail.channels],
  );
  const voiceChannels = useMemo(
    () => groupDetail.channels.filter((c) => c.type === "VOICE"),
    [groupDetail.channels],
  );

  /* ── Channel settings modal ── */
  /* FIX-DRAGORDER: порядок каналов задаётся перетаскиванием прямо в колонке.
     Сохраняет тот же PUT /api/channels/reorder, что и окно «Порядок каналов»:
     сервер пишет sortOrder по индексу и сам проверяет права. */
  const commitOrder = async (ids: string[]) => {
    await fetch("/api/channels/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelIds: ids, groupId: groupDetail.id }),
    }).catch(() => {});
    onGroupRefresh?.();
  };
  const drag = useDragOrder({ enabled: !!canManage, onReorder: commitOrder });

  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  /* Окно запуска демонстрации: то же, что в развёрнутой комнате. Кнопка здесь
     стартовала показ сразу, поэтому качество и звук выбрать было негде, а
     приватный показ отсюда был вообще недоступен. */
  const [shareLaunchOpen, setShareLaunchOpen] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [reorderChannels, setReorderChannels] = useState<Channel[]>([]);
  const [reorderSaving, setReorderSaving] = useState(false);

  /* ── Mute state ── */
  const [groupMuted, setGroupMuted] = useState(false);
  const [channelMutes, setChannelMutes] = useState<Record<string, boolean>>({});
  const groupId = groupDetail.channels[0]?.groupId;

  useEffect(() => {
    if (!groupId) return;
    fetch(`/api/channels/mute?groupId=${groupId}`)
      .then(r => r.json())
      .then(data => {
        setGroupMuted(data.groupMuted ?? false);
        setChannelMutes(data.channels ?? {});
      })
      .catch(() => {});
  }, [groupId]);

  const handleToggleChannelMute = async (channelId: string, muted: boolean) => {
    setChannelMutes(prev => ({ ...prev, [channelId]: muted }));
    await fetch("/api/channels/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, muted }),
    });
  };

  /* ── Collapsible category state ── */
  const [textOpen,  setTextOpen]  = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  /* ── Service group collapse state (for main community) ── */
  const [collapsedServices, setCollapsedServices] = useState<Record<string, boolean>>({});

  const toggleServiceGroup = (serviceId: string) => {
    setCollapsedServices(prev => ({ ...prev, [serviceId]: !prev[serviceId] }));
  };

  const toggleCategoryGroup = (categoryId: string) => {
    setCollapsedCategories(prev => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  /* ── Group channels by serviceId for main community ── */
  // FIX-PERF: Группировка сервисов — дорогая операция с Map и обходом массива,
  // мемоизирована по textChannels и isMainCommunity.
  const serviceGroups = useMemo(() => {
    if (!isMainCommunity) return null;
    const groups: { serviceId: string; serviceName: string; channels: typeof textChannels }[] = [];
    const ungrouped: typeof textChannels = [];
    const serviceMap = new Map<string, typeof textChannels>();
    const serviceNames = new Map<string, string>();

    for (const ch of textChannels) {
      if (ch.parentId) continue;
      // FIX-SRVCHAN: осиротевший чат услуги (serviceId потерян) в общий список не попадает.
      if (!ch.serviceId && isServiceLinkedChannel(ch)) continue;
      if (ch.serviceId) {
        const arr = serviceMap.get(ch.serviceId) ?? [];
        arr.push(ch);
        serviceMap.set(ch.serviceId, arr);
        // Derive service name from the NEWS channel or first channel
        if (ch.type === "NEWS" || !serviceNames.has(ch.serviceId)) {
          // Strip " — Обсуждение" / " — Вопросы" suffix to get base name
          const baseName = ch.name.replace(/ — (Обсуждение|Вопросы)$/, "");
          serviceNames.set(ch.serviceId, baseName);
        }
      } else {
        ungrouped.push(ch);
      }
    }

    for (const [sId, chs] of serviceMap) {
      groups.push({ serviceId: sId, serviceName: serviceNames.get(sId) || "Услуга", channels: chs });
    }

    return { groups, ungrouped };
  }, [isMainCommunity, textChannels]);

  /* FIX-MAINTEXT: остальные текстовые чаты блочного режима. В блочном режиме
     (главная группа и группы с разделами) список показывал ровно один чат —
     общий, — и созданный второй текстовый канал попадал в никуда: сервер его
     создавал, а в боковой панели его не было. Разделы (parentId) и чаты услуг
     (serviceId) здесь не нужны — их показывают свои панели. */
  const blockTextChannels = useMemo(() => {
    if (!blockMode) return [];
    return textChannels.filter((ch) => {
      const c = ch as unknown as { id: string; type?: string; parentId?: string | null; serviceId?: string | null };
      // FIX-FEED: улучшенный чат стоит в том же списке, что обычный.
      // FIX-SRVCHAN: чаты услуг показывает только панель разделов.
      if (isServiceLinkedChannel(c as { name?: string; serviceId?: string | null })) return false;
      /* FIX-CHATCOL: общий чат больше не исключается из списка: он такой же чат
         этой колонки. Заодно ушла главная причина бага: без закреплённого
         чата весь блок «Текстовые чаты» вообще не рисовался. */
      return !c.parentId && (c.type === "TEXT" || c.type === "FEED");
    })
      .slice()
      .sort((a, b) => {
        const so = ((a as { sortOrder?: number }).sortOrder ?? 0) - ((b as { sortOrder?: number }).sortOrder ?? 0);
        if (so !== 0) return so;
        /* Пока порядок вручную не задан (sortOrder у всех 0) общий
           чат остаётся сверху; дальше решает перетаскивание. */
        if (a.id === generalChannelId) return -1;
        if (b.id === generalChannelId) return 1;
        return 0;
      });
  }, [blockMode, textChannels, generalChannelId]);

  /* ── Track voice channel occupants via separate socket ── */
  const [channelUsersMap, setChannelUsersMap] = useState<Record<string, VoiceUser[]>>({});
  const [volumeOpen, setVolumeOpen] = useState<string | null>(null);
  // ПКМ-меню модерации в боковой панели
  type SidebarModMenu = {
    socketId: string; userId: string; userName: string;
    x: number; y: number; channelId: string;
    modChecked: boolean; canKickVoice: boolean; canForceMute: boolean;
    canForceDeafen: boolean; canMove: boolean; canBan: boolean;
    groupId: string | undefined; voiceChannels: Array<{ id: string; name: string }>;
    /** FIX-FORCELOCK: текущее состояние целевого пользователя */
    targetIsForceMuted: boolean; targetIsForceDeafened: boolean;
  };
  const [sidebarModMenu, setSidebarModMenu] = useState<SidebarModMenu | null>(null);
  // FIX-DND: заменяем HTML5 drag-events на поинтерный хук useDragUser
  const dragUser = useDragUser({
    // FIX-DND-PERM: мод, не сидящий в войсе сам, тоже должен перетаскивать.
    // voiceActions есть только когда ТЫ в войсе; canManage — признак модератора/владельца.
    enabled: !!canManage || !!voiceActions,
    onMove: async (socketId: string, userId: string, targetChannelId: string) => {
      if (!groupDetail) return;
      await fetch("/api/voice/move-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId, targetChannelId, groupId: groupDetail.id }),
      }).catch(() => {});
    },
  });
  // Закрытие ПКМ-меню модерации при клике мимо или Escape
  useEffect(() => {
    if (!sidebarModMenu) return;
    const close = () => setSidebarModMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarModMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [sidebarModMenu]);


  // FIX-PERF: Реф для актуального списка голосовых каналов — позволяет читать
  // свежие данные внутри замыканий эффекта без добавления voiceChannels в deps,
  // иначе сокет пересоздавался бы при каждом изменении списка каналов.
  const voiceChannelsRef = useRef(voiceChannels);
  useEffect(() => { voiceChannelsRef.current = voiceChannels; }, [voiceChannels]);

  // FIX-PERF: Сокет создаётся ровно один раз за время жизни группы (deps: [groupDetail.id]).
  // Раньше в deps было groupDetail.channels.length, что рвало и пересоздавало
  // соединение при каждом добавлении/удалении канала.
  useEffect(() => {
    const sock = io({ path: "/api/socketio", transports: ["websocket", "polling"] });
    const handle = ({ channelId, users }: { channelId: string; users: VoiceUser[] }) => {
      setChannelUsersMap(prev => ({ ...prev, [channelId]: users }));
    };
    sock.on("voice-channel-users", handle);
    /* FIX-VPRESENCE: поштучные запросы по каналам остаются, но сводный ответ
       надёжнее: он отдаёт все комнаты своих сообществ сразу, включая приватные
       по ролям голосовые каналы, где столбик с количеством оставался пустым. */
    const handleAll = (all: Record<string, VoiceUser[]>) => {
      setChannelUsersMap(prev => ({ ...prev, ...all }));
    };
    sock.on("all-voice-users", handleAll);
    const currentGroupId = groupDetail.id;
    const onConnect = () => {
      // Live voice-presence updates are now scoped to the channel's group room
      // (the server no longer broadcasts them to everyone), so join it to keep
      // the sidebar previews updating. The per-channel query below still seeds
      // the current snapshot immediately.
      sock.emit("join-group", { groupId: currentGroupId });
      sock.emit("get-all-voice-users"); // FIX-VPRESENCE
      voiceChannelsRef.current.forEach(ch => sock.emit("get-voice-channel-users", { channelId: ch.id }));
    };
    sock.on("connect", onConnect);
    // A reconnect gives a fresh socket that is in no rooms — re-join and re-query.
    sock.io.on("reconnect", onConnect);

    // Периодическая сверка присутствия: страхует от потери события при кратком
    // разрыве. 30 с вместо 5 с — события voice-channel-users и так приходят
    // в реальном времени; частый опрос не нужен. Не отправляем на скрытой вкладке.
    let reconcileId: ReturnType<typeof setInterval> | undefined;

    const startReconcile = () => {
      clearInterval(reconcileId);
      if (document.visibilityState === "hidden") return;
      reconcileId = setInterval(() => {
        if (!sock.connected || document.visibilityState === "hidden") return;
        sock.emit("get-all-voice-users"); // FIX-VPRESENCE
        voiceChannelsRef.current.forEach(ch => sock.emit("get-voice-channel-users", { channelId: ch.id }));
      }, 30_000);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Вкладка снова активна — немедленная сверка и перезапуск таймера
        if (sock.connected) {
          voiceChannelsRef.current.forEach(ch => sock.emit("get-voice-channel-users", { channelId: ch.id }));
        }
        startReconcile();
      } else {
        clearInterval(reconcileId);
      }
    };

    startReconcile();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(reconcileId);
      document.removeEventListener("visibilitychange", onVisibility);
      sock.disconnect();
    };
  }, [groupDetail.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* GROUP-SKIN: шапка сообщества. Приоритет у оформления из раздела «Дизайн»;
     старое поле `banner` остаётся запа��ным вариантом для групп, где тему
     ещё не настроили — иначе у всех сразу пропала бы загруженная картинка. */
  const groupSkin = useMemo(() => parseGroupTheme(groupDetail.theme ?? null), [groupDetail.theme]);
  const skinBanner = groupSkin.enabled ? groupSkin.banner : null;
  const bannerVideo = skinBanner && skinBanner.kind === "video" && skinBanner.url ? skinBanner.url : "";
  const skinLayer = skinBanner && !bannerVideo ? bannerCss(skinBanner) : "none";
  const bannerLayer = skinLayer !== "none" ? skinLayer : groupDetail.banner ? `url("${groupDetail.banner}")` : "";
  /* Анимация есть только у градиента: картинку двигать нечем, а видео движется само. */
  const bannerAnimated = !!skinBanner && skinBanner.animated && skinBanner.kind === "gradient";
  /* Затенение нужно для читаемости названия поверх любой картинки. */
  const bannerDim = skinBanner ? skinBanner.overlay / 100 : 0.62;
  const bannerShade = `linear-gradient(to bottom, rgba(0,0,0,${(bannerDim * 0.3).toFixed(3)}), rgba(0,0,0,${bannerDim.toFixed(3)}))`;
  const hasBanner = !!bannerLayer || !!bannerVideo;

  const isInVoice = voiceState?.isConnected && voiceState?.channelId;
  const currentVoiceChannelId = voiceState?.channelId;

  return (
    <aside className="cn-sidebar w-full flex flex-col h-full flex-shrink-0 min-w-0">
      {/* ── Header ──
          Название группы теперь кликабельно и открывает меню со всеми
          действиями (настройки, инвайты, участники, мьют, выход). */}
      <div
        className={`p-3 flex items-center gap-2 relative z-20 overflow-visible${
          bannerAnimated && bannerLayer ? " tz-group-banner-animated" : ""
        }`}
        style={{
          borderBottom: "1px solid var(--cn-border)",
          flexShrink: 0,
          /* GROUP-SKIN: баннер из оформления сообщества или старая картинка. */
          ...(hasBanner
            ? {
                minHeight: 88,
                alignItems: "flex-end",
                ...(bannerLayer
                  ? {
                      backgroundImage: `${bannerShade}, ${bannerLayer}`,
                      backgroundSize: bannerAnimated ? "auto, 220% 220%" : "cover",
                      backgroundPosition: "center",
                    }
                  : {}),
                color: "#fff",
              }
            : {}),
        }}
      >
        {/* GROUP-SKIN: видео-баннер. Обёртка с отрицательным z-index и своим
            overflow-hidden: клипает только себя, поэтому выпадающее меню шапки
            по-прежнему выходит за границы блока. */}
        {bannerVideo && (
          <span className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: -1 }} aria-hidden="true">
            <video
              src={bannerVideo}
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0" style={{ background: bannerShade }} />
          </span>
        )}
        {onBack && (
          <button onClick={onBack} className="-ml-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center flex-shrink-0 text-neutral-400 hover:text-neutral-600 active:text-neutral-600 dark:hover:text-white dark:active:text-white" aria-label="Назад к сообществам" title="Назад к сообществам">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <GroupHeaderMenu
            groupId={groupDetail.id}
            name={groupDetail.name}
            description={groupDetail.description}
            memberCount={memberCount ?? groupDetail.membersTotal ?? groupDetail.members.length}
            canManage={!!canManage}
            isOwner={groupDetail.myRole === "OWNER"}
            isMainCommunity={!!isMainCommunity}
            onOpenSettings={onOpenSettings}
            onInvite={onInvite}
            onCreateChannel={onCreateChannel ? () => onCreateChannel() : undefined}
            onLeaveGroup={onLeaveGroup}
          />
        </div>
      </div>

      {/* ── Channels ──
          `overflow-x-hidden` matters: a bare `overflow-y-auto` makes the browser
          compute `overflow-x` as `auto` too, so any child a hair too wide (a long
          name, a pop-out) would summon a horizontal scrollbar. Pinning x to
          hidden keeps the list to a single, vertically-scrolling column. */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5" aria-label="Каналы">
        {/* ── Block mode: single general chat at top ── */}
        {blockMode && (
          <>
            {/* FIX-MAINTEXT: в главной группе голосовые каналы настраивались как обычно,
                а текстовый — никак: строка общего чата рисовалась с canManage={false},
                поэтому у неё не было ни настроек, ни удаления, а кнопки «создать» рядом
                не было вовсе. Права тут те же, что и у голосовых, и их проверяет сервер
                (POST /api/channels и PUT|DELETE /api/channels/[id] — только владелец и
                администратор); интерфейс просто перестал скрывать разрешённое. */}
            <div className="group/cat flex items-center justify-between px-2 py-1">
              <span className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">Текстовые чаты</span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => onCreateChannel({ groupType: "TEXT", defaultType: "TEXT" })}
                  aria-label="Создать текстовый чат"
                  className="text-neutral-400 transition-colors hover:text-violet-600 dark:hover:text-cyan-400 opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              )}
            </div>
            {blockTextChannels.map((ch) => (
              <div
                key={ch.id}
                className={drag.itemClass(ch.id)}
                {...drag.itemProps(ch.id, blockTextChannels.map((c) => c.id))}
              >
                <ChannelItem
                  ch={ch}
                  selectedChannel={selectedChannel}
                  unreadCounts={unreadCounts}
                  mentionChannels={mentionChannels}
                  canManage={!!canManage}
                  onChannelClick={onChannelClick}
                  onDeleteChannel={onDeleteChannel}
                  onEditChannel={canManage ? setEditingChannel : undefined}
                  isMuted={channelMutes[ch.id] ?? (groupMuted && channelMutes[ch.id] !== false)}
                  onToggleMute={handleToggleChannelMute}
                />
              </div>
            ))}
          </>
        )}

        {/* ── Main community: group by service ── */}
        {!blockMode && (isMainCommunity && serviceGroups ? (
          <>
            {/* Ungrouped channels (no serviceId) */}
            {serviceGroups.ungrouped.length > 0 && (
              <>
                <div className="flex items-center justify-between px-2 py-1 group/cat">
                  <button
                    onClick={() => setTextOpen(o => !o)}
                    className="flex items-center gap-1.5 flex-1 text-left text-[11px] text-neutral-400 uppercase tracking-wider font-semibold hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                    aria-expanded={textOpen}
                  >
                    <svg className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${textOpen ? "rotate-90" : "rotate-0"}`} fill="none" viewBox="0 0 6 10">
                      <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Общие
                  </button>
                  {canManage && textOpen && (
                    <button onClick={() => onCreateChannel()} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100" aria-label="Создать канал">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                </div>
                {textOpen && serviceGroups.ungrouped.map((ch) => (
                  /* FIX-DRAG-UNGROUPED: каналы без сервисной группы теперь
                     поддерживают перетаскивание — drag.itemProps добавляет
                     data-drag-id и onPointerDown так же, как это сделано
                     для rootChannels в обычной группе (line ~634). */
                  <div key={ch.id} className={drag.itemClass(ch.id)} {...drag.itemProps(ch.id, serviceGroups.ungrouped.map(c => c.id))}>
                    <ChannelItem ch={ch} selectedChannel={selectedChannel} unreadCounts={unreadCounts} mentionChannels={mentionChannels} canManage={canManage} onChannelClick={onChannelClick} onDeleteChannel={onDeleteChannel} onEditChannel={canManage ? setEditingChannel : undefined} isMuted={channelMutes[ch.id] ?? (groupMuted && channelMutes[ch.id] !== false)} onToggleMute={handleToggleChannelMute} />
                  </div>
                ))}
              </>
            )}

            {/* Service-grouped channels */}
            {serviceGroups.groups.map((sg) => {
              const isCollapsed = !!collapsedServices[sg.serviceId];
              const hasUnread = sg.channels.some(c => (unreadCounts[c.id] ?? 0) > 0);
              return (
                <div key={sg.serviceId} className="!mt-2">
                  <div className="flex items-center justify-between px-2 py-1 group/cat">
                    <button
                      onClick={() => toggleServiceGroup(sg.serviceId)}
                      className="flex items-center gap-1.5 flex-1 text-left text-[11px] text-neutral-400 uppercase tracking-wider font-semibold hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                      aria-expanded={!isCollapsed}
                    >
                      <svg className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${!isCollapsed ? "rotate-90" : "rotate-0"}`} fill="none" viewBox="0 0 6 10">
                        <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {sg.serviceName}
                      {isCollapsed && hasUnread && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-cyan-400 flex-shrink-0" />
                      )}
                    </button>
                  </div>
                  {!isCollapsed && sg.channels.map((ch) => (
                    <ChannelItem key={ch.id} ch={ch} selectedChannel={selectedChannel} unreadCounts={unreadCounts} mentionChannels={mentionChannels} canManage={canManage} onChannelClick={onChannelClick} onDeleteChannel={onDeleteChannel} onEditChannel={canManage ? setEditingChannel : undefined} isMuted={channelMutes[ch.id] ?? (groupMuted && channelMutes[ch.id] !== false)} onToggleMute={handleToggleChannelMute} />
                  ))}
                </div>
              );
            })}
          </>
        ) : (
          <>
            {/* Regular group: flat text channels list */}
            <div className="flex items-center justify-between px-2 py-1 group/cat">
              <button
                onClick={() => setTextOpen(o => !o)}
                /* FIX-SECFONT: два главных раздела колонки жирнее и темнее созданных
                    групп: раньше новая группа выглядела ровно так же, и структура
                    колонки сливалась в один список. */
                className="flex items-center gap-1.5 flex-1 text-left text-[11px] text-neutral-500 dark:text-neutral-200 uppercase tracking-[0.14em] font-bold hover:text-neutral-700 dark:hover:text-white transition-colors"
                aria-expanded={textOpen}
              >
                <svg className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${textOpen ? "rotate-90" : "rotate-0"}`} fill="currentColor" viewBox="0 0 6 10">
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
                Т����кстовые
                {!textOpen && textChannels.some(c => (unreadCounts[c.id] ?? 0) > 0) && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-cyan-400 flex-shrink-0" />
                )}
              </button>
              {canManage && textOpen && (
            <div className="flex gap-0.5 opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100">
              <button onClick={() => onCreateChannel({ createCategory: true, groupType: "TEXT" })} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors" aria-label="Создать группу текстовых каналов">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h10M4 17h16" />
                </svg>
              </button>
              <button onClick={() => { setReorderChannels([...groupDetail.channels]); setShowReorder(true); }} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors" aria-label="Порядок каналов" title="Порядок каналов">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </button>
                  <button onClick={() => onCreateChannel()} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors" aria-label="Создать канал">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {textOpen && (() => {
              const flatList = textChannels.filter(c => !isModuleType(c.type));
              const rootChannels = flatList.filter(c => !c.parentId);
              const textCategories = categoryChannels.filter(c => c.channelGroupType !== "VOICE");
              return (
                <>
                  {textCategories.map((cat) => {
                    const isCollapsed = !!collapsedCategories[cat.id];
                    const children = flatList.filter(c => c.parentId === cat.id);
                    return (
                      /* FIX-DRAGORDER2: группы каналов тоже перетаскиваются по вертикали. */
                      <div key={cat.id} className={`!mt-2${drag.itemClass(cat.id)}`} {...drag.itemProps(cat.id, textCategories.map(c => c.id))}>
                        <div className="flex items-center justify-between px-2 py-1 group/cat">
                          <button onClick={() => toggleCategoryGroup(cat.id)} onContextMenu={(e) => { if (!canManage) return; e.preventDefault(); setEditingChannel(cat); }} className="flex items-center gap-1.5 flex-1 text-left text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide font-medium hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors" aria-expanded={!isCollapsed}>
                            <svg className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${!isCollapsed ? "rotate-90" : "rotate-0"}`} fill="currentColor" viewBox="0 0 6 10">
                              <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </svg>
                            {cat.name}
                          </button>
                        {/* FIX-CATSET: у группы каналов теперь есть свои настройки:
                            имя, значок и доступ по ролям. Раньше скрыть от части
                            участников можно было только каждый канал по отдельности. */}
                        {canManage && (
                          <button
                            onClick={() => setEditingChannel(cat)}
                            className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 p-0.5"
                            aria-label={`Настройки группы ${cat.name}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                        )}

                          {canManage && !isCollapsed && (
                            <button onClick={() => onCreateChannel({ parentId: cat.id, groupType: "TEXT", defaultType: "TEXT" })} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100" aria-label="Создать канал в группе">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            </button>
                          )}
						  {canManage && (
							<button
								onClick={() => onDeleteChannel(cat.id)}
								className="text-neutral-400 hover:text-red-500 transition-colors opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 p-0.5"
								aria-label={`Удалить группу ${cat.name}`}
							>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
								</svg>
							</button>
						)}
                        </div>
                        {!isCollapsed && children.map(sub => (
                          <div key={sub.id} className={`ml-4${drag.itemClass(sub.id)}`} {...drag.itemProps(sub.id, children.map(c => c.id))}>
                            <ChannelItem ch={sub} selectedChannel={selectedChannel} unreadCounts={unreadCounts} mentionChannels={mentionChannels} canManage={canManage} onChannelClick={onChannelClick} onDeleteChannel={onDeleteChannel} onEditChannel={canManage ? setEditingChannel : undefined} isMuted={channelMutes[sub.id] ?? (groupMuted && channelMutes[sub.id] !== false)} onToggleMute={handleToggleChannelMute} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {rootChannels.map(ch => (
                    <div key={ch.id} className={drag.itemClass(ch.id)} {...drag.itemProps(ch.id, rootChannels.map(c => c.id))}>
                      <ChannelItem ch={ch} selectedChannel={selectedChannel} unreadCounts={unreadCounts} mentionChannels={mentionChannels} canManage={canManage} onChannelClick={onChannelClick} onDeleteChannel={onDeleteChannel} onEditChannel={canManage ? setEditingChannel : undefined} isMuted={channelMutes[ch.id] ?? (groupMuted && channelMutes[ch.id] !== false)} onToggleMute={handleToggleChannelMute} />
                    </div>
                  ))}
                </>
              );
            })()}
          </>
        ))}

        {/* Voice channels — collapsible */}
        {voiceChannels.length > 0 && (
          <>
            <div className="flex items-center justify-between px-2 py-1 !mt-3 group/cat">
              <button
                onClick={() => setVoiceOpen(o => !o)}
                /* FIX-SECFONT: два главных раздела колонки жирнее и темнее созданных
                    групп: раньше новая группа выглядела ровно так же, и структура
                    колонки сливалась в один список. */
                className="flex items-center gap-1.5 flex-1 text-left text-[11px] text-neutral-500 dark:text-neutral-200 uppercase tracking-[0.14em] font-bold hover:text-neutral-700 dark:hover:text-white transition-colors"
                aria-expanded={voiceOpen}
              >
                <svg
                  className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${voiceOpen ? "rotate-90" : "rotate-0"}`}
                  fill="none" viewBox="0 0 6 10"
                >
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Голосовые
              </button>
              {canManage && voiceOpen && (
                <div className="flex gap-0.5 opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100">
                  <button onClick={() => onCreateChannel({ createCategory: true, groupType: "VOICE", defaultType: "VOICE" })} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors" aria-label="Создать папку для голосовых каналов">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {/* FIX-VOICEPLUS: рядом стояли два визуально одинаковых «плюса»:
                          «группа голосовых каналов» и «голосовой канал». Функции разные,
                          поэтому убрана не кнопка, а путаница: у группы теперь папка. */}
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8a2 2 0 012-2h3.6l1.6 2H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11.5v5M9.5 14h5" />
                    </svg>
                  </button>
                  <button onClick={() => onCreateChannel({ groupType: "VOICE", defaultType: "VOICE" })} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors" aria-label="Создать голосовой канал">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {voiceOpen && (
              <>
                {categoryChannels.filter((c) => c.channelGroupType === "VOICE").map((cat) => {
                  const isCollapsed = !!collapsedCategories[cat.id];
                  const children = voiceChannels.filter((c) => c.parentId === cat.id);
                  return (
                    /* FIX-DRAGORDER2: то же для групп голосовых каналов. */
                    <div key={cat.id} className={`!mt-2${drag.itemClass(cat.id)}`} {...drag.itemProps(cat.id, categoryChannels.filter((c) => c.channelGroupType === "VOICE").map((c) => c.id))}>
                      <div className="flex items-center justify-between px-2 py-1 group/cat">
                        <button onClick={() => toggleCategoryGroup(cat.id)} onContextMenu={(e) => { if (!canManage) return; e.preventDefault(); setEditingChannel(cat); }} className="flex items-center gap-1.5 flex-1 text-left text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide font-medium hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors" aria-expanded={!isCollapsed}>
                          <svg className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${!isCollapsed ? "rotate-90" : "rotate-0"}`} fill="none" viewBox="0 0 6 10">
                            <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {cat.name}
                        </button>
                        {/* FIX-CATSET: у группы каналов теперь есть свои настройки:
                            имя, значок и доступ по ролям. Раньше скрыть от части
                            участников можно было только каждый канал по отдельности. */}
                        {canManage && (
                          <button
                            onClick={() => setEditingChannel(cat)}
                            className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 p-0.5"
                            aria-label={`Настройки группы ${cat.name}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                        )}

                        {canManage && !isCollapsed && (
                          <button onClick={() => onCreateChannel({ parentId: cat.id, groupType: "VOICE", defaultType: "VOICE" })} className="text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100" aria-label="Создать голосовой канал в группе">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        )}
						{canManage && (
						<button
							onClick={() => onDeleteChannel(cat.id)}
							className="text-neutral-400 hover:text-red-500 transition-colors opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 p-0.5"
							aria-label={`Удалить группу ${cat.name}`}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
							</svg>
						</button>
					)}
                      </div>
                      {!isCollapsed && children.map((ch) => {
                        const isActive = currentVoiceChannelId === ch.id;
                        const previewUsers = channelUsersMap[ch.id] ?? [];
                        // FIX-FORCELOCK-V2: voiceState.users не обновляется от voice-channel-users.
                        // Мержим isForceMuted/isForceDeafened из sidebar-снапшота (channelUsersMap).
                        const _snap1 = channelUsersMap[ch.id] ?? [];
                        const connectedUsers = isActive && voiceState
                          ? voiceState.users.map(u => {
                              const s = _snap1.find(x => x.socketId === u.socketId);
                              return s ? { ...u, isForceMuted: s.isForceMuted, isForceDeafened: s.isForceDeafened } : u;
                            })
                          : [];
                        const displayUsers = isActive ? connectedUsers : previewUsers;
                        const shareCount = isActive && voiceState ? voiceState.screenSharerIds.size : 0;

                        return (
                          <div key={ch.id} className={`ml-4 pl-1${drag.itemClass(ch.id)}${dragUser.dragging ? " ring-2 ring-violet-400/30 dark:ring-cyan-400/30 rounded-lg" : ""}${dragUser.channelDropClass(ch.id)}`} {...drag.itemProps(ch.id, children.map(c => c.id))} {...dragUser.channelDropProps(ch.id)}>
                            <div className="group flex items-center">
                              <button
                                onClick={() => {
                                  /* Первый кл��к — подключиться и остаться там,
                                     где были: человек заходит в канал, чтобы
                                     говорить, и не всегда хочет уходить из
                                     переписки. */
                                  if (!isActive) { voiceActions?.joinVoice(ch.id, ch.name); return; }
                                  /* Идёт показ экрана — левый щелчок ВОЗВРАЩАЕТ к
                                     нему, а не открывает комнату. Раньше здесь
                                     открывалась комната, и она оказывалась ПОЗАДИ
                                     трансляции: два окна одной и той же комнаты
                                     наложились друг на друга. */
                                  if (shareCount > 0) { onVoiceFocus?.(); return; }
                                  onVoiceExpand?.();
                                }}
                                /* ПКМ: во время показа — комната (её левым
                                   щелчком уже не открыть), иначе настройки
                                   канала. Настройки при этом всегда доступны
                                   шестерёнкой при наведении. */
                                onContextMenu={(e) => {
                                  if (isActive && shareCount > 0) { e.preventDefault(); onVoiceExpand?.(); return; }
                                  if (canManage) { e.preventDefault(); setEditingChannel(ch); }
                                }}
                                className={`cn-channel-btn flex-1 text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-all text-sm ${isActive ? "active" : ""}`}
                              >
                                <span className="text-base flex items-center" title={ch.isRestricted ? "Приватный голосовой канал — доступ по ролям" : undefined}>{ch.isRestricted ? <PrivateVoiceIcon size={18} tone="inactive" /> : ch.icon ? ch.icon : <VoiceChannelIcon size={18} tone="inactive" />}</span>
                                <span className="truncate flex-1">{ch.name}</span>
                                {shareCount > 0 && <span className="h-6 px-1.5 rounded-md bg-blue-500/15 text-blue-500 dark:text-cyan-300 inline-flex items-center gap-1" title={`${shareCount} активных трансляций`}><ScreenShareIcon />{shareCount > 1 && <span className="text-[10px] font-semibold">{shareCount}</span>}</span>}
                                {displayUsers.length > 0 && ( /* FIX-VPRESENCE: счётчик виден всегда */
                                  <span className="text-[10px] font-semibold text-neutral-500 dark:text-gray-300 bg-neutral-200/70 dark:bg-white/10 rounded-full px-1.5 min-w-[18px] text-center">{displayUsers.length}</span>
                                )}
                              </button>
                              {/* FIX-VCH: настройки голосового канала — доступ по ролям, как у текстовых */}
                              {canManage && (
                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                                  <button
                                    onClick={() => setEditingChannel(ch)}
                                    className="p-1 text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors"
                                    aria-label={`Настройки канала ${ch.name}`}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => onDeleteChannel(ch.id)}
                                    className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                                    aria-label={`Удалить ${ch.name}`}
                                    title="Удалить канал"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </div>
                            {/* FIX-VAVATAR2: вертикальный список как в одиночных каналах */}
                            {displayUsers.length > 0 && (
                              <div className="ml-4 pl-2 border-l-2 border-neutral-200 dark:border-white/10 space-y-0.5 mb-1">
                                {isActive && voiceState && (
                                  <VoiceUserRow
                                    name={myProfileUser.name ?? "Вы"}
                                    avatar={myProfileUser.avatar}
                                    muted={voiceState.isMuted}
                                    speaking={voiceState.localSpeaking && !voiceState.isMuted}
                                    sharingScreen={voiceState.isSharingScreen}
                                    isLocal
                                  />
                                )}
                                {displayUsers
                                  .filter(u => !(isActive && u.userId === myProfileUser.id))
                                  .map(u => (
                                    <div
                                      key={u.socketId}
                                      {...dragUser.userRowProps(u.socketId, u.userId)}
                                      className={`group/user relative ${dragUser.userRowClass(u.socketId)}`}
                                      onContextMenu={isActive && voiceActions ? async (e) => {
                                        e.preventDefault(); e.stopPropagation();
                                        setSidebarModMenu({ socketId: u.socketId, userId: u.userId, userName: u.userName, x: e.clientX, y: e.clientY + 4, channelId: ch.id, modChecked: false, canKickVoice: false, canForceMute: false, canForceDeafen: false, canMove: false, canBan: false, groupId: groupDetail.id, voiceChannels: voiceChannels.map(vc => ({ id: vc.id, name: vc.name })), targetIsForceMuted: !!u.isForceMuted, targetIsForceDeafened: !!u.isForceDeafened });
                                        try {
                                          const r = await fetch(`/api/voice/moderation-info?channelId=${ch.id}&targetUserId=${u.userId}`);
                                          if (r.ok) { const d = await r.json(); setSidebarModMenu(prev => prev && prev.socketId === u.socketId ? { ...prev, modChecked: true, ...d } : prev); }
                                          else { setSidebarModMenu(null); }
                                        } catch { setSidebarModMenu(null); }
                                      } : undefined}
                                    >
                                      <VoiceUserRow
                                        name={u.userName}
                                        avatar={u.avatar}
                                        muted={u.muted}
                                        speaking={isActive ? voiceState?.speakingUsers.has(u.socketId) ?? false : false}
                                        quality={isActive ? voiceState?.connectionQuality.get(u.socketId) : undefined}
                                        sharingScreen={isActive ? voiceState?.screenSharerIds.has(u.socketId) ?? false : false}
                                        isForceMuted={!!u.isForceMuted}
                                        isForceDeafened={!!u.isForceDeafened}
                                      />
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {voiceChannels.filter((c) => !c.parentId).map((ch) => {
              const isActive = currentVoiceChannelId === ch.id;
              const previewUsers = channelUsersMap[ch.id] ?? [];
              // FIX-FORCELOCK-V2: мержим isForceMuted/isForceDeafened из sidebar-снапшота
              const _snap2 = channelUsersMap[ch.id] ?? [];
              const connectedUsers = isActive && voiceState
                ? voiceState.users.map(u => {
                    const s = _snap2.find(x => x.socketId === u.socketId);
                    return s ? { ...u, isForceMuted: s.isForceMuted, isForceDeafened: s.isForceDeafened } : u;
                  })
                : [];
              const displayUsers = isActive ? connectedUsers : previewUsers;
              const shareCount = isActive && voiceState ? voiceState.screenSharerIds.size : 0;

              return (
                <div key={ch.id} className={`${drag.itemClass(ch.id)}${dragUser.dragging ? " ring-2 ring-violet-400/30 dark:ring-cyan-400/30 rounded-lg" : ""}${dragUser.channelDropClass(ch.id)}`} {...drag.itemProps(ch.id, voiceChannels.filter((c) => !c.parentId).map((c) => c.id))} {...dragUser.channelDropProps(ch.id)}>
                  {/* Channel button */}
                  <div className="group flex items-center">
                    <button
                      onClick={() => {
                        /* То же самое для канала вне категории. */
                        if (!isActive) { voiceActions?.joinVoice(ch.id, ch.name); return; }
                        if (shareCount > 0) { onVoiceFocus?.(); return; }
                        onVoiceExpand?.();
                      }}
                      onContextMenu={(e) => {
                        if (isActive && shareCount > 0) { e.preventDefault(); onVoiceExpand?.(); return; }
                        if (canManage) { e.preventDefault(); setEditingChannel(ch); }
                      }}
                      className={`cn-channel-btn flex-1 text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-all text-sm ${
                        isActive ? "active" : ""
                      }`}
                    >
                      <span className="text-base flex items-center" title={ch.isRestricted ? "Приватный голосовой канал — доступ по ролям" : undefined}>{ch.isRestricted ? <PrivateVoiceIcon size={18} tone="inactive" /> : ch.icon ? ch.icon : <VoiceChannelIcon size={18} tone="inactive" />}</span>
                      <span className="truncate flex-1">{ch.name}</span>
                      {shareCount > 0 && <span className="h-6 px-1.5 rounded-md bg-blue-500/15 text-blue-500 dark:text-cyan-300 inline-flex items-center gap-1" title={`${shareCount} активных трансляций`}><ScreenShareIcon />{shareCount > 1 && <span className="text-[10px] font-semibold">{shareCount}</span>}</span>}
                      {displayUsers.length > 0 && ( /* FIX-VPRESENCE: счётчик виден всегда */
                        <span className="text-[10px] font-semibold text-neutral-500 dark:text-gray-300 bg-neutral-200/70 dark:bg-white/10 rounded-full px-1.5 min-w-[18px] text-center">{displayUsers.length}</span>
                      )}
                    </button>
                    {/* FIX-VCH: настройки голосового канала — доступ по ролям, как у текстовых */}
                    {canManage && (
                      <button
                        onClick={() => setEditingChannel(ch)}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-all"
                        aria-label={`Настройки канала ${ch.name}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    )}
                    {canManage && (
                      <button
                        onClick={() => onDeleteChannel(ch.id)}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-neutral-400 hover:text-red-500 transition-all"
                        aria-label={`Delete ${ch.name}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Detailed connection stages */}

                  {/* Users in voice channel (Discord style: vertical list under channel) */}
                  {displayUsers.length > 0 && (
                    <div className="ml-5 pl-2.5 border-l-2 border-neutral-200 dark:border-white/10 space-y-0.5 mb-1">
                      {/* Local user shown first if connected */}
                      {isActive && voiceState && (
                        <VoiceUserRow
                          name={userName}
                          avatar={myProfileUser.avatar} /* FIX-VAVATAR */
                          muted={voiceState.isMuted}
                          speaking={voiceState.localSpeaking && !voiceState.isMuted}
                          sharingScreen={voiceState.isSharingScreen}
                          isLocal
                        />
                      )}
                      {displayUsers
                        .filter(u => !(isActive && u.userId === myProfileUser.id))
                        .map(u => (
                        <div
                          key={u.socketId}
                          {...dragUser.userRowProps(u.socketId, u.userId)}
                          className={`group/user relative ${dragUser.userRowClass(u.socketId)}`}
                          onContextMenu={isActive && voiceActions ? async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSidebarModMenu({ socketId: u.socketId, userId: u.userId, userName: u.userName, x: e.clientX, y: e.clientY + 4, channelId: ch.id, modChecked: false, canKickVoice: false, canForceMute: false, canForceDeafen: false, canMove: false, canBan: false, groupId: groupDetail.id, voiceChannels: voiceChannels.map(vc => ({ id: vc.id, name: vc.name })), targetIsForceMuted: !!u.isForceMuted, targetIsForceDeafened: !!u.isForceDeafened });
                            try {
                              const r = await fetch(`/api/voice/moderation-info?channelId=${ch.id}&targetUserId=${u.userId}`);
                              if (r.ok) { const d = await r.json(); setSidebarModMenu(prev => prev && prev.socketId === u.socketId ? { ...prev, modChecked: true, ...d } : prev); }
                              else { setSidebarModMenu(null); }
                            } catch { setSidebarModMenu(null); }
                          } : undefined}
                        >
                          <VoiceUserRow
                            name={u.userName}
                            avatar={u.avatar}
                            muted={u.muted}
                            speaking={isActive ? voiceState?.speakingUsers.has(u.socketId) ?? false : false}
                            quality={isActive ? voiceState?.connectionQuality.get(u.socketId) : undefined}
                            sharingScreen={isActive ? voiceState?.screenSharerIds.has(u.socketId) ?? false : false}
                            isForceMuted={!!u.isForceMuted}
                            isForceDeafened={!!u.isForceDeafened}
                          />
                          {/* Per-user volume control (only when connected) */}
                          {isActive && voiceActions && (
                            <button
                              onClick={() => setVolumeOpen(volumeOpen === u.socketId ? null : u.socketId)}
                              className="absolute right-0 top-0.5 opacity-0 group-hover/user:opacity-100 focus-visible:opacity-100 p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-white transition-all"
                              title="Громкость"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0 0l-4-4m4 4l4-4" />
                              </svg>
                            </button>
                          )}
                          {/* Volume slider popup — drops *below* the row and
                              spans the row width so it never spills past the
                              panel's right edge (which would trigger a horizontal
                              scrollbar or get clipped by overflow-x-hidden). */}
                          {volumeOpen === u.socketId && voiceActions && voiceState && (
                            <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-lg shadow-lg p-2">
                              <div className="text-[10px] text-neutral-400 mb-1 truncate">{u.userName}</div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={0}
                                  max={200}
                                  value={voiceState.userVolumes.get(u.socketId) ?? 100}
                                  onChange={(e) => voiceActions.setUserVolume(u.socketId, Number(e.target.value))}
                                  className="flex-1 h-1 accent-violet-500 dark:accent-cyan-400"
                                />
                                <span className={`text-[10px] w-7 text-right ${(voiceState.userVolumes.get(u.socketId) ?? 100) > 100 ? "text-amber-500" : "text-neutral-500"}`}>
                                  {voiceState.userVolumes.get(u.socketId) ?? 100}%
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
              </>
            )}
          </>
        )}

        {/* ── Block mode (mobile): section blocks below voice ── */}
        {blockMode && (
          <div className="md:hidden mt-4 pt-3" style={{ borderTop: "1px solid var(--cn-border)" }}>
            <SectionsPanel
              variant="mobile"
              channels={groupDetail.channels}
              generalChannelId={generalChannelId ?? null}
              selectedChannel={selectedChannel}
              unreadCounts={unreadCounts}
              canManage={canManage}
              ownerHasPremium={groupDetail.ownerHasPremium ?? true}
              isGroupOwner={groupDetail.myRole === "OWNER"}
              groupId={groupDetail.id}
              members={groupDetail.members}
              membersTotal={groupDetail.membersTotal}
              canSeeMembers={!(isMainCommunity && !canManage && userRole !== "ADMIN")}
              onSelectChannel={onChannelClick}
              onRefresh={() => onGroupRefresh?.()}
            />
          </div>
        )}

        {/* ── Обычная группа (mobile): модули «Разделы» под каналами ──
            На десктопе модульные каналы (Новости, Вопросы-ответы, База знаний,
            Календарь, Документы, Задачи) показывает отдельная колонка ModulesPanel.
            На мобильном той колонки нет, поэтому раньше эти разделы были
            недоступны совсем — рендерим их здесь встроенным блоком.
            APPEALS исключён: «Обращения» уже показываются в общем списке каналов. */}
        {/* FIX-PANELVIEW3: раньше блок рисовался только при наличии модулей. Теперь
            его заголовок — ещё и вход в участников, поэтому ��н нужен и без модулей;
            прячем только когда нет ни модулей, ни права смотреть участников. */}
        {!blockMode &&
          (textChannels.some((c) => isModuleType(c.type) && !(c as Channel & { hidden?: boolean }).hidden) ||
            !(isMainCommunity && !canManage && userRole !== "ADMIN")) && (
          <div className="md:hidden mt-4 pt-3" style={{ borderTop: "1px solid var(--cn-border)" }}>
            <ModulesPanel
              variant="mobile"
              channels={textChannels.filter((c) => c.type !== "APPEALS")}
              selectedChannel={selectedChannel}
              groupId={groupDetail.id}
              members={groupDetail.members}
              membersTotal={groupDetail.membersTotal}
              canSeeMembers={!(isMainCommunity && !canManage && userRole !== "ADMIN")}
              canManage={canManage} /* FIX-MODDRAG */
              ownerHasPremium={groupDetail.ownerHasPremium ?? true}
              isGroupOwner={groupDetail.myRole === "OWNER"}
              onRefresh={() => onGroupRefresh?.()}
              onSelect={(ch) => onChannelClick(ch as unknown as Channel)}
            />
          </div>
        )}
      </nav>

      {/* ── Bottom actions ── */}
      <div className="p-2 border-t border-neutral-200 dark:border-white/5 space-y-1">
        {/* FIX-COOP: «Сотрудничество» — над кнопкой «Пригласить», в стиле панели */}
        {showCooperation && <CooperationButton />}
        {canManage && (
          <button onClick={onInvite} className="w-full px-3 py-1.5 text-left text-sm text-accent hover:bg-violet-50 dark:hover:bg-cyan-400/10 rounded-lg transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Пригласить
          </button>
        )}
        {/* FIX-PANELVIEW3: кнопка «Участники» убрана. Участники теперь живут в
            правой панели — там же, где разделы, по кругу одной кнопкой. Два входа
            в один список приводили к двум открытым панелям сразу. */}
      </div>

      {/* ── Voice controls bar (when connected) ── */}
      {isInVoice && voiceState && voiceActions && (
        <div className="border-t border-neutral-200 dark:border-white/5 bg-neutral-50 dark:bg-white/[0.02]">
          {(() => {
            // Bottom voice bar: staged connection status while joining, then
            // the green room name with the user's ping once fully connected.
            const stage = voiceState.connectionStage ?? "connected";
            const STAGE_LABELS: Record<string, string> = {
              microphone: "Микрофон…",
              "optimizing-audio": "Настройка звука…",
              server: "Подключение к серверу…",
              channel: "Вход в канал…",
              media: "Установка медиасвязи…",
              reconnecting: "Переподключение…",
              disconnecting: "Отключение…",
            };
            const failed = stage === "error";
            const connecting = !failed && stage in STAGE_LABELS;
            const ping = voiceState.localPing;
            const pingTone = ping == null
              ? "text-neutral-400"
              : ping < 80 ? "text-green-500 dark:text-green-400"
              : ping < 180 ? "text-amber-500 dark:text-amber-400"
              : "text-red-500 dark:text-red-400";
            return (
              <div className="px-3 py-1.5 flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${failed ? "bg-red-400" : connecting ? "bg-amber-400 animate-pulse" : "bg-green-400 animate-pulse"}`} />
                <span className={`text-[11px] font-medium truncate flex-1 ${failed ? "text-red-500" : connecting ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                  {failed ? `${voiceState.channelName} · Ошибка подключения` : connecting ? `${voiceState.channelName} · ${STAGE_LABELS[stage]}` : voiceState.channelName}
                </span>
                {!connecting && !failed && (
                  <span className={`text-[10px] font-semibold tabular-nums whitespace-nowrap ${pingTone}`} title={`Подключено к «${voiceState.channelName}»${ping != null ? ` · пинг ${ping} мс` : ""}`}>
                    Подключено{ping != null ? ` · ${ping} мс` : ""}
                  </span>
                )}
                {connecting && ping != null && (
                  <span className={`text-[10px] tabular-nums ${pingTone}`}>{ping} мс</span>
                )}
                {voiceState.screenSharerIds.size > 0 && (
                  <span className="h-6 px-1.5 rounded-md bg-blue-500/15 text-blue-500 dark:text-cyan-300 inline-flex items-center gap-1">
                    <ScreenShareIcon />
                    <span className="text-[10px] font-semibold">{voiceState.screenSharerIds.size}</span>
                  </span>
                )}
              </div>
            );
          })()}
          <div className="flex items-center justify-center gap-2 px-3 pb-2">
            {/* Mute */}
            <VoiceControlBtn
              active={voiceState.isMuted}
              color="red"
              onClick={voiceActions.toggleMute}
              title={voiceState.isMuted ? "Вкл. микрофон" : "Выкл. микрофон"}
            >
              {voiceState.isMuted ? <MutedMicIcon /> : <MicIcon />}
            </VoiceControlBtn>
            {/* Deafen */}
            <VoiceControlBtn
              active={voiceState.isDeafened}
              color="red"
              onClick={voiceActions.toggleDeafen}
              title={voiceState.isDeafened ? "Вкл. звук" : "Выкл. звук"}
            >
              {voiceState.isDeafened ? <DeafenOnIcon /> : <DeafenOffIcon />}
            </VoiceControlBtn>
            {/* Noise suppressor */}
            <VoiceControlBtn
              active={voiceState.nsEnabled && voiceState.nsStatus !== "loading"}
              color="green"
              onClick={voiceActions.toggleNS}
              disabled={voiceState.nsStatus === "loading"}
              title={voiceState.nsEnabled ? "Выкл. шумодав" : "Вкл. шумодав"}
            >
              <NsIcon />
            </VoiceControlBtn>
            {/* Screen share — several participants may share at once, so this
                is never disabled just because someone else is already sharing. */}
            <VoiceControlBtn
              active={voiceState.isSharingScreen}
              color="green"
              /* SCREEN-PRIVATE: у startScreenShare появился необязательный
                 параметр (список зрителей приватного показа) — передавать
                 функцию в onClick напрямую больше нельзя, иначе туда попадёт
                 объект события. Запуск идёт через то же окно, что и в комнате:
                 качество, звук и кому видно спрашиваются один раз и в одном
                 месте, а не по-разному в зависимости от нажатой кнопки. */
              onClick={() => {
                if (voiceState.isSharingScreen) { void voiceActions.stopScreenShare(); return; }
                setShareLaunchOpen(true);
              }}
              title={voiceState.isSharingScreen ? "Стоп демонстрация" : "Демонстрация экрана"}
            >
              <ScreenShareIcon />
            </VoiceControlBtn>
            {/* Disconnect — same optical box as the other controls. */}
            <VoiceControlBtn active color="red" onClick={voiceActions.leaveVoice} title="Отключиться">
              <HangupIcon />
            </VoiceControlBtn>
          </div>
        </div>
      )}

      {shareLaunchOpen && (
        <ScreenSharePrivacyModal
          withQuality
          onClose={() => setShareLaunchOpen(false)}
          onStart={(allowUserIds, sourceId) => {
            setShareLaunchOpen(false);
            void voiceActions?.startScreenShare(allowUserIds, sourceId);
          }}
        />
      )}

      {editingChannel && (
        <ChannelSettingsModal
          channel={editingChannel}
          groupId={groupDetail.channels[0]?.groupId ?? ""}
          allChannels={groupDetail.channels}
          onClose={() => setEditingChannel(null)}
          onUpdated={() => { onGroupRefresh?.(); }}
        />
      )}

      {/* Reorder modal */}
      {/* FIX-A11Y: Модалка переупорядочивания — добавлены role="dialog", aria-modal,
          aria-labelledby, закрытие по Escape и aria-label для кнопок перемещения. */}
      {showReorder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowReorder(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowReorder(false); }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reorder-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-white/5">
              <h2 id="reorder-modal-title" className="text-base font-semibold text-neutral-900 dark:text-white">Порядок каналов</h2>
              <button
                onClick={() => setShowReorder(false)}
                className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-400 transition-colors"
                aria-label="Закрыть диалог изменения порядка каналов"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-3 max-h-[60vh] overflow-y-auto space-y-1">
              {reorderChannels.map((ch, idx) => (
                <div key={ch.id} className="flex items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-white/5 rounded-xl">
                  <span className="text-base flex items-center" title={ch.isRestricted ? "Приватный канал — доступ по ролям" : undefined}>{ch.isRestricted ? (ch.type === "VOICE" ? <PrivateVoiceIcon size={18} tone="inactive" /> : <PrivateChatIcon size={18} tone="inactive" />) : ch.type === "VOICE" ? <VoiceChannelIcon size={18} tone="inactive" /> : (ch.icon ? ch.icon : <ChatIcon size={18} tone="inactive" />)}</span>
                  <span className="text-sm text-neutral-900 dark:text-white truncate flex-1">{ch.name}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        if (idx === 0) return;
                        const arr = [...reorderChannels];
                        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                        setReorderChannels(arr);
                      }}
                      disabled={idx === 0}
                      className="p-1 text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 disabled:opacity-30 transition-colors"
                      aria-label={`Переместить канал «${ch.name}» вверх`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button
                      onClick={() => {
                        if (idx === reorderChannels.length - 1) return;
                        const arr = [...reorderChannels];
                        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                        setReorderChannels(arr);
                      }}
                      disabled={idx === reorderChannels.length - 1}
                      className="p-1 text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 disabled:opacity-30 transition-colors"
                      aria-label={`Переместить канал «${ch.name}» вниз`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-white/5">
              <button onClick={() => setShowReorder(false)} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">Отмена</button>
              <button
                onClick={async () => {
                  setReorderSaving(true);
                  await fetch("/api/channels/reorder", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ channelIds: reorderChannels.map(c => c.id), groupId }),
                  });
                  setReorderSaving(false);
                  setShowReorder(false);
                  onGroupRefresh?.();
                }}
                disabled={reorderSaving}
                className="px-4 py-2 bg-violet-500 dark:bg-cyan-600 text-white text-sm rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {reorderSaving ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ПКМ-меню модерации прямо в боковой панели */}
      {sidebarModMenu && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] min-w-[210px] py-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl text-sm"
          style={{ left: Math.min(sidebarModMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 230), top: sidebarModMenu.y }}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
          role="menu"
        >
          <div className="px-3 py-1.5 text-[11px] text-neutral-400 truncate border-b border-neutral-100 dark:border-white/5">
            {sidebarModMenu.userName}
          </div>
          {voiceState && voiceActions && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2">
                <svg className="w-3 h-3 flex-shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0 0l-4-4m4 4l4-4" /></svg>
                <input type="range" min={0} max={200}
                  value={voiceState.userVolumes.get(sidebarModMenu.socketId) ?? 100}
                  onChange={e => voiceActions.setUserVolume(sidebarModMenu.socketId, Number(e.target.value))}
                  className="flex-1 h-1 accent-violet-500 dark:accent-cyan-400" />
                <span className="text-[10px] w-7 text-right text-neutral-400">
                  {voiceState.userVolumes.get(sidebarModMenu.socketId) ?? 100}%
                </span>
              </div>
            </div>
          )}
          {!sidebarModMenu.modChecked && (
            <div className="flex items-center justify-center py-2 border-t border-neutral-100 dark:border-white/5">
              <svg className="animate-spin text-neutral-400" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/>
              </svg>
            </div>
          )}
          {sidebarModMenu.modChecked && (sidebarModMenu.canForceMute || sidebarModMenu.canForceDeafen || sidebarModMenu.canMove || sidebarModMenu.canKickVoice) && (
            <div className="border-t border-neutral-100 dark:border-white/5 mt-1 pt-1">
              {sidebarModMenu.canForceMute && !sidebarModMenu.targetIsForceMuted && (
                <button type="button" role="menuitem"
                  onClick={async () => { const m = sidebarModMenu; setSidebarModMenu(null); await fetch("/api/voice/force-mute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: m.userId, channelId: m.channelId, deafen: false }) }).catch(() => {}); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  Заглушить микрофон
                </button>
              )}
              {sidebarModMenu.canForceDeafen && !sidebarModMenu.targetIsForceDeafened && (
                <button type="button" role="menuitem"
                  onClick={async () => { const m = sidebarModMenu; setSidebarModMenu(null); await fetch("/api/voice/force-mute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: m.userId, channelId: m.channelId, deafen: true }) }).catch(() => {}); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                  Заглушить мик + наушники
                </button>
              )}
              {sidebarModMenu.canForceMute && sidebarModMenu.targetIsForceMuted && (
                <button type="button" role="menuitem"
                  onClick={async () => { const m = sidebarModMenu; setSidebarModMenu(null); await fetch("/api/voice/force-unmute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: m.userId, channelId: m.channelId, deafen: m.targetIsForceDeafened }) }).catch(() => {}); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4" /></svg>
                  Снять заглушение
                </button>
              )}
              {sidebarModMenu.canMove && sidebarModMenu.voiceChannels.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[11px] text-neutral-400 border-t border-neutral-100 dark:border-white/5 mt-1">Перенести в канал</div>
                  {sidebarModMenu.voiceChannels.filter(vc => vc.id !== sidebarModMenu.channelId).map(vc => (
                    <button key={vc.id} type="button" role="menuitem"
                      onClick={async () => { const m = sidebarModMenu; setSidebarModMenu(null); await fetch("/api/voice/move-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: m.userId, targetChannelId: vc.id, groupId: m.groupId }) }).catch(() => {}); }}
                      className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5 text-[12px]">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0l-7-7m7 7l-7 7" /></svg>
                      <span className="truncate">{vc.name}</span>
                    </button>
                  ))}
                </>
              )}
              {sidebarModMenu.canKickVoice && (
                <button type="button" role="menuitem"
                  onClick={async () => { const m = sidebarModMenu; setSidebarModMenu(null); await fetch("/api/voice/kick-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: m.userId, channelId: m.channelId }) }).catch(() => {}); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 text-red-500 hover:bg-red-500/10 border-t border-neutral-100 dark:border-white/5 mt-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                  Выгнать из канала
                </button>
              )}
            </div>
          )}
        </div>,
        document.body
      )}
    </aside>
  );
}
