"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Spinner from "@/components/ui/Spinner";
import ConnectWelcome from "@/components/connect/ConnectWelcome";
import { useSession } from "next-auth/react";
import { hasPremium } from "@/lib/premium";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useTheme } from "@/components/Providers";
import Link from "next/link";
import dynamic from "next/dynamic";

import type { GlowAvatarUser } from "@/components/ui/GlowAvatar";
import { useRouter } from "next/navigation";

import NavRail from "@/components/connect/NavRail";
import { NavSection } from "@/components/connect/NavRail";
import GroupListPanel from "@/components/connect/GroupListPanel";
import ChannelSidebar from "@/components/connect/ChannelSidebar";
import MessageArea from "@/components/connect/MessageArea";
import { applyChatAppearance, loadChatAppearance } from "@/lib/chatAppearance";
import QAPanel from "@/components/connect/QAPanel";
import AppealsPanel from "@/components/connect/AppealsPanel";
import WikiPanel from "@/components/connect/WikiPanel";
import TasksPanel from "@/components/connect/TasksPanel";
import CalendarPanel from "@/components/connect/CalendarPanel";
import CommunityPanel from "@/components/connect/CommunityPanel"; // FIX-COMMUNITY
import GroupWorkspacePanel from "@/components/connect/GroupWorkspacePanel";
import DocsPanel from "@/components/connect/DocsPanel";
import SectionsPanel from "@/components/connect/SectionsPanel";
import ModulesPanel from "@/components/connect/ModulesPanel";
import PollsPanel from "@/components/connect/PollsPanel";
import MobileGroupList from "@/components/connect/MobileGroupList";
import ConnectSplash from "@/components/connect/ConnectSplash";
import PanelResizer from "@/components/connect/PanelResizer";
import AccountSuspendedOverlay from "@/components/connect/AccountSuspendedOverlay";
import AppealComposer from "@/components/connect/AppealComposer";
// ThemeProvider is now in global Providers

const ScreenShareWindow = dynamic(() => import("@/components/voice/ScreenShareWindow"), { ssr: false });
const VoiceExpandedPanel = dynamic(() => import("@/components/voice/VoiceExpandedPanel"), { ssr: false });
const FriendsPanel = dynamic(() => import("@/components/friends/FriendsPanel"), { ssr: false });
const DMPanel = dynamic(() => import("@/components/dm/DMPanel"), { ssr: false });
const AiChatPanel = dynamic(() => import("@/components/ai/AiChatPanel"), { ssr: false });
import { useVoice } from "@/contexts/VoiceContext";


import { CreateGroupModal, JoinGroupModal, CreateChannelModal, InviteModal, GroupRulesGate, GroupInfoPanel, GroupSettingsModal } from "@/components/connect/GroupDialogs";
import type { Group, Channel, GroupDetail } from "@/components/connect/groupTypes";
import { getDesktopApi } from "@/lib/desktop";
// FIX-ICONS: фирменные SVG-иконки вместо эмодзи (👑 ⚙️ 👥)
import { UsersIcon } from "@/components/ui/ConnectIcons";
import GroupPausedSkeleton from "@/components/connect/GroupPausedSkeleton";
import GlobalSearchModal from "@/components/connect/GlobalSearchModal";

// REFACTOR-A (Вариант А): логика вынесена в components/connect/hooks/*, крупные
// оверлеи — в components/connect/overlays/*. Код перенесён дословно, поведение не менялось.
import { useConnectionProbe } from "@/components/connect/hooks/useConnectionProbe";
import { useDesktopViewport } from "@/components/connect/hooks/useDesktopViewport";
import { useChannelColumnWidth, CHANNEL_COL_MIN, CHANNEL_COL_MAX } from "@/components/connect/hooks/useChannelColumnWidth";
import { useDeviceIdentity } from "@/components/connect/hooks/useDeviceIdentity";
import { useHadSession } from "@/components/connect/hooks/useHadSession";
import { useUnreadBadges } from "@/components/connect/hooks/useUnreadBadges";
import { useMobileHistoryStack, useHistoryLayer } from "@/components/connect/hooks/useMobileHistoryStack";
import { requestNotifyPermission } from "@/lib/appNotify"; // ANDROID-NOTIFY
import ConnectionLostShield from "@/components/connect/overlays/ConnectionLostShield";
import PremiumInfoModal from "@/components/connect/overlays/PremiumInfoModal";
import PageConfirmModal from "@/components/connect/overlays/PageConfirmModal";

/* ─── Mobile view state ─── */
/* MOBILE-DRAWER: экранов в стеке два — список сообществ и чат группы.
   Каналы и разделы живут в выдвижной панели слева (слой, не экран). */
type MobileView = "groups" | "chat";

/* ─── Main Page ─── */

export default function ConnectPage() {
  return <ConnectPageInner />;
}

function ConnectPageInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  // Monochrome (ночь) и Monochrome Lite (день) — одно премиум-семейство: обе
  // отключают декоративные анимации и требуют premium.
  const isMono = theme === "mono" || theme === "mono-lite";

  /* Внешний вид чата (размеры имени и текста) правится в «Настройки →
     TZ.Connect → Кастомизация чата» и хранится на устройстве. Применяем при
     входе в мессенджер: CSS-переменные ставятся на корень документа, поэтому
     лента ничего не перерисовывает. */
  useEffect(() => { applyChatAppearance(loadChatAppearance()); }, []);

  // The Monochrome design is a premium perk. If the account can't use it (e.g.
  // premium lapsed), fall back to the standard theme of the same brightness.
  useEffect(() => {
    if (theme !== "mono" && theme !== "mono-lite") return;
    const u = session?.user as { isPremium?: boolean; role?: string } | undefined;
    if (!u) return;
    const canMono = hasPremium(u);
    if (!canMono) setTheme(theme === "mono-lite" ? "light" : "dark");
  }, [theme, session, setTheme]);

  /* ── Splash screen — once per session ── */
  const [splashDone, setSplashDone] = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem("tz-connect-splash") === "1";
  });
  const handleSplashDone = () => {
    sessionStorage.setItem("tz-connect-splash", "1");
    setSplashDone(true);
  };

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupDetail | null>(null);
  // FIX-GRPSWITCH: true, пока грузятся данные выбранной группы — колонки
  // каналов/чата плавно пригасают вместо резкого «моргания» при переключении.
  const [groupSwitching, setGroupSwitching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const voice = useVoice();
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [createChannelOptions, setCreateChannelOptions] = useState<{ parentId?: string | null; createCategory?: boolean; groupType?: "TEXT" | "VOICE"; defaultType?: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<NavSection>("communities");
  const [dmFriendId, setDmFriendId] = useState<string | null>(null);
  /** CHAT: разговор, в который ведёт кнопка «Перейти в бизнес-чат» из /partner. */
  const [businessConvId, setBusinessConvId] = useState<string | null>(null);
  const [showPremiumInfo, setShowPremiumInfo] = useState(false);
  /** Видимость «Бизнеса»: ADMIN/EDITOR — всегда; клиент — с момента подачи заявки. */
  const [showBusiness, setShowBusiness] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [myGlowSettings, setMyGlowSettings] = useState<{ avatarGlowEnabled: boolean; avatarGlowColors: string | null; avatar: string | null } | null>(null);
  // REFACTOR-A: бейджи непрочитанных (FIX-N2/FIX-NTF2) — hooks/useUnreadBadges (перенос 1-в-1).
  const { unreadCounts, setUnreadCounts, mentionChannels, setMentionChannels, fetchUnread, groupUnread } = useUnreadBadges(selectedChannel);
  const [mobileView, setMobileView] = useState<MobileView>("groups");
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  /* На что смотрит колонка контента: на переписку или на голосовой канал с его
     показом экрана. Раньше окно демонстрации накрывало колонку и не зависело ни
     от чего: открыть текстовый канал во время показа было невозможно — чат
     оставался под трансляцией, и уйти из неё можно было только выйдя из голоса.
     Само окно умеет сворачиваться в плашку (проп onVoiceChannel), но значение
     ему никто не передавал, и механизм не работал. */
  const [voiceViewFocused, setVoiceViewFocused] = useState(true);
  /* Счётчик запросов «покажи трансляцию»: растёт на каждый левый щелчок по
     голосовому каналу. Окно показа по нему разворачивается заново — в том числе
     когда человек до этого скрыл плашку возврата и остался без пути назад. */
  const [shareFocusNonce, setShareFocusNonce] = useState(0);
  const focusScreenShare = useCallback(() => {
    setShowVoicePanel(false);
    setVoiceViewFocused(true);
    setShareFocusNonce((n) => n + 1);
  }, []);
  const [pageConfirm, setPageConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // REFACTOR-A: онлайн-проба соединения — hooks/useConnectionProbe (перенос 1-в-1).
  const { connectionLost, reconnectAttempt } = useConnectionProbe();

  // REFACTOR-A: FIX-B3 (активная ветка вёрстки) — hooks/useDesktopViewport (перенос 1-в-1).
  const isDesktopViewport = useDesktopViewport();

  /* MOBILE-UI: системная «назад» (жест/кнопка Android, стрелка браузера) ходит
     по стеку экранов мессенджера: чат → каналы → сообщества. Подъём по стеку
     всегда выполняется через history.back() (mobileBack) — хук отражает стек
     в истории. Слои (участники, голосовая панель) закрываются первыми. */
  const setMobileViewSynced = useCallback((v: MobileView) => {
    if (v === "groups") setSelectedGroup(null);
    setMobileView(v);
  }, []);
  useMobileHistoryStack(mobileView, setMobileViewSynced, isDesktopViewport === false);
  const mobileBack = useCallback(() => window.history.back(), []);
  useHistoryLayer(showVoicePanel && isDesktopViewport === false, () => setShowVoicePanel(false), "voice");

  /* MOBILE-DRAWER: выдвижная панель каналов группы. Чат всегда по центру,
     текстовые и голосовые каналы с «Разделами» — слева. Открытие: свайп
     вправо от левого края или кнопка в шапке; закрытие: свайп влево, тап по
     затемнению, выбор канала или системная «назад» (слой в истории). */
  const [showChannelsDrawer, setShowChannelsDrawer] = useState(false);
  useHistoryLayer(
    showChannelsDrawer && isDesktopViewport === false,
    () => setShowChannelsDrawer(false),
    "channels-drawer",
  );
  const groupTouchRef = useRef<{ x: number; y: number } | null>(null);
  const handleGroupTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    groupTouchRef.current = { x: t.clientX, y: t.clientY };
  }, []);
  const handleGroupTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = groupTouchRef.current;
      groupTouchRef.current = null;
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = Math.abs(e.changedTouches[0].clientY - start.y);
      if (dy > Math.abs(dx) * 0.7) return; // вертикальный скролл — не свайп
      if (!showChannelsDrawer && start.x < 32 && dx > 56) setShowChannelsDrawer(true);
      else if (showChannelsDrawer && dx < -56) setShowChannelsDrawer(false);
    },
    [showChannelsDrawer],
  );

  /* MOBILE-DRAWER: автовыбор канала при входе в группу — чат по центру сразу.
     Берём общий текстовый канал (без родителя), иначе первый текстовый; если
     текстовых нет вовсе — открываем панель каналов, чтобы выбрать вручную. */
  useEffect(() => {
    if (isDesktopViewport !== false || mobileView !== "chat") return;
    /* FIX-GRPSWITCH2: только когда данные относятся к выбранной группе —
       иначе на кадр подставится канал предыдущей. */
    if (activeSection !== "communities" || !groupDetail || groupDetail.id !== selectedGroup) return;
    if (selectedChannel && groupDetail.channels.some((c) => c.id === selectedChannel)) return;
    const first =
      groupDetail.channels.find((c) => c.type === "TEXT" && !c.parentId) ??
      groupDetail.channels.find((c) => c.type === "TEXT");
    if (first) {
      setSelectedChannel(first.id);
    } else {
      setShowChannelsDrawer(true);
    }
  }, [groupDetail, selectedGroup, selectedChannel, activeSection, isDesktopViewport, mobileView]);

  // REFACTOR-A: ширина колонки каналов — hooks/useChannelColumnWidth (перенос 1-в-1).
  const { channelColWidth, updateChannelColWidth } = useChannelColumnWidth();

  /* ── Deep-linking from notifications ── */
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [highlightDmMessageId, setHighlightDmMessageId] = useState<string | null>(null);
  // Holds the target we still need to open once the group's channels have loaded.
  const deepLinkRef = useRef<{ group?: string; channel?: string; message?: string; task?: string } | null>(null);

  const isBanned = session?.user?.banned && (!session.user.bannedUntil || new Date(session.user.bannedUntil) > new Date());

  // REFACTOR-A: блокировка по IP/устройству — hooks/useDeviceIdentity (перенос 1-в-1).
  const identityBlocked = useDeviceIdentity();
  // FIX-A1: админ группы имеет те же права управления, что и создатель (раньше ADMIN был пропущен).
  const canManage = groupDetail?.myRole === "OWNER" || groupDetail?.myRole === "ADMIN" || groupDetail?.myRole === "MODERATOR";
  // NEW: группа на паузе («скелетирование») — контент каналов скрыт от всех,
  // кроме владельца и администраторов (модераторы тоже видят скелетон).
  const groupPausedForMe = !!groupDetail?.paused && groupDetail?.myRole !== "OWNER" && groupDetail?.myRole !== "ADMIN";
  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "USER";
  const hideMembersForMain = !!groupDetail?.isMain && !canManage && userRole !== "ADMIN";

  const fetchGroups = useCallback(() => {
    fetch("/api/groups").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setGroups(data);
    });
  }, []);

  // FIX-GRPSWITCH2: какая группа сейчас реально отрисована (её данные применены).
  // Нужно, чтобы при переключении на ДРУГУЮ группу сбросить выбранный канал
  // ровно в момент подмены данных — одним рендером, без промежуточного «пустого
  // чата». Обычные refresh'и той же группы канал не трогают.
  const loadedGroupIdRef = useRef<string | null>(null);

  const fetchGroupDetail = useCallback(async (groupId: string) => {
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.ok) {
      const data: GroupDetail = await res.json();
      const prevLoaded = loadedGroupIdRef.current;
      loadedGroupIdRef.current = data.id;
      setGroupDetail(data);
      // FIX-WELCOMEFLASH: при РЕАЛЬНОЙ смене группы (или первом входе в неё)
      // сразу выбираем «канал приземления» в том же батче, что и подмену данных
      // группы. Иначе колонка чата успевала отрисовать один кадр «окна
      // приветствия» (GroupInfoPanel с правилами/пустое окно) — до того, как
      // эффект авто-выбора канала внутри GroupInfoPanel откроет первый текстовый
      // канал. Именно этот единственный кадр и мелькал при переходе
      // сервер→сервер / группа→группа на не-первом входе. React батчит
      // setGroupDetail + setSelectedChannel в один рендер, поэтому промежуточному
      // окну просто негде появиться. «Тихие» refresh'и той же группы
      // (prevLoaded === data.id: сокеты profile/group-updated, поллинг участников)
      // сюда не попадают и открытый канал не трогают.
      if (prevLoaded !== data.id) {
        // Дип-линк из уведомления сам откроет нужный канал — не опережаем его.
        const pendingDeepLink = !!deepLinkRef.current?.channel && deepLinkRef.current?.group === data.id;
        // Правила ещё не приняты → показываем гейт правил, канал не открываем.
        // Условие точно совпадает с веткой рендера GroupRulesGate ниже.
        const rulesGated = !!data.rules && !data.rulesAccepted && data.myRole === "MEMBER";
        const firstText = data.channels.find((c) => c.type === "TEXT");
        setSelectedChannel(!pendingDeepLink && !rulesGated && firstText ? firstText.id : null);
      }
    }
    // FIX-GRPSWITCH: данные новой группы применены (или запрос не удался) —
    // снимаем состояние переключения, возвращая колонкам полную непрозрачность.
    setGroupSwitching(false);
  }, []);

  /* Панель «Участники» получает людей из снимка группы, а снимок дальше не
     перезапрашивается — поэтому отметки присутствия в нём устаревают.

     Обновлять ради этого весь снимок (каналы, разделы, модули) дорого, и от
     этого здесь отказались. Но вместе с ним потеряли и живое присутствие: пока
     человек не выходил из группы и не заходил заново, список показывал состояние
     на момент открытия. Присутствие теперь обновляет сам список участников
     лёгким запросом — см. MembersList в GroupDialogs и
     api/groups/[id]/presence. Возвращать сюда обновление снимка не нужно. */

  // Re-fetch the visible workspace immediately after VPN/network recovery.
  // Socket.IO reconnects in parallel; these HTTP snapshots prevent stale or
  // empty panels while the long-lived sockets are renegotiating their route.
  useEffect(() => {
    const refreshAfterNetworkChange = () => {
      fetchGroups();
      fetchUnread();
      if (selectedGroup) void fetchGroupDetail(selectedGroup);
    };
    window.addEventListener("tz-network-restored", refreshAfterNetworkChange);
    return () => window.removeEventListener("tz-network-restored", refreshAfterNetworkChange);
  }, [fetchGroups, fetchGroupDetail, fetchUnread, selectedGroup]);



  // FIX-PERF: мемоизируем объект профиля — иначе новая ссылка на каждый рендер
  // сбрасывала memo дочерних компонентов (NavRail и др.), которым он передаётся.
  const myProfileUser: GlowAvatarUser = useMemo(() => ({
    id: (session?.user as { id?: string } | undefined)?.id ?? "",
    name: session?.user?.name ?? "",
    role: (session?.user as { role?: string } | undefined)?.role ?? "USER",
    avatar: myGlowSettings?.avatar ?? null,
    avatarGlowEnabled: myGlowSettings?.avatarGlowEnabled ?? false,
    avatarGlowColors: myGlowSettings?.avatarGlowColors ?? null,
  }), [session?.user, myGlowSettings]);

  useEffect(() => {
    if (session?.user) {
      fetchGroups();
      fetchUnread();
      /* ANDROID-NOTIFY: в оболочке запрашивает системное POST_NOTIFICATIONS
         (Android 13+), в браузере — обычное разрешение Web Notifications. */
      requestNotifyPermission();
      const interval = setInterval(() => {
        if (!document.hidden) fetchUnread();
      }, 15000);
      const onVisible = () => {
        if (!document.hidden) fetchUnread();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }
  }, [session, fetchGroups, fetchUnread]);

  useEffect(() => {
    if (session?.user) {
      fetch("/api/profile/me")
        .then((r) => r.json())
        .then((d) => setMyGlowSettings({ avatarGlowEnabled: d.avatarGlowEnabled ?? false, avatarGlowColors: d.avatarGlowColors ?? null, avatar: d.avatar ?? null }))
        .catch(() => {});
    }
  }, [session]);

  // Видимость раздела «Бизнес»: ADMIN и EDITOR видят всегда; остальные — только при наличии деловых чатов.
  useEffect(() => {
    if (!session?.user) return;
    const role = (session.user as { role?: string }).role ?? "USER";
    if (role === "ADMIN" || role === "EDITOR") {
      setShowBusiness(true);
      return;
    }
    /* Раздел нужен клиенту с момента ПОДАЧИ заявки: он отправил её и пойдёт
       искать разговор именно здесь. Чат теперь создаётся сразу при подаче
       (см. lib/businessChat), так что достаточно было бы одного запроса за
       чатами. Проверка по заявкам оставлена нарочно: у обращений, поданных до
       этой правки, чата нет, а раздел им нужен — и появится он у них при первом
       же ответе, когда чат досоздастся. */
    Promise.all([
      fetch("/api/dm?kind=business", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/appeals", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { appeals: [] }))
        .catch(() => ({ appeals: [] })),
    ]).then(([chats, own]) => {
      const hasChat = Array.isArray(chats) && chats.length > 0;
      const appeals = (own as { appeals?: { category?: string | null }[] }).appeals ?? [];
      /* Обжалование блокировки в деловой раздел не относится: у него нет чата и
         быть не может, а раздел с одной пустой строкой бесполезен. */
      const hasBusinessAppeal = appeals.some((appeal) => appeal.category === "COOPERATION");
      if (hasChat || hasBusinessAppeal) setShowBusiness(true);
    });
  }, [session]);

  // Mirror the currently-open group + its member ids into refs so the long-lived
  // Socket.IO handlers below can read the latest value without re-subscribing.
  const selectedGroupRef = useRef<string | null>(null);
  const groupMemberIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);
  // В снимке сообщества лежит первая страница участников, поэтому здесь id тех,
  // кто реально отрисован. Обновление профиля участника с дальних страниц снимок
  // не перезапрашивает — и это к лучшему: на большом сообществе иначе получался
  // бы поток лишних запросов из-за смены аватара у тех, кого не видно.
  useEffect(() => {
    groupMemberIdsRef.current = new Set((groupDetail?.members ?? []).map((m) => m.user.id));
  }, [groupDetail]);

  // Listen for profile updates (avatar/glow) via Socket.IO
  const profileSocketRef = useRef<import("socket.io-client").Socket | null>(null);
  useEffect(() => {
    if (!session?.user) return;
    const uid = (session.user as { id?: string }).id;
    if (!uid) return;
    import("socket.io-client").then(({ io: ioClient }) => {
      const sock = ioClient({ path: "/api/socketio", withCredentials: true });
      profileSocketRef.current = sock;
      sock.on("profile-updated", (data: { id: string; avatar?: string | null; avatarGlowEnabled?: boolean; avatarGlowColors?: string | null }) => {
        if (data.id === uid) {
          // Use `"avatar" in data` rather than `??` so clearing the avatar
          // (data.avatar === null) actually removes it instead of keeping the
          // stale one.
          setMyGlowSettings((prev) => ({
            avatar: "avatar" in data ? (data.avatar ?? null) : (prev?.avatar ?? null),
            avatarGlowEnabled: data.avatarGlowEnabled ?? prev?.avatarGlowEnabled ?? false,
            avatarGlowColors: data.avatarGlowColors ?? prev?.avatarGlowColors ?? null,
          }));
        }
        // If the updated user is a member of the group we're viewing, refresh
        // its detail so their new avatar shows in the member list too.
        const gid = selectedGroupRef.current;
        if (gid && groupMemberIdsRef.current.has(data.id)) fetchGroupDetail(gid);
      });
      sock.on("channel-deleted", (data: { channelId: string; groupId: string }) => {
        setSelectedChannel((prev) => prev === data.channelId ? null : prev);
        setSelectedGroup((prevGroup) => {
          if (prevGroup === data.groupId) {
            fetchGroupDetail(data.groupId);
          }
          return prevGroup;
        });
      });
      // A group was created, edited (name/icon) or its membership changed —
      // refresh the sidebar list, and the open group's detail if it's the one.
      sock.on("group-updated", (data: { id: string }) => {
        fetchGroups();
        if (selectedGroupRef.current === data.id) fetchGroupDetail(data.id);
      });
      sock.on("group-session-revoked", (data: { groupId: string; channelIds?: string[] }) => {
        const channelIds = new Set(data.channelIds ?? []);
        if (voiceRef.current.channelId && channelIds.has(voiceRef.current.channelId)) {
          voiceRef.current.leaveVoice();
        }
        setGroups((prev) => prev.filter((group) => group.id !== data.groupId));
        if (selectedGroupRef.current === data.groupId) {
          selectedGroupRef.current = null;
          setSelectedGroup(null);
          setSelectedChannel(null);
          setGroupDetail(null);
          setMobileView("groups");
        }
        fetchGroups();
      });
      // A group was deleted — drop it from the list and clear the view if open.
      sock.on("group-deleted", (data: { id: string }) => {
        fetchGroups();
        setSelectedGroup((prev) => {
          if (prev === data.id) {
            setGroupDetail(null);
            setSelectedChannel(null);
            return null;
          }
          return prev;
        });
      });
      // Канал прочитан (на этом или другом устройстве) — мгновенно гасим бейджи.
      sock.on("channel-read", (payload: { channelId: string }) => {
        setUnreadCounts((prev) => {
          const next = { ...prev };
          delete next[payload.channelId];
          return next;
        });
        setMentionChannels((prev) => {
          const next = { ...prev };
          delete next[payload.channelId];
          return next;
        });
      });

    });
    return () => {
      profileSocketRef.current?.disconnect();
      profileSocketRef.current = null;
    };
  }, [session, fetchGroupDetail, fetchGroups]);

  useEffect(() => {
    if (selectedGroup) {
      // FIX-GRPSWITCH2: канал НЕ сбрасываем здесь. Иначе, пока грузятся данные
      // новой группы, колонка чата успевает перерисоваться в «пустой» экран
      // (инфо-панель/приветствие) — то самое мелькающее окно. Сброс канала
      // теперь происходит атомарно в fetchGroupDetail, когда приходят данные
      // уже другой группы: старый чат гаснет и сразу сменяется новым.
      fetchGroupDetail(selectedGroup);
    }
  }, [selectedGroup, fetchGroupDetail]);

  // Parse a notification deep link (?group=&channel=&message=&task= or ?section=dm&dm=&message=)
  // on first mount, then clean the URL so re-renders don't re-trigger it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const group = params.get("group");
    const channel = params.get("channel");
    const message = params.get("message");
    const task = params.get("task");
    const section = params.get("section");
    const dm = params.get("dm");
    /* CHAT: ?section=business&conv=… — переход из карточки проекта в кабинете.
       Разговор адресуется по id, а не по собеседнику: у делового чата вторая
       сторона у всех заявок одна и та же — «Администрация». */
    const conv = params.get("conv");
    if (!group && !channel && !message && !task && !section && !dm && !conv) return;

    if (section === "business") {
      setActiveSection("business");
      if (conv) setBusinessConvId(conv);
    } else if (section === "dm" && dm) {
      setActiveSection("dm");
      setDmFriendId(dm);
      if (message) setHighlightDmMessageId(message);
    } else if (group) {
      setActiveSection("communities");
      setSelectedGroup(group);
      deepLinkRef.current = {
        group,
        channel: channel ?? undefined,
        message: message ?? undefined,
        task: task ?? undefined,
      };
    }
    window.history.replaceState(null, "", "/connect");
  }, []);

  // FIX-NAV1: мягкая навигация из десктоп-оболочки (клик по уведомлению или по
  // нижней плашке статус-бара) БЕЗ перезагрузки страницы — иначе размонтируется
  // корневой VoiceProvider и рвётся активный голосовой канал. Оболочка присылает
  // DOM-событие с query-строкой; применяем те же параметры, что и при первом
  // монтировании, переключая раздел на месте.
  useEffect(() => {
    const onDesktopNavigate = (e: Event) => {
      const search = (e as CustomEvent<string>).detail ?? "";
      const params = new URLSearchParams(search);
      const group = params.get("group");
      const channel = params.get("channel");
      const message = params.get("message");
      const task = params.get("task");
      const section = params.get("section");
      const dm = params.get("dm");
      if (section === "business") {
        /* CHAT: та же ссылка, что и при первом монтировании, — оболочка
           присылает её без перезагрузки страницы. */
        setActiveSection("business");
        const conv = params.get("conv");
        if (conv) setBusinessConvId(conv);
      } else if (section === "dm" && dm) {
        setActiveSection("dm");
        setDmFriendId(dm);
        if (message) setHighlightDmMessageId(message);
      } else if (section === "friends") {
        setActiveSection("friends");
      } else if (group) {
        setActiveSection("communities");
        setSelectedGroup(group);
        deepLinkRef.current = {
          group,
          channel: channel ?? undefined,
          message: message ?? undefined,
          task: task ?? undefined,
        };
      } else if (section === "communities") {
        setActiveSection("communities");
      }
    };
    window.addEventListener("tz-desktop-navigate", onDesktopNavigate);
    return () => window.removeEventListener("tz-desktop-navigate", onDesktopNavigate);
  }, []);

  // Once the target group's channels are loaded, open the requested channel and
  // arm the message/task highlight so the child panel can scroll to it.
  useEffect(() => {
    const dl = deepLinkRef.current;
    if (!dl || !groupDetail || (dl.group && groupDetail.id !== dl.group)) return;
    if (dl.channel && groupDetail.channels.some((c) => c.id === dl.channel)) {
      setSelectedChannel(dl.channel);
      setMobileView("chat");
      if (dl.message) setHighlightMessageId(dl.message);
      if (dl.task) setHighlightTaskId(dl.task);
    }
    deepLinkRef.current = null;
  }, [groupDetail]);

  const handleSelectGroup = (id: string) => {
    // FIX-GRPSWITCH: вместо резкого «моргания» (старые каналы → пустой чат →
    // новые данные) колонки плавно пригасают на время загрузки новой группы и
    // проявляются, когда её данные применены (см. fetchGroupDetail).
    if (id !== selectedGroup) {
      setGroupSwitching(true);
      /* FIX-GRPSWITCH2: id канала прошлой группы больше не должен участвовать
         в рендере — иначе он на кадр «подставится» в новую группу. */
      setSelectedChannel(null);
    }
    setSelectedGroup(id);
    setActiveSection("communities");
    /* MOBILE-DRAWER: тап по группе открывает сразу чат; канал подберёт
       эффект автовыбора ниже (общий текстовый канал группы). */
    setMobileView("chat");
  };

  const handleMessageFriend = (friendId: string) => {
    setDmFriendId(friendId);
    setActiveSection("dm");
  };

  const voiceState = {
    isConnected: voice.isConnected,
    voiceStatus: voice.voiceStatus,
    connectionStage: voice.connectionStage,
    channelId: voice.channelId,
    channelName: voice.channelName,
    isMuted: voice.isMuted,
    isDeafened: voice.isDeafened,
    users: voice.users,
    speakingUsers: voice.speakingUsers,
    localSpeaking: voice.localSpeaking,
    nsEnabled: voice.nsEnabled,
    nsStatus: voice.nsStatus,
    isSharingScreen: voice.isSharingScreen,
    screenSharerId: voice.screenSharerId,
    screenSharerIds: voice.screenSharerIds,
    userVolumes: voice.userVolumes,
    connectionQuality: voice.connectionQuality,
    localPing: voice.localPing,
  };

  const voiceActions = {
    joinVoice: voice.joinVoice,
    leaveVoice: voice.leaveVoice,
    toggleMute: voice.toggleMute,
    toggleDeafen: voice.toggleDeafen,
    toggleNS: voice.toggleNS,
    startScreenShare: voice.startScreenShare,
    stopScreenShare: voice.stopScreenShare,
    setUserVolume: voice.setUserVolume,
  };

  /* Начался показ экрана — колонка контента показывает его. Без этого первый
     показ открылся бы плашкой, если до него человек читал переписку. */
  const anyScreenShare = voice.screenShares.length > 0;
  useEffect(() => {
    if (anyScreenShare) setVoiceViewFocused(true);
  }, [anyScreenShare]);

  const handleChannelClick = (channel: Channel) => {
    if (channel.type === "VOICE") {
      voice.joinVoice(channel.id, channel.name);
    } else {
      // Мгновенно гасим бейдж непрочитанного для открываемого канала,
      // не дожидаясь поллинга /api/channels/unread
      setUnreadCounts((prev) => {
        const next = { ...prev };
        delete next[channel.id];
        return next;
      });
      setMentionChannels((prev) => {
        const next = { ...prev };
        delete next[channel.id];
        return next;
      });
      // NEW: сразу просим десктоп-оболочку пересчитать цифру на значке
      getDesktopApi()?.refreshBadge?.();
      setSelectedChannel(channel.id);
      setMobileView("chat");
      // Человек открыл переписку — показ экрана уходит в плашку, чат виден.
      setVoiceViewFocused(false);
    }
  };

  // FIX-HASHTAG: переход по клику на #Канал из текста сообщения (событие шлёт messageFormat).
  // Имена сравниваем без учёта регистра, пробелы в названии канала
  // эквивалентны «_» в хештеге (#Общий_чат → канал «Общий чат»).
  useEffect(() => {
    const onOpenChannel = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      if (!raw || !groupDetail) return;
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");
      const target = norm(raw);
      const channel = groupDetail.channels.find((c) => norm(c.name) === target);
      if (channel && channel.type !== "CATEGORY") handleChannelClick(channel);
    };
    window.addEventListener("tz-open-channel", onOpenChannel);
    return () => window.removeEventListener("tz-open-channel", onOpenChannel);
  });

  const deleteChannel = (channelId: string) => {
    setPageConfirm({
      message: "Удалить канал?",
      onConfirm: async () => {
        await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
        if (selectedChannel === channelId) setSelectedChannel(null);
        if (selectedGroup) fetchGroupDetail(selectedGroup);
        setPageConfirm(null);
      },
    });
  };

  const deleteGroup = () => {
    if (!selectedGroup) return;
    setPageConfirm({
      message: "Удалить группу? Это действие нельзя отменить.",
      onConfirm: async () => {
        const res = await fetch(`/api/groups/${selectedGroup}`, { method: "DELETE" });
        if (res.ok) {
          setSelectedGroup(null);
          setGroupDetail(null);
          setShowGroupSettings(false);
          fetchGroups();
        }
        setPageConfirm(null);
      },
    });
  };

  const leaveGroup = () => {
    if (!selectedGroup) return;
    setPageConfirm({
      message: "Покинуть это сообщество? Вы перестанете видеть его каналы и сообщения.",
      onConfirm: async () => {
        const res = await fetch(`/api/groups/${selectedGroup}/leave`, { method: "POST" });
        if (res.ok) {
          setSelectedGroup(null);
          setGroupDetail(null);
          setSelectedChannel(null);
          setMobileView("groups");
          fetchGroups();
        }
        setPageConfirm(null);
      },
    });
  };

  // REFACTOR-A: FIX-RELOGIN («иллюзия выхода») — hooks/useHadSession (перенос 1-в-1).
  const { hadSession, clearHadSession } = useHadSession(session, status);

  if (status === "loading") {
    return (
      <div className="min-h-[calc(100vh-var(--tz-navbar-h)-var(--tz-desktop-inset-bottom,0px))] max-md:min-h-[100dvh] flex items-center justify-center bg-white dark:bg-neutral-950">
        <Spinner />
      </div>
    );
  }

  if (!session) {
    /* Если сессия уже была в этой вкладке или пропала сеть — это временный сбой
       обновления сессии, а не реальный выход. Показываем переподключение. */
    const likelyAuthed =
      hadSession ||
      (typeof navigator !== "undefined" && !navigator.onLine);
    if (likelyAuthed) {
      return (
        <div className="min-h-[calc(100vh-var(--tz-navbar-h)-var(--tz-desktop-inset-bottom,0px))] max-md:min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-white dark:bg-neutral-950">
          <Spinner />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Восстанавливаем сессию…</p>
          <Link
            href="/auth/signin"
            className="text-xs text-neutral-400 hover:underline"
            onClick={clearHadSession}
          >
            Войти заново
          </Link>
        </div>
      );
    }
    return (
      <div className="min-h-[calc(100vh-var(--tz-navbar-h)-var(--tz-desktop-inset-bottom,0px))] max-md:min-h-[100dvh] flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="text-center max-w-md px-6">
          <span className="text-6xl block mb-4">{"\uD83D\uDCAC"}</span>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">TZ.Connect</h1>
          <p className="text-neutral-500 mb-6">Войдите или зарегистрируйтесь, чтобы присоединиться к группам и общаться</p>
          <Link href="/auth/signin" className="btn-primary">Войти</Link>
        </div>
      </div>
    );
  }

  /* FIX-GRPSWITCH2: пока ответ по новой группе не пришёл, в состоянии лежат
     данные ПРЕДЫДУЩЕЙ группы (groupDetail) и её выбранный канал. Раньше чат
     рендерился по ним — при переходе группа→группа на секунду показывался чат
     старой группы. Ниже всё, что рисует каналы и чат, завязано на groupReady:
     данные приняты и относятся именно к выбранной группе. */
  const groupReady = !!groupDetail && groupDetail.id === selectedGroup;
  const selectedChannelData = groupReady
    ? groupDetail!.channels.find((c) => c.id === selectedChannel)
    : undefined;
  const userId = (session.user as { id?: string }).id ?? "";

  // FREE-COMMUNITY-LIMIT: сколько своих сообществ уже создал пользователь
  // (основное сообщество общее, его не считаем). Передаётся в CreateGroupModal,
  // чтобы показать счётчик и заблокировать кнопку у обычных аккаунтов.
  const ownedCommunitiesCount = groups.filter((g) => g.ownerId === userId && !g.isMain).length;

  // Block-based layout for the main community: general chat + voice + section blocks
  const isBlockMode = !!groupDetail?.isMain || !!groupDetail?.sectionsEnabled;
  const generalChannelId = isBlockMode && groupDetail
    ? (groupDetail.channels.find((c) => c.type === "TEXT" && !c.parentId)?.id ?? null)
    : null;

  return (
    <MotionConfig reducedMotion={isMono ? "always" : "never"}>
    <>
    {!splashDone && !isMono && <ConnectSplash onDone={handleSplashDone} />}
    {/* FIX-DM-VH: на телефоне высота берётся из --tz-app-h, а не из h-dvh.
        В globals.css у .cn-main уже выстроен каскад 100vh → 100dvh → --tz-app-h
        именно потому, что Android WebView не пересчитывает dvh при появлении
        клавиатуры (тот же приём в WorkspaceCanvas и NewsComposer). Но утилитарный
        класс max-md:h-dvh стоял на том же элементе и перебивал этот каскад —
        каркас оставался высотой во весь экран, клавиатура накрывала поле ввода,
        а страница начинала прокручиваться целиком. */}
    <div className="cn-main flex h-[calc(100vh-64px-var(--tz-desktop-inset-bottom))] max-md:h-[var(--tz-app-h,100dvh)] overflow-hidden">

      {/* ── COL 1: NavRail (desktop only) ── */}
      <NavRail
        activeSection={activeSection}
        onChangeSection={(section) => {
          if (section === activeSection && section === "communities") {
            setSelectedGroup(null);
            setSelectedChannel(null);
            setMobileView("groups");
          }
          setActiveSection(section);
          if (section !== "dm") setDmFriendId(null);
          if (section !== "communities") setSelectedChannel(null);
        }}
        myProfileUser={myProfileUser}
        userName={session.user.name ?? ""}
        userUsername={session.user.username ?? ""}
        onProfileSettings={() => router.push("/settings")}
        isPremium={hasPremium(session.user)}
        onOpenPremiumInfo={() => setShowPremiumInfo(true)}
        onOpenSearch={() => setShowGlobalSearch(true)}
        onOpenAi={() => setAiOpen((v) => !v)}
        showBusiness={showBusiness}
      />

      {/* ── Mobile view (full width, stacked) ── */}
      {isDesktopViewport !== true && (
      <div className="md:hidden flex-1 flex flex-col h-full overflow-hidden">
        {/* Mobile content area */}
        <div className={`flex-1 flex flex-col overflow-hidden transition-opacity duration-200 ${groupSwitching ? "opacity-40 pointer-events-none" : "opacity-100"}`}>
          {activeSection === "communities" && (
            <>
              {mobileView === "groups" && (
                <MobileGroupList
                  groups={groups}
                  onSelectGroup={handleSelectGroup}
                  onCreateGroup={() => setShowCreateGroup(true)}
                  onJoinGroup={() => setShowJoinGroup(true)}
                  /* MOBILE-PROFILE: кнопки «Друзья» здесь больше нет — она
                     повторяла раздел из нижней навигации. На её месте вход в свои
                     разделы (см. MobileProfileSheet). */
                  onOpenSearch={() => setShowGlobalSearch(true)}
                  /* MOBILE-VPN: вход в Premium и VPN — тот же, что в левой
                     панели на большом экране. Панель на телефоне скрыта, и без
                     этого до VPN было не добраться вовсе. */
                  isPremium={hasPremium(session.user)}
                  onOpenPremiumInfo={() => setShowPremiumInfo(true)}
                  groupUnread={groupUnread}
                />
              )}
              {mobileView === "chat" && selectedGroup && !groupReady && (
                <div className="flex-1 flex items-center justify-center">
                  <Spinner />
                </div>
              )}
              {/* MOBILE-DRAWER: экран группы — чат всегда по центру; текстовые и
                  голосовые каналы вместе с «Разделами» — в выдвижной панели
                  слева (ChannelSidebar). Свайп вправо от левого края открывает
                  панель, свайп влево / тап по затемнению / выбор канала —
                  закрывает; системная «назад» закрывает панель первой. */}
              {mobileView === "chat" && selectedGroup && groupReady && groupDetail && (
                <div
                  className="relative flex-1 flex flex-col h-full overflow-hidden"
                  onTouchStart={handleGroupTouchStart}
                  onTouchEnd={handleGroupTouchEnd}
                >
                  {selectedChannel && selectedChannelData ? (
                    selectedChannelData.type === "QA" ? (
                      <QAPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} onBack={() => setShowChannelsDrawer(true)} />
                    ) : selectedChannelData.type === "DOCS" ? (
                      <>
                        <div className="md:hidden flex-shrink-0 h-11 flex items-center gap-1 px-1 border-b border-[var(--cn-border)]">
                          <button onClick={() => setShowChannelsDrawer(true)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-neutral-400 active:text-neutral-600 dark:active:text-white" aria-label="Открыть каналы">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
                          </button>
                          <span className="text-sm font-medium text-neutral-900 dark:text-white truncate">{selectedChannelData.name}</span>
                        </div>
                        <DocsPanel channelId={selectedChannel} channelName={selectedChannelData.name} />
                      </>
                    ) : selectedChannelData.type === "CALENDAR" ? (
                      <>
                        <div className="md:hidden flex-shrink-0 h-11 flex items-center gap-1 px-1 border-b border-[var(--cn-border)]">
                          <button onClick={() => setShowChannelsDrawer(true)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-neutral-400 active:text-neutral-600 dark:active:text-white" aria-label="Открыть каналы">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
                          </button>
                          <span className="text-sm font-medium text-neutral-900 dark:text-white truncate">{selectedChannelData.name}</span>
                        </div>
                        <CalendarPanel channelId={selectedChannel} channelName={selectedChannelData.name} />
                      </>
                    ) : selectedChannelData.type === "WIKI" ? (
                      <WikiPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} onBack={() => setShowChannelsDrawer(true)} />
                    ) : selectedChannelData.type === "TASKS" ? (
                      <TasksPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} onBack={() => setShowChannelsDrawer(true)} highlightTaskId={highlightTaskId} onHighlightConsumed={() => setHighlightTaskId(null)} />
                    ) : selectedChannelData.type === "CANVAS" ? (
                      <GroupWorkspacePanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} currentUserName={session.user.name ?? ""} canModerate={!!canManage} onBack={() => setShowChannelsDrawer(true)} />
                    ) : selectedChannelData.type === "COMMUNITY" ? (
                      <>
                        <div className="md:hidden flex-shrink-0 h-11 flex items-center gap-1 px-1 border-b border-[var(--cn-border)]">
                          <button onClick={() => setShowChannelsDrawer(true)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-neutral-400 active:text-neutral-600 dark:active:text-white" aria-label="Открыть каналы">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
                          </button>
                          <span className="text-sm font-medium text-neutral-900 dark:text-white truncate">{selectedChannelData.name}</span>
                        </div>
                        <CommunityPanel groupId={selectedGroup!} channelName={selectedChannelData.name} currentUserId={userId} myRole={groupDetail?.myRole ?? "MEMBER"} />
                      </>
                    ) : selectedChannelData.type === "APPEALS" ? (
                      <AppealsPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} onBack={() => setShowChannelsDrawer(true)} />
                    ) : (
                      <>
                        {/* Активные опросы: на десктопе это отдельная колонка (COL 4),
                            на мобильном показываем компактным блоком над чатом. */}
                        {!isBlockMode && <PollsPanel channelId={selectedChannel} currentUserId={userId} />}
                        <MessageArea
                          channelId={selectedChannel}
                          channelName={selectedChannelData.name}
                          channelIcon={selectedChannelData.icon}
                          channelType={selectedChannelData.type}
                          postAccess={selectedChannelData.postAccess}
                          currentUserId={userId}
                          currentUserName={session.user.name ?? ""}
                          currentUserRole={userRole}
                          currentUserCommunityRole={groupDetail?.myRole ?? "MEMBER"}
                          isBanned={!!isBanned}
                          onBack={() => setShowChannelsDrawer(true)}
                          highlightMessageId={highlightMessageId}
                          onHighlightConsumed={() => setHighlightMessageId(null)}
                          onOpenDm={handleMessageFriend}
                        />
                      </>
                    )
                  ) : (
                    /* Канал ещё не выбран (нет текстовых каналов) */
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                      <p className="text-sm text-neutral-400">Выберите канал, чтобы начать общение</p>
                      <button onClick={() => setShowChannelsDrawer(true)} className="btn-primary text-sm min-h-[44px]">Открыть каналы</button>
                    </div>
                  )}

                  {/* Выдвижная панель каналов и разделов */}
                  <AnimatePresence>
                    {showChannelsDrawer && (
                      <>
                        <motion.div
                          className="absolute inset-0 z-40 bg-black/50"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => setShowChannelsDrawer(false)}
                          aria-hidden="true"
                        />
                        <motion.div
                          className="absolute inset-y-0 left-0 z-50 w-[85%] max-w-[340px] flex shadow-2xl"
                          initial={{ x: "-102%" }}
                          animate={{ x: 0 }}
                          exit={{ x: "-102%" }}
                          transition={{ type: "spring", damping: 32, stiffness: 340 }}
                        >
                          <ChannelSidebar
                            groupDetail={groupDetail}
                            selectedChannel={selectedChannel}
                            unreadCounts={unreadCounts}
                            mentionChannels={mentionChannels}
                            canManage={!!canManage}
                            isMainCommunity={!!groupDetail.isMain}
                            showCooperation={!isBanned && !identityBlocked && !!groupDetail.isMain} // FIX-COOP

                            blockMode={isBlockMode}
                            generalChannelId={generalChannelId}
                            myProfileUser={myProfileUser}
                            userName={session.user.name ?? ""}
                            userUsername={session.user.username ?? ""}
                            userRole={userRole}
                            onChannelClick={(channel) => {
                              handleChannelClick(channel);
                              /* голосовой канал подключается, оставаясь в панели */
                              if (channel.type !== "VOICE") setShowChannelsDrawer(false);
                            }}
                            onDeleteChannel={deleteChannel}
                            onCreateChannel={(options) => { setCreateChannelOptions(options ?? null); setShowCreateChannel(true); }}
                            onInvite={() => setShowInvite(true)}
                            onProfileSettings={() => router.push("/settings")}
                            onOpenSettings={() => setShowGroupSettings(true)}
                            memberCount={groupDetail.membersTotal ?? groupDetail.members.length}
                            onBack={() => window.history.go(-2) /* снять слой панели и шаг чата — к списку сообществ */}
                            voiceState={voiceState}
                            voiceActions={voiceActions}
                            onVoiceExpand={() => setShowVoicePanel(true)}
                            onVoiceFocus={focusScreenShare}
                            onGroupRefresh={() => selectedGroup && fetchGroupDetail(selectedGroup)}
                            onLeaveGroup={leaveGroup}
                          />
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}

          {activeSection === "friends" && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <FriendsPanel onMessageFriend={(friendId) => { handleMessageFriend(friendId); }} />
            </div>
          )}

          {activeSection === "dm" && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <DMPanel
                currentUserId={userId}
                onClose={() => { setActiveSection("communities"); setDmFriendId(null); }}
                initialFriendId={dmFriendId}
                highlightMessageId={highlightDmMessageId}
                onHighlightConsumed={() => setHighlightDmMessageId(null)}
              />
            </div>
          )}

          {activeSection === "business" && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <DMPanel
                currentUserId={userId}
                onClose={() => setActiveSection("communities")}
                initialFriendId={null}
                kind="business"
                initialConversationId={businessConvId}
              />
            </div>
          )}
        </div>

        {/* MOBILE-UI: нижняя навигация — Сообщества/Друзья/Сообщения.
            Видна только на верхнем уровне стека (список сообществ / друзья / диалоги),
            внутри каналов и чата не занимает место. Высота учитывает системную
            полосу жестов (safe-area-inset-bottom). */}
        {mobileView === "groups" && (
          <div className="flex-shrink-0 flex items-stretch border-t border-neutral-200 dark:border-white/5 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-lg"
            style={{ height: "calc(52px + env(safe-area-inset-bottom, 0px))", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            {([
              { key: "communities" as NavSection, label: "Сообщества", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="12" width="4" height="10" rx="0.5" /><rect x="18" y="12" width="4" height="10" rx="0.5" /><rect x="8" y="8" width="8" height="14" rx="0.5" /><path d="M8 8l1.5-3h5L16 8" /><rect x="10.5" y="15" width="3" height="7" rx="0.5" /></svg> },
              { key: "friends" as NavSection, label: "Друзья", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="3" /><path d="M12 13c-3.31 0-6 1.79-6 4v1h12v-1c0-2.21-2.69-4-6-4z" /><circle cx="4.5" cy="9" r="2" /><path d="M4.5 13C2.57 13 1 14.34 1 16v1h4" /><circle cx="19.5" cy="9" r="2" /><path d="M19.5 13c1.93 0 3.5 1.34 3.5 3v1h-4" /></svg> },
              { key: "dm" as NavSection, label: "Сообщения", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
              /* MOBILE-UI: раздел деловых разговоров на телефоне был недоступен —
                 панель для него рисовалась, а переключиться на неё было нечем:
                 в нижней навигации кнопки не было, а боковая полоса на телефоне
                 скрыта. Клиент, подавший заявку с телефона, свой чат не находил.
                 Значок тот же, что в боковой полосе (щит), вписан разметкой, чтобы
                 цвет активной вкладки наследовался как у остальных. */
              ...(showBusiness
                ? [{ key: "business" as NavSection, label: "Бизнес", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg> }]
                : []),
            ]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => {
                  setActiveSection(key);
                  if (key !== "dm") setDmFriendId(null);
                  if (key !== "communities") { setSelectedChannel(null); }
                  if (key === "communities") { setSelectedGroup(null); setMobileView("groups"); }
                }}
                className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors active:scale-95
                  ${activeSection === key ? "text-accent" : "text-neutral-400 dark:text-neutral-500"}`}
                aria-current={activeSection === key ? "page" : undefined}
              >
                {activeSection === key && (
                  <span aria-hidden="true" className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-accent" />
                )}
                {icon}
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </button>
            ))}
          </div>
        )}

      </div>
      )}

      {/* ── Desktop: COL 2 + COL 3 ── */}
      {isDesktopViewport !== false && (
      <div className={`max-md:hidden flex flex-1 h-full overflow-hidden transition-opacity duration-200 ${groupSwitching ? "opacity-40 pointer-events-none" : "opacity-100"}`}>

        {/* ═══════════ COMMUNITIES ═══════════ */}
        {activeSection === "communities" && (
          <>
            {/* COL 2 — group list OR channel list (user-resizable, see the
                PanelResizer just after this column) */}
            <div className="flex-shrink-0 flex flex-col h-full" style={{ width: channelColWidth }}>
              {selectedGroup && groupReady && groupDetail ? (
                /* Sub-nav: channels inside selected group */
                <ChannelSidebar
                  groupDetail={groupDetail}
                  selectedChannel={selectedChannel}
                  unreadCounts={unreadCounts}
                  mentionChannels={mentionChannels}
                  canManage={!!canManage}
                  isMainCommunity={!!groupDetail.isMain}
                  showCooperation={!isBanned && !identityBlocked && !!groupDetail.isMain} // FIX-COOP

                  blockMode={isBlockMode}
                  generalChannelId={generalChannelId}
                  myProfileUser={myProfileUser}
                  userName={session.user.name ?? ""}
                  userUsername={session.user.username ?? ""}
                  userRole={userRole}
                  onChannelClick={handleChannelClick}
                  onDeleteChannel={deleteChannel}
                  onCreateChannel={(options) => { setCreateChannelOptions(options ?? null); setShowCreateChannel(true); }}
                  onInvite={() => setShowInvite(true)}
                  onProfileSettings={() => router.push("/settings")}
                  onOpenSettings={() => setShowGroupSettings(true)}
                  memberCount={groupDetail.membersTotal ?? groupDetail.members.length}
                  voiceState={voiceState}
                  voiceActions={voiceActions}
                  onVoiceExpand={() => setShowVoicePanel(true)}
                  onVoiceFocus={focusScreenShare}
                  onGroupRefresh={() => selectedGroup && fetchGroupDetail(selectedGroup)}
                  onLeaveGroup={leaveGroup}
                />
              ) : (
                /* Top-level group list */
                <GroupListPanel
                  groups={groups}
                  selectedGroup={selectedGroup}
                  onSelectGroup={handleSelectGroup}
                  onCreateGroup={() => setShowCreateGroup(true)}
                  onJoinGroup={() => setShowJoinGroup(true)}
                  groupUnread={groupUnread}
                />
              )}
            </div>

            {/* Drag handle between the channel column and the chat */}
            <PanelResizer
              width={channelColWidth}
              min={CHANNEL_COL_MIN}
              max={CHANNEL_COL_MAX}
              onChange={updateChannelColWidth}
            />

            {/* COL 3 — chat area.
                data-tz-share-area: по этой отметке окно демонстрации находит
                область контента и раскрывается ровно в ней, не накрывая список
                сообществ, каналов и участников — обсуждение показа идёт в чате,
                и закрывать его нельзя. */}
            <div data-tz-share-area className="flex flex-1 flex-col h-full cn-main overflow-hidden">
              {selectedChannel && selectedChannelData ? (
                groupPausedForMe ? (
                  <GroupPausedSkeleton />
                ) : selectedChannelData.type === "QA" ? (
                  <QAPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} />
                ) : selectedChannelData.type === "DOCS" ? (
                  <DocsPanel channelId={selectedChannel} channelName={selectedChannelData.name} />
                ) : selectedChannelData.type === "CALENDAR" ? (
                  <CalendarPanel channelId={selectedChannel} channelName={selectedChannelData.name} />
                ) : selectedChannelData.type === "WIKI" ? (
                  <WikiPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} />
                ) : selectedChannelData.type === "TASKS" ? (
                  <TasksPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} highlightTaskId={highlightTaskId} onHighlightConsumed={() => setHighlightTaskId(null)} />
                ) : selectedChannelData.type === "CANVAS" ? (
                  <GroupWorkspacePanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} currentUserName={session.user.name ?? ""} canModerate={!!canManage} />
                ) : selectedChannelData.type === "COMMUNITY" ? (
                  <CommunityPanel groupId={selectedGroup!} channelName={selectedChannelData.name} currentUserId={userId} myRole={groupDetail?.myRole ?? "MEMBER"} />
                ) : selectedChannelData.type === "APPEALS" ? (
                  <AppealsPanel channelId={selectedChannel} channelName={selectedChannelData.name} currentUserId={userId} canModerate={!!canManage} />
                ) : (
                  <MessageArea
                  channelId={selectedChannel}
                  channelName={selectedChannelData.name}
                  channelIcon={selectedChannelData.icon}
                  channelType={selectedChannelData.type}
                  postAccess={selectedChannelData.postAccess}
                  currentUserId={userId}
                  currentUserName={session.user.name ?? ""}
                  currentUserRole={userRole}
                  currentUserCommunityRole={groupDetail?.myRole ?? "MEMBER"}
                  isBanned={!!isBanned}
                  onNewMessage={fetchUnread}
                  highlightMessageId={highlightMessageId}
                  onHighlightConsumed={() => setHighlightMessageId(null)}
                  onOpenDm={handleMessageFriend}
                />
                )
              ) : selectedGroup && groupReady && groupDetail ? (
                <div className="flex-1 flex items-center justify-center overflow-y-auto">
                  {groupDetail.rules && !groupDetail.rulesAccepted && groupDetail.myRole === "MEMBER" ? (
                    <GroupRulesGate group={groupDetail} onAccept={async () => {
                      await fetch(`/api/groups/${groupDetail.id}/accept-rules`, { method: "POST" });
                      setGroupDetail({ ...groupDetail, rulesAccepted: true });
                    }} />
                  ) : (
                    <GroupInfoPanel
                      group={groupDetail}
                      canManage={groupDetail.myRole === "OWNER" || groupDetail.myRole === "ADMIN" || groupDetail.myRole === "MODERATOR"}
                      onUpdateRules={async (rules: string) => {
                        await fetch(`/api/groups/${groupDetail.id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ rules }),
                        });
                        setGroupDetail({ ...groupDetail, rules });
                      }}
                      onAutoSelectChannel={() => {
                        const firstText = groupDetail.channels.find(c => c.type === "TEXT");
                        if (firstText) handleChannelClick(firstText);
                      }}
                    />
                  )}
                </div>
              ) : (
                <ConnectWelcome onCreate={() => setShowCreateGroup(true)} onJoin={() => setShowJoinGroup(true)} />
              )}
            </div>

            {/* COL 4 — section blocks (main community only) */}
            {isBlockMode && selectedGroup && groupReady && groupDetail && (
              <SectionsPanel
                channels={groupDetail.channels}
                generalChannelId={generalChannelId}
                selectedChannel={selectedChannel}
                unreadCounts={unreadCounts}
                canManage={!!canManage}
                groupId={groupDetail.id}
                members={groupDetail.members}
                membersTotal={groupDetail.membersTotal}
                canSeeMembers={!hideMembersForMain}
                onSelectChannel={handleChannelClick}
                onRefresh={() => selectedGroup && fetchGroupDetail(selectedGroup)}
                onDeleteChannel={canManage ? async (channelId) => {
                  await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
                  fetchGroupDetail(selectedGroup);
                } : undefined}
                onToggleHideChannel={canManage ? async (channelId, hidden) => {
                  await fetch(`/api/channels/${channelId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ hidden }),
                  });
                  fetchGroupDetail(selectedGroup);
                } : undefined}
              />
            )}

            {/* COL 4 — module sections (regular/secondary groups, not main).
                FIX-PANELVIEW3: условие «есть хотя бы один модуль» убрано — колонка
                теперь ещё и единственный вход в участников, поэтому нужна и в
                группе без модулей. */}
            {!isBlockMode && selectedGroup && groupReady && groupDetail && (
              <ModulesPanel
                channels={groupDetail.channels}
                selectedChannel={selectedChannel}
                groupId={groupDetail.id}
                members={groupDetail.members}
                membersTotal={groupDetail.membersTotal}
                canSeeMembers={!hideMembersForMain}
                onSelect={(ch) => handleChannelClick(ch as unknown as Channel)}
              />
            )}

            {/* COL 4 — active polls (regular groups) */}
            {!isBlockMode && selectedGroup && selectedChannel && (
              <PollsPanel channelId={selectedChannel} currentUserId={userId} />
            )}

          </>
        )}

        {/* ═══════════ FRIENDS ═══════════ */}
        {activeSection === "friends" && (
          <>
            {/* COL 2 — friends list */}
            <FriendsPanel onMessageFriend={handleMessageFriend} />

            {/* COL 3 — hint */}
            <div className="flex-1 flex items-center justify-center cn-main">
              <div className="text-center">
                <UsersIcon size={44} tone="muted" className="mx-auto mb-3" />
                <p className="text-sm" style={{ color: "var(--cn-muted)" }}>
                  Выберите друга, чтобы написать
                </p>
              </div>
            </div>
          </>
        )}

        {/* ═══════════ MESSAGES (DM) ═══════════ */}
        {activeSection === "dm" && (
          /* DMPanel contains both COL 2 (dialog list) and COL 3 (chat) */
          <DMPanel
            currentUserId={userId}
            onClose={() => { setActiveSection("communities"); setDmFriendId(null); }}
            initialFriendId={dmFriendId}
            highlightMessageId={highlightDmMessageId}
            onHighlightConsumed={() => setHighlightDmMessageId(null)}
          />
        )}

        {/* ═══════════ BUSINESS ═══════════ */}
        {activeSection === "business" && (
          <DMPanel
            currentUserId={userId}
            onClose={() => setActiveSection("communities")}
            initialFriendId={null}
            kind="business"
            initialConversationId={businessConvId}
          />
        )}
      </div>
      )}

      {/* AI Assistant */}
      <AiChatPanel open={aiOpen} onClose={() => setAiOpen(false)} />

      {/* НОВОЕ: при глобальном бане (или блокировке по IP/устройству) — полное
          скелетирование всех проектов вместо плавающего тоста, который раньше
          перекрывал строку «Отправка сообщений ограничена» */}
      {(isBanned || identityBlocked) && (
        <AccountSuspendedOverlay
          until={session?.user?.bannedUntil ?? null}
          reason={session?.user?.banReason ?? null}
        />
      )}

      {!isBanned && !identityBlocked && activeSection === "communities" && !!groupDetail?.isMain && <AppealComposer />}

      {/* REFACTOR-A: шилд «Соединение потеряно» — overlays/ConnectionLostShield (перенос 1-в-1) */}
      {connectionLost && <ConnectionLostShield reconnectAttempt={reconnectAttempt} />}

      {/* Modals */}
      <AnimatePresence>
        {showGlobalSearch && <GlobalSearchModal onClose={() => setShowGlobalSearch(false)} />}
        {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} onCreated={fetchGroups} isPremium={hasPremium(session.user)} ownedCount={ownedCommunitiesCount} />}
        {showJoinGroup && <JoinGroupModal onClose={() => setShowJoinGroup(false)} onJoined={fetchGroups} />}
        {showCreateChannel && selectedGroup && (
          <CreateChannelModal
            groupId={selectedGroup}
            initialParentId={createChannelOptions?.parentId ?? null}
            initialCreateCategory={createChannelOptions?.createCategory ?? false}
            initialGroupType={createChannelOptions?.groupType ?? "TEXT"}
            initialType={createChannelOptions?.defaultType ?? "TEXT"}
            onClose={() => { setShowCreateChannel(false); setCreateChannelOptions(null); }}
            onCreated={() => { if (selectedGroup) fetchGroupDetail(selectedGroup); }}
          />
        )}
        {showInvite && selectedGroup && (
          <InviteModal groupId={selectedGroup} onClose={() => setShowInvite(false)} />
        )}
        {showGroupSettings && groupDetail && (
          <GroupSettingsModal
            group={groupDetail}
            onClose={() => setShowGroupSettings(false)}
            onUpdated={() => { if (selectedGroup) fetchGroupDetail(selectedGroup); fetchGroups(); }}
            onDelete={deleteGroup}
          />
        )}
        {showPremiumInfo && session?.user && (
          // REFACTOR-A: модалка TZ Premium / VPN — overlays/PremiumInfoModal.
          <PremiumInfoModal
            isPremium={hasPremium(session.user)}
            onClose={() => setShowPremiumInfo(false)}
            onOpenSettings={() => { setShowPremiumInfo(false); router.push("/settings?cat=premium"); }}
          />
        )}
        {showVoicePanel && voice.isConnected && (
          <VoiceExpandedPanel onClose={() => setShowVoicePanel(false)} />
        )}
      </AnimatePresence>

      {/* Floating screen share window (supports several shares at once) */}
      {voice.isConnected && voice.screenShares.length > 0 && (
        <ScreenShareWindow
          shares={voice.screenShares}
          onStopLocal={voice.stopScreenShare}
          /* Одна поверхность за раз. Показ разворачивается во всю колонку
             только когда человек смотрит на голосовой канал и не открыл окно
             комнаты: раньше комната и показ рисовали один и тот же поток
             одновременно, и комната пряталась под трансляцией. */
          onVoiceChannel={voiceViewFocused && !showVoicePanel}
          focusNonce={shareFocusNonce}
        />
      )}

      {/* Confirm modal — REFACTOR-A: overlays/PageConfirmModal (перенос 1-в-1) */}
      {pageConfirm && (
        <PageConfirmModal message={pageConfirm.message} onConfirm={pageConfirm.onConfirm} onCancel={() => setPageConfirm(null)} />
      )}
    </div>
    </>
    </MotionConfig>
  );
}

