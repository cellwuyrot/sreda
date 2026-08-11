"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import DayNightBackground from "@/components/connect/DayNightBackground";
import ForwardModal from "@/components/connect/ForwardModal";
import GeoPicker from "@/components/ui/GeoPicker";
import { useFileDropPaste } from "@/hooks/useFileDropPaste";
import { useMobile } from "@/hooks/useMobile";
import { useHistoryLayer } from "@/components/connect/hooks/useMobileHistoryStack"; // MOBILE-UI
import DMConversationList from "./DMConversationList";
import DMMessageHeader from "./DMMessageHeader";
import DMMessageList from "./DMMessageList";
import DMMessageComposer from "./DMMessageComposer";
// BUSINESS-PAY: окно оплаты за кнопкой в шапке делового разговора.
import BusinessPaymentModal from "./BusinessPaymentModal";
import type { BusinessPaymentView } from "@/lib/businessPayment";
import DMThreadPanel from "./DMThreadPanel";
import DMUserContextMenu, { DMAttachmentsModal, DMAutoReplyModal, DM_SETTINGS_DEFAULTS, type DmSettings } from "./DMUserContextMenu"; // FIX-DM
import {
  type Attachment,
  type Conversation,
  type DMReaction,
  type ForwardTarget,
  type Message,
} from "./dmTypes";
import {
  decryptMessage,
  encryptMessage,
  getOrCreateKeyPair,
  isE2EEMessage,
} from "@/lib/e2ee";
import { getDesktopApi } from "@/lib/desktop";
import { noteFileName, type MediaNoteKind } from "@/lib/mediaNote";
import { messageLengthError } from "@/lib/messageLimits";
import { hasPremium } from "@/lib/premium";
import { useMessageWindow } from "@/hooks/useMessageWindow";
import { uploadWithProgress } from "@/lib/uploadWithProgress"; // FIX-UPLOAD
// FIX-ICONS: фирменные SVG-иконки вместо PNG и эмодзи «💬»
import { PinIcon, ChatIcon } from "@/components/ui/ConnectIcons";

interface DMPanelProps {
  currentUserId: string;
  onClose: () => void;
  initialFriendId: string | null;
  highlightMessageId?: string | null;
  onHighlightConsumed?: () => void;
  /**
   * Какие разговоры показывать: личную переписку или деловые обращения.
   *
   * Панель одна на оба раздела намеренно. Логика чатов — отправка, вложения,
   * прочтения, сокеты — ни на грамм не отличается; отличается только выборка
   * списка. Второй экземпляр этого компонента означал бы две копии одного и
   * того же кода, которые немедленно начнут расходиться.
   */
  kind?: "personal" | "business";
  /**
   * CHAT: открыть сразу этот разговор.
   *
   * Нужен переходу из карточки проекта в личном кабинете: там уже известен
   * конкретный деловой разговор, и человек должен попасть именно в него, а не в
   * список одинаковых на вид заявок. По собеседнику (initialFriendId) такой
   * разговор не найти: у делового чата вторая сторона — безымянная
   * «Администрация», и у всех заявок клиента она одна и та же.
   */
  initialConversationId?: string | null;
}

export default function DMPanel({ currentUserId, onClose, initialFriendId, highlightMessageId, onHighlightConsumed, kind = "personal", initialConversationId = null }: DMPanelProps) {
  const isBusiness = kind === "business";
  /* Адрес списка. Остальные запросы панели (один диалог, отправка, прочтение)
     от вида не зависят: диалог уже найден по id. */
  const listUrl = isBusiness ? "/api/dm?kind=business" : "/api/dm";
  // ── Data state ────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  /* MOBILE-UI: на телефоне открытая беседа — слой поверх списка диалогов:
     системная «назад» закрывает её и возвращает к списку, а не выкидывает
     из раздела сообщений. */
  const isMobileViewport = useMobile();
  useHistoryLayer(isMobileViewport && !!selectedConvId, () => setSelectedConvId(null), "dm-conversation");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Pagination
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Composer
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  // FIX-UPLOAD: прогресс текущей загрузки для полоски в композере.
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number; index: number; total: number } | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // Reply
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; content: string } | null>(null);

  // День/ночь фон (настройка): показывается только внутри области чата
  const [dayNightEnabled, setDayNightEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tz-connect-daynight") === "true";
    }
    return false;
  });
  const [dayNightOpacity, setDayNightOpacity] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return parseInt(localStorage.getItem("tz-connect-daynight-opacity") ?? "15", 10);
    }
    return 15;
  });
  useEffect(() => {
    function handleDayNightChange(e: Event) {
      const detail = (e as CustomEvent<{ enabled: boolean; opacity: number }>).detail;
      setDayNightEnabled(detail.enabled);
      setDayNightOpacity(detail.opacity);
    }
    window.addEventListener("tz-daynight-change", handleDayNightChange);
    return () => window.removeEventListener("tz-daynight-change", handleDayNightChange);
  }, []);

  // Typing
  const [typingName, setTypingName] = useState<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Threads
  const [activeThread, setActiveThread] = useState<{ id: string; user: string; content: string } | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadInput, setThreadInput] = useState("");

  // Search & pinned panels
  const [showPinned, setShowPinned] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);

  // FIX-DM: контекстное меню по нику и настройки ЛС (ЧС / голосовые / автоответ)
  const [userMenu, setUserMenu] = useState<{ x: number; y: number } | null>(null);
  const [dmSettings, setDmSettings] = useState<DmSettings>(DM_SETTINGS_DEFAULTS);
  const [showAttachmentsPanel, setShowAttachmentsPanel] = useState(false);
  const [showAutoReply, setShowAutoReply] = useState(false);

  // Forward
  const [forwardMsg, setForwardMsg] = useState<{ content: string; userName: string; id: string; attachments: string | null } | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardTargets, setForwardTargets] = useState<ForwardTarget[]>([]);
  const [forwarding, setForwarding] = useState(false);

  // Image lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Toast & confirm
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Read receipts
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);

  // E2EE
  const [myPrivateKey, setMyPrivateKey] = useState<CryptoKey | null>(null);
  const [peerPublicKey, setPeerPublicKey] = useState<JsonWebKey | null>(null);
  const [chatMode, setChatMode] = useState<"open" | "secure">("open");
  const e2eeEnabled = chatMode === "secure";

  /* Подписка нужна для предела длины сообщения: без Premium он вдвое меньше.
     Берём из сессии — это тариф аккаунта, а не роль в сообществе. */
  const { data: session } = useSession();
  const isPremiumAccount = hasPremium(session?.user);

  // Scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Расстояние до низа ленты перед подстановкой старых сообщений сверху. */
  const prependAnchorRef = useRef<number | null>(null);
  /** Синхронный замок догрузки: setState не успевает между событиями прокрутки. */
  const loadLockRef = useRef(false);
  /** Кадр, в котором обработчик прокрутки уже запланирован. */
  const scrollRafRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  /* Оконный рендер ленты: в DOM полоса вокруг видимой области, остальное —
     распорки (см. hooks/useMessageWindow). Разбираем на части намеренно: сам
     объект пересоздаётся каждый рендер, и в зависимостях эффекта он давал бы
     бесконечный перезапуск. */
  const {
    start: winStart, end: winEnd, padTop: winPadTop, padBottom: winPadBottom,
    hiddenAbove: winHiddenAbove, sync: syncWindow, reveal: revealWindow, revealTail: revealWindowTail,
    reset: resetWindow,
  } = useMessageWindow(messages.length, scrollContainerRef);
  /** FIX-SCROLLEND: сколько ещё раз довести ленту до низа после раскрытия хвоста. */
  const endScrollRef = useRef(0);

  // Form refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const dmDraftKey = selectedConvId ? `tz-chat-draft:dm:${selectedConvId}` : null;
  const updateDmDraft = useCallback((value: string) => {
    setInput(value);
    if (!dmDraftKey) return;
    if (value) localStorage.setItem(dmDraftKey, value);
    else localStorage.removeItem(dmDraftKey);
  }, [dmDraftKey]);

  // Socket
  const socketRef = useRef<Socket | null>(null);
  const hasConnectedRef = useRef(false);

  // ── Derived ────────────────────────────────────────────────────────────
  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedConvId) || null,
    [conversations, selectedConvId],
  );
  const otherUser = selectedConv?.other ?? null;
  // Variant A: разделяем защищённые (E2EE) и открытые сообщения по вкладкам.
  const visibleMessages = useMemo(
    () => messages.filter((mm) => (chatMode === "secure" ? !!mm._encrypted : !mm._encrypted)),
    [messages, chatMode],
  );
  const otherId = otherUser?.id ?? null;
  const e2eeReady = !!(myPrivateKey && peerPublicKey);

  /* FIX-DM-NTF: говорим глобальной шапке, какая переписка сейчас открыта.

     Тост о новом ЛС показывает Navbar — именно потому, что сообщение должно
     догнать человека в любом разделе. Цена этого — шапка не знает, что диалог
     уже открыт. Поэтому панель сама объявляет своё состояние.

     При закрытии и при смене диалога обязательно сбрасываем отметку, иначе
     ушёдший из раздела человек навсегда перестал бы получать уведомления от
     последнего собеседника. */
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("tz-dm-active", {
        detail: { conversationId: selectedConvId, peerId: otherId },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("tz-dm-active", { detail: { conversationId: null, peerId: null } }),
      );
    };
  }, [selectedConvId, otherId]);

  /* Связка в заголовке делового разговора: тема заявки и кто её ведёт.
     Администрации имя ведущего нужно — иначе двое отвечают одному клиенту, не
     зная друг о друге. Клиенту его не показываем: он обращается к администрации,
     а не к конкретному человеку, и передача заявки другому сотруднику не должна
     выглядеть сменой собеседника. */
  const businessSubtitle = useMemo(() => {
    const info = selectedConv?.business;
    if (!info) return undefined;
    const parts: string[] = [];
    if (info.subject) parts.push(`Обращение: ${info.subject}`);
    if (info.party === "handler") {
      parts.push(info.handlerName ? `Отвечает: ${info.handlerName}` : "Заявку ещё не взяли");
    }
    return parts.length ? parts.join(" · ") : undefined;
  }, [selectedConv]);

  /* BUSINESS-LOCK: чей запрет и кому он мешает.
     `locked` закрывает отправку ТОЛЬКО клиенту: администрация должна иметь
     возможность объяснить, почему разговор окончен, иначе последнее слово всегда
     остаётся за клиентом. Сторону решает сервер (`party`), а не роль на клиенте —
     иначе одно правило жило бы в двух местах. */
  const businessLocked = selectedConv?.business?.locked === true;
  const isHandlerSide = selectedConv?.business?.party === "handler";
  const lockedForMe = isBusiness && businessLocked && !isHandlerSide;
  const canToggleLock = isBusiness && isHandlerSide;

  const businessEmptyText =
    "Пока нет разговоров по заявкам. Новая заявка на сотрудничество открывает разговор здесь.";

  /* BUSINESS-PAY: состояние счёта по открытому деловому разговору.
     Грузится отдельно от списка диалогов нарочно: список отдаётся целиком и
     часто, а счёт нужен только для одного разговора — тащить его в каждый
     ответ списка значило бы платить за данные, которые почти никогда не смотрят.
     null означает «счёта нет», и это валидное состояние, а не ошибка. */
  const [payment, setPayment] = useState<BusinessPaymentView | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    if (!isBusiness || !selectedConvId) {
      setPayment(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/business/${selectedConvId}/payment`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPayment(data.payment ?? null);
      } catch {
        /* Молча: отсутствие счёта не должно ломать переписку. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBusiness, selectedConvId]);

  /* При смене разговора окно оплаты закрываем: иначе оно останется висеть со
     старыми данными над чужим диалогом. */
  useEffect(() => {
    setPaymentOpen(false);
  }, [selectedConvId]);

  // ── Toast helper ────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const toggleLock = useCallback(async () => {
    if (!selectedConvId) return;
    const next = !businessLocked;
    try {
      const res = await fetch(`/api/dm/${selectedConvId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ locked: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error || "Не удалось изменить запрет отправки");
        return;
      }
      /* Не ждём события сокета: оно придёт и обеим сторонам, но нажавший должен
         увидеть отклик сразу. Повторное применение того же значения безвредно. */
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedConvId && c.business ? { ...c, business: { ...c.business, locked: next } } : c)),
      );
    } catch {
      showToast("Сеть недоступна — запрет не изменён");
    }
  }, [selectedConvId, businessLocked, showToast]);

  // FIX-DM: загрузка настроек ЛС при смене собеседника
  useEffect(() => {
    setUserMenu(null);
    setShowAttachmentsPanel(false);
    setShowAutoReply(false);
    setDmSettings(DM_SETTINGS_DEFAULTS);
    if (!otherId) return;
    /* В деловом разговоре персональных настроек ЛС нет: чёрный список и автоответ
       относятся к человеку, а собеседник здесь — администрация. Запрос настроек
       по случайно попавшему в пару сотруднику ничего не значил бы, а внести его в
       чёрный список означало бы отрезать себе же канал по своей заявке. */
    if (isBusiness) return;
    let cancelled = false;
    fetch(`/api/dm/settings?targetId=${otherId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setDmSettings({ ...DM_SETTINGS_DEFAULTS, ...d }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [otherId, isBusiness]);

  // FIX-DM: сохранение настроек ЛС (оптимистично, с откатом при ошибке)
  const updateDmSetting = useCallback(async (patch: Partial<DmSettings>) => {
    if (!otherId) return;
    setDmSettings((prev) => ({ ...prev, ...patch }));
    try {
      const res = await fetch("/api/dm/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetId: otherId, ...patch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        showToast((err && typeof err.error === "string" && err.error) || "Не удалось сохранить настройки");
        const fresh = await fetch(`/api/dm/settings?targetId=${otherId}`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (fresh) setDmSettings({ ...DM_SETTINGS_DEFAULTS, ...fresh });
      } else {
        const saved = await res.json().catch(() => null);
        if (saved) setDmSettings({ ...DM_SETTINGS_DEFAULTS, ...saved });
      }
    } catch {
      showToast("Ошибка сети — настройки не сохранены");
    }
  }, [otherId, showToast]);

  // ── Load conversations ──────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(listUrl, { credentials: "include" });
      if (res.ok) {
        const data: Conversation[] = await res.json();
        setConversations(data);
        /* CHAT: пришли по прямой ссылке на разговор (кнопка «Перейти в
           бизнес-чат» в карточке проекта) — открываем его. Разговора нет в
           списке только если он чужой: подставлять тогда первый попавшийся
           нельзя, человек написал бы не туда. */
        if (initialConversationId && data.some((c) => c.id === initialConversationId)) {
          setSelectedConvId(initialConversationId);
        }
        // Auto-open a conversation when entering via friend
        if (initialFriendId) {
          const match = data.find((c) => c.other.id === initialFriendId);
          if (match) {
            setSelectedConvId(match.id);
          } else {
            // No conversation yet (e.g. friend just added) — find-or-create one
            try {
              const cres = await fetch(listUrl, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: initialFriendId }),
              });
              if (cres.ok) {
                const conv = await cres.json();
                if (conv?.id) {
                  const r2 = await fetch("/api/dm", { credentials: "include" });
                  if (r2.ok) {
                    const data2: Conversation[] = await r2.json();
                    setConversations(data2);
                  }
                  setSelectedConvId(conv.id);
                }
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [initialFriendId, initialConversationId, listUrl]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ── E2EE init: my own keypair ────────────────────────────────────────────
  useEffect(() => {
    getOrCreateKeyPair()
      .then((kp) => setMyPrivateKey(kp.privateKey))
      .catch(() => {});
  }, []);

  // ── Fetch peer's public key when a conversation opens ─────────────────────
  const fetchPeerKey = useCallback(async (peerId: string) => {
    try {
      const res = await fetch(`/api/e2ee?userId=${peerId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.publicKey) setPeerPublicKey(data.publicKey);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // ── Decrypt helper with cache ─────────────────────────────────────────────
  const decryptCache = useRef<Map<string, string>>(new Map());
  const decryptContent = useCallback(
    async (content: string): Promise<string> => {
      if (!myPrivateKey || !peerPublicKey || !isE2EEMessage(content)) return content;
      const cached = decryptCache.current.get(content);
      if (cached !== undefined) return cached;
      try {
        const dec = await decryptMessage(content, myPrivateKey, peerPublicKey);
        decryptCache.current.set(content, dec);
        return dec;
      } catch {
        // FIX-E2EE: при ошибке расшифровки НЕ возвращаем сырой шифртекст
        // (пользователь видел бы «e2ee:…» как текст сообщения). Показываем
        // понятную заглушку.
        return "🔒 Не удалось расшифровать сообщение";
      }
    },
    [myPrivateKey, peerPublicKey],
  );

  // ── Load messages ─────────────────────────────────────────────────────────
  const loadMessages = useCallback(
    async (convId: string, append = false, cursor?: string) => {
      setMessagesLoading(true);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/dm/${convId}?${params}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const newMsgs: Message[] = data.messages || [];
        if (append) {
          /* Старые сообщения встанут сверху, лента вырастет, а браузер сохранит
             scrollTop — и прочитанное уедет вниз вместе с содержимым. Запоминаем
             расстояние до низа и возвращаем позицию сразу после отрисовки. */
          const el = scrollContainerRef.current;
          if (el) prependAnchorRef.current = el.scrollHeight - el.scrollTop;
          setMessages((prev) => [...newMsgs, ...prev]);
        } else {
          setMessages(newMsgs);
          requestAnimationFrame(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
          });
        }
        setHasMore(Boolean(data.nextCursor));
        setNextCursor(data.nextCursor || null);
      } catch {
        /* ignore */
      } finally {
        setMessagesLoading(false);
      }
    },
    [],
  );

  // ── When conversation changes: load messages, peer key, mark read ──────────
  useEffect(() => {
    if (!selectedConvId || !otherId) return;
    setInput(localStorage.getItem(`tz-chat-draft:dm:${selectedConvId}`) ?? "");
    requestAnimationFrame(() => textareaRef.current?.focus());
    decryptCache.current.clear();
    setMessages([]);
    resetWindow();
    setReplyTo(null);
    setEditingId(null);
    setShowPinned(false);
    setActiveThread(null);
    setPeerPublicKey(null);
    /* Сквозного шифрования в деловом разговоре нет намеренно. Оно рассчитано на
       двоих: ключи двух собеседников. А деловой разговор читает вся
       администрация по роли, и сотрудник без ключа увидел бы вместо переписки
       непригодный текст. Ключ не запрашиваем — кнопка защищённого режима не
       появляется, и обещания, которого нельзя выполнить, тоже. */
    if (!isBusiness) fetchPeerKey(otherId);
    loadMessages(selectedConvId);
    // Mark read
    fetch("/api/dm/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ conversationId: selectedConvId }),
    }).catch(() => {});
    // Reset unread counter locally
    setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? { ...c, unread: 0 } : c)));
    // NEW: сразу гасим цифру на значке приложения (десктоп)
    getDesktopApi()?.refreshBadge?.();
  }, [selectedConvId, otherId, isBusiness, fetchPeerKey, loadMessages, resetWindow]);

  // ── Deep-link from a notification: scroll to and flash the target DM message ──
  // FIX-JUMP: раньше эффект зависел от `messages` и пере-скроллил к цели на каждое
  // обновление ленты — вид «залипал» на сообщении и не давал прокручивать вниз.
  // Теперь прокрутка выполняется ровно один раз, затем цель освобождается, а
  // подсветка гаснет по собственному таймеру и не мешает ручной прокрутке.
  const dmHighlightAttemptsRef = useRef(0);
  const dmFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!highlightMessageId) { dmHighlightAttemptsRef.current = 0; return; }
    // Wait until the target conversation is open and its messages have loaded.
    if (!selectedConvId || messagesLoading || messages.length === 0) return;

    const release = () => {
      dmHighlightAttemptsRef.current = 0;
      onHighlightConsumed?.();
    };

    /* Сообщение может быть загружено, но не отрисовано: лента показывает окно
       вокруг видимой области. Сначала просим окно включить строку. */
    const targetIndex = messages.findIndex((m) => m.id === highlightMessageId);
    if (targetIndex >= 0 && (targetIndex < winStart || targetIndex >= winEnd)) {
      revealWindow(targetIndex);
      return;
    }

    const el = document.getElementById(`dm-msg-${highlightMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const prevBg = el.style.backgroundColor;
      el.style.transition = "background-color 0.4s ease";
      el.style.borderRadius = "0.5rem";
      el.style.backgroundColor = "rgba(34,211,238,0.18)";
      if (dmFlashTimerRef.current) clearTimeout(dmFlashTimerRef.current);
      dmFlashTimerRef.current = setTimeout(() => { el.style.backgroundColor = prevBg; }, 1800);
      release();
      return;
    }
    if (hasMore && nextCursor && dmHighlightAttemptsRef.current < 8) {
      dmHighlightAttemptsRef.current += 1;
      loadMessages(selectedConvId, true, nextCursor);
    } else {
      release();
    }
  }, [highlightMessageId, selectedConvId, messages, messagesLoading, hasMore, nextCursor, loadMessages, onHighlightConsumed, winStart, winEnd, revealWindow]);

  // Clear the flash timer on unmount so it never fires against a stale node.
  useEffect(() => () => { if (dmFlashTimerRef.current) clearTimeout(dmFlashTimerRef.current); }, []);

  useEffect(() => {
    if (!myPrivateKey || !peerPublicKey || messages.length === 0) return;
    const encryptedMessages = messages.filter((m) => isE2EEMessage(m.content));
    if (encryptedMessages.length === 0) return;

    let cancelled = false;

    Promise.all(
      messages.map(async (m) => {
        if (!isE2EEMessage(m.content)) return m;
        const decrypted = await decryptContent(m.content);
        if (decrypted === m.content && m._encrypted) return m;
        return { ...m, content: decrypted, _encrypted: true };
      }),
    ).then((decryptedMessages) => {
      if (cancelled) return;
      const changed = decryptedMessages.some((m, idx) => m !== messages[idx]);
      if (changed) setMessages(decryptedMessages);
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [messages, myPrivateKey, peerPublicKey, decryptContent]);

  // ── Socket connection ──────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io({ path: "/api/socketio", withCredentials: true });
    socketRef.current = socket;
    // Distinguishes the first `connect` from later reconnects (see below).
    hasConnectedRef.current = false;

    socket.on("connect", () => {
      // Join the personal DM room so emitToUser reaches us
      socket.emit("join-dm", currentUserId);
      if (hasConnectedRef.current) {
        // Reconnect after an outage (e.g. server redeploy): DM events sent
        // while we were offline were missed. Refresh the conversation list
        // (unread counts / previews) and re-fetch the open thread so nothing
        // is silently dropped until a manual reload.
        loadConversations();
        if (selectedConvId) loadMessages(selectedConvId);
      }
      hasConnectedRef.current = true;
    });

    socket.on("dm-message", async (msg: Message) => {
      if (!selectedConvId || msg.conversationId !== selectedConvId) {
        /* FIX-DM-SELF: сервер шлёт событие обеим сторонам, включая отправителя.
           Без этой проверки собственное сообщение, отправленное при открытом
           другом диалоге (например, пересылкой) или с другого устройства, ставило
           твоей же переписке метку непрочитанного. Предпросмотр при этом
           обновляем всегда: строка в списке должна показывать последнюю реплику
           независимо от того, кто её написал. */
        const ownMessage = msg.userId === currentUserId;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === msg.conversationId
              ? { ...c, unread: ownMessage ? (c.unread || 0) : (c.unread || 0) + 1, lastMessage: { id: msg.id, content: msg.content, createdAt: msg.createdAt, userId: msg.userId }, lastMessageAt: msg.createdAt }
              : c,
          ),
        );
        return;
      }
      // Decrypt if needed
      // FIX-E2EE: не мутируем объект, пришедший из socket-события (его может
      // переиспользовать Socket.IO при ретрае, а мутация теряет исходный
      // шифртекст). Работаем с новой копией.
      if (isE2EEMessage(msg.content) && myPrivateKey && peerPublicKey) {
        msg = { ...msg, content: await decryptContent(msg.content), _encrypted: true };
      }
      setMessages((prev) => {
        // Already have the real message (e.g. POST response landed first).
        if (prev.some((m) => m.id === msg.id)) return prev;
        // The server echoes our own message back over the socket. If our
        // optimistic placeholder is still in the list, *replace* it instead of
        // appending — otherwise the message shows up twice (the duplicate bug).
        if (msg.userId === currentUserId) {
          const optIdx = prev.findIndex((m) => m.id.startsWith("opt-") && m.userId === currentUserId);
          if (optIdx !== -1) {
            const next = [...prev];
            next[optIdx] = { ...msg, status: "sent" };
            return next;
          }
        }
        return [...prev, msg];
      });
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) {
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
          if (nearBottom) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      });
      // Update conversation preview + clear unread (we're viewing it)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === msg.conversationId
            ? { ...c, unread: 0, lastMessage: { id: msg.id, content: msg.content, createdAt: msg.createdAt, userId: msg.userId }, lastMessageAt: msg.createdAt }
            : c,
        ),
      );
      // Mark read since we're viewing
      fetch("/api/dm/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ conversationId: selectedConvId }),
      }).catch(() => {});
    });

    socket.on("dm-edited", (msg: Message) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
    });

    socket.on("dm-deleted", ({ messageId }: { messageId: string }) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, deleted: true, content: "" } : m)));
    });

    /* ARCHIVE: разговор уничтожен безвозвратно — событие приходит ОБОИМ
       участникам, включая того, кто нажал: у него могла остаться вторая вкладка
       или телефон, где чат всё ещё открыт. Закрываем его и убираем из списка:
       попытка отправить сообщение в несуществующую переписку закончится ошибкой
       без объяснений. */
    socket.on("dm-purged", ({ conversationId }: { conversationId: string }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      setSelectedConvId((prev) => (prev === conversationId ? null : prev));
    });

    /* BUSINESS-LOCK: запрет отправки меняется у обеих сторон сразу. Клиенту это
       важнее всего: иначе он узнал бы о закрытии, только набрав текст и получив
       отказ. */
    socket.on("dm-lock-changed", ({ conversationId, locked }: { conversationId: string; locked: boolean }) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId && c.business ? { ...c, business: { ...c.business, locked } } : c)),
      );
    });

    socket.on("dm-read", ({ userId: readerId, readAt }: { userId: string; readAt: string }) => {
      if (readerId === otherId) setPeerReadAt(readAt);
    });

    socket.on("dm-typing", ({ userId }: { userId: string }) => {
      if (userId === otherId) {
        setTypingName(otherUser?.name || "Собеседник");
        if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
        peerTypingTimer.current = setTimeout(() => setTypingName(null), 3000);
      }
    });

    socket.on("dm-stop-typing", ({ userId }: { userId: string }) => {
      if (userId === otherId) setTypingName(null);
    });

    socket.on("dm-reaction-added", ({ messageId, emoji, userId: uid, userName }: { messageId: string; emoji: string; userId: string; userName: string }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const reactions = m.reactions || [];
          if (reactions.some((r) => r.userId === uid && r.emoji === emoji)) return m;
          const newReaction: DMReaction = { id: `${uid}-${emoji}`, emoji, userId: uid, user: { id: uid, name: userName } };
          return { ...m, reactions: [...reactions, newReaction] };
        }),
      );
    });

    socket.on("dm-reaction-removed", ({ messageId, emoji, userId: uid }: { messageId: string; emoji: string; userId: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id !== messageId ? m : { ...m, reactions: (m.reactions || []).filter((r) => !(r.userId === uid && r.emoji === emoji)) },
        ),
      );
    });

    socket.on("dm-pinned", ({ messageId, pinned }: { messageId: string; pinned: boolean }) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pinned } : m)));
      // Refresh pinned panel if open
      if (showPinned && selectedConvId) {
        fetch(`/api/dm/pin?conversationId=${selectedConvId}`, { credentials: "include" })
          .then((r) => r.json())
          .then((d) => setPinnedMessages(d))
          .catch(() => {});
      }
    });

    socket.on("dm-thread-update", ({ parentMessageId, threadCount }: { parentMessageId: string; threadCount: number }) => {
      setMessages((prev) => prev.map((m) => (m.id === parentMessageId ? { ...m, threadCount } : m)));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, selectedConvId, otherId, otherUser?.name, myPrivateKey, peerPublicKey, decryptContent, showPinned]);

  // ── Typing emitter ──────────────────────────────────────────────────────────
  const emitTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !otherId) return;
    socket.emit("dm-typing", { userId: currentUserId, peerId: otherId });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit("dm-stop-typing", { userId: currentUserId, peerId: otherId });
    }, 2000);
  }, [otherId, currentUserId]);

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if ((!text && pendingAttachments.length === 0) || !selectedConvId) return;

      /* Предел длины проверяем до шифрования и отправки: иначе человек узнаёт о
         нём от сервера, уже набрав весь текст. Считаем по исходному тексту —
         шифротекст длиннее, и мерить в словах его бессмысленно. */
      const lengthError = messageLengthError(text, { premium: isPremiumAccount });
      if (lengthError) {
        showToast(lengthError);
        return;
      }

      setSending(true);

      let finalContent = text;
      let encryptedFlag = false;
      if (e2eeReady && e2eeEnabled && text && !isE2EEMessage(text)) {
        try {
          finalContent = await encryptMessage(text, myPrivateKey!, peerPublicKey!);
          encryptedFlag = true;
        } catch {
          /* fall back to plain */
        }
      }

      const optimisticId = `opt-${Date.now()}`;
      const optimisticMsg: Message = {
        id: optimisticId,
        content: text,
        userId: currentUserId,
        edited: false,
        deleted: false,
        attachments: pendingAttachments.length > 0 ? JSON.stringify(pendingAttachments) : null,
        createdAt: new Date().toISOString(),
        user: {
          id: currentUserId,
          name: "Вы",
          username: "",
          avatar: null,
          role: "user",
          avatarGlowEnabled: false,
          avatarGlowColors: null,
        },
        replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, user: { id: currentUserId, name: replyTo.name } } : null,
        reactions: [],
        _encrypted: encryptedFlag,
        status: "sending",
        conversationId: selectedConvId,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      updateDmDraft("");
      setPendingAttachments([]);
      setReplyTo(null);
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }));

      try {
        const res = await fetch(`/api/dm/${selectedConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            content: finalContent || undefined,
            attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
            replyToId: replyTo?.id,
            encrypted: encryptedFlag,
          }),
        });
        if (!res.ok) {
          // FIX-DM: показываем причину отказа (ЧС, запрет голосовых и т.п.)
          const err = await res.json().catch(() => null);
          updateDmDraft(text);
          showToast((err && typeof err.error === "string" && err.error) || "Не удалось отправить — нажмите resend");
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: "failed" } : m)));
        } else {
          const saved = await res.json();
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...saved, content: text, _encrypted: encryptedFlag, status: "sent" } : m)));
        }
      } catch {
        updateDmDraft(text);
        showToast("Ошибка сети — нажмите resend");
        setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: "failed" } : m)));
      } finally {
        setSending(false);
      }
    },
    [input, pendingAttachments, selectedConvId, e2eeReady, e2eeEnabled, myPrivateKey, peerPublicKey, replyTo, currentUserId, showToast, updateDmDraft, isPremiumAccount],
  );

  // ── Resend a failed message ────────────────────────────────────────────────────
  const resendMessage = useCallback(
    async (messageId: string) => {
      if (!selectedConvId) return;
      const failedMsg = messages.find((m) => m.id === messageId);
      if (!failedMsg) return;
      // Mark as sending again
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "sending" } : m)));
      let finalContent = failedMsg.content;
      let encryptedFlag = failedMsg._encrypted || false;
      if (e2eeReady && e2eeEnabled && finalContent && !isE2EEMessage(finalContent)) {
        try {
          finalContent = await encryptMessage(finalContent, myPrivateKey!, peerPublicKey!);
          encryptedFlag = true;
        } catch {
          /* fall back to plain */
        }
      }
      const attachments = failedMsg.attachments ? JSON.parse(failedMsg.attachments) : undefined;
      try {
        const res = await fetch(`/api/dm/${selectedConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            content: finalContent || undefined,
            attachments,
            replyToId: failedMsg.replyTo?.id,
            encrypted: encryptedFlag,
          }),
        });
        if (!res.ok) {
          showToast("Повторная отправка не удалась");
          setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "failed" } : m)));
        } else {
          const saved = await res.json();
          setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...saved, content: failedMsg.content, _encrypted: encryptedFlag, status: "sent" } : m)));
        }
      } catch {
        showToast("Ошибка сети");
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "failed" } : m)));
      }
    },
    [selectedConvId, messages, e2eeReady, e2eeEnabled, myPrivateKey, peerPublicKey, showToast],
  );

  // ── Voice recording ────────────────────────────────────────�����─────────────────
  /**
   * Отправка записанной заметки — голосовой или квадратного видеосообщения.
   *
   * Вид приходит третьим доводом: от него зависит имя файла и пометка `note`, по
   * которой получатель покажет квадрат, а не обычный проигрыватель. По умолчанию
   * голос — прежние вызовы остаются рабочими.
   */
  const handleVoiceRecorded = useCallback(
    async (blob: Blob, duration: number, kind: MediaNoteKind = "audio") => {
      const conversationId = selectedConvId;
      if (!conversationId) return;
      setVoiceUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", blob, noteFileName(kind, blob.type));
        fd.append("conversationId", conversationId);
        fd.append("duration", String(duration));
        if (kind === "video") fd.append("note", "1");
        const uploadRes = await fetch("/api/messages/upload", { method: "POST", body: fd });
        if (!uploadRes.ok) {
          /* Показываем причину от сервера, а не общую фразу: именно из-за общей
             фразы «не отправляется» баг с типом файла было не видно. */
          const failure = await uploadRes.json().catch(() => null);
          showToast(
            (failure && typeof failure.error === "string" && failure.error) ||
              (kind === "video" ? "Не удалось отправить видеосообщение" : "Ошибка записи голоса"),
          );
          return;
        }
        const attachment = await uploadRes.json();
        await fetch(`/api/dm/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: "", attachments: [attachment] }),
        });
      } finally {
        setVoiceUploading(false);
      }
    },
    [selectedConvId, showToast],
  );

  // ── File upload ────────────────────────────────────────────────────────────────
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const conversationId = selectedConvId;
      if (!conversationId) return;
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      setFileUploading(true);
      try {
        const uploaded: Attachment[] = [];
        // FIX-UPLOAD: загрузка через XHR с прогрессом — композер показывает
        // полоску «имя файла · N%» вместо неинформативного спиннера.
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fd = new FormData();
          fd.append("file", file);
          fd.append("conversationId", conversationId);
          setUploadProgress({ name: file.name, percent: 0, index: i + 1, total: files.length });
          try {
            const res = await uploadWithProgress("/api/messages/upload", fd, (percent) => {
              setUploadProgress({ name: file.name, percent, index: i + 1, total: files.length });
            });
            if (!res.ok) {
              const d = await res.json<{ error?: string }>().catch(() => ({} as { error?: string }));
              showToast(d.error || "Ошибка загрузки файла");
              continue;
            }
            uploaded.push(await res.json<Attachment>());
          } catch {
            showToast("Ошибка загрузки файла");
          }
        }
        if (uploaded.length > 0) setPendingAttachments((prev) => [...prev, ...uploaded]);
      } finally {
        setFileUploading(false);
        setUploadProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [selectedConvId, showToast],
  );

  // ── Geolocation send ──────────────────────────────────────────────────────────
  const [showGeoPicker, setShowGeoPicker] = useState(false);
  const sendGeolocation = useCallback(
    async (lat: number, lng: number, address?: string | null) => {
      if (!selectedConvId) return;
      setShowGeoPicker(false);
      // FIX-GEO: вместе с точкой сохраняем адрес (улица, дом, город) из Google Geocoding.
      const geoAttachment: Attachment = {
        url: `geo:${lat},${lng}`,
        name: address || `Геолокация ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        size: 0,
        type: "application/geo",
        isImage: false,
        isGeo: true,
        lat,
        lng,
        ...(address ? { address } : {}),
      };
      const optimisticId = `opt-${Date.now()}`;
      const optimisticMsg: Message = {
        id: optimisticId,
        content: "",
        userId: currentUserId,
        edited: false,
        deleted: false,
        attachments: JSON.stringify([geoAttachment]),
        createdAt: new Date().toISOString(),
        user: {
          id: currentUserId,
          name: "Вы",
          username: "",
          avatar: null,
          role: "user",
          avatarGlowEnabled: false,
          avatarGlowColors: null,
        },
        replyTo: null,
        reactions: [],
        status: "sending",
        conversationId: selectedConvId,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }));
      try {
        const res = await fetch(`/api/dm/${selectedConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: "", attachments: [geoAttachment] }),
        });
        if (!res.ok) {
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: "failed" } : m)));
          showToast("Не удалось отправить геолокацию");
        } else {
          const saved = await res.json();
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...saved, status: "sent" } : m)));
        }
      } catch {
        setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: "failed" } : m)));
        showToast("Ошибка сети");
      }
    },
    [selectedConvId, showToast],
  );

  const handleTextPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedText = e.clipboardData.getData("text/plain");
      if (!pastedText) return;
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = `${input.slice(0, start)}${pastedText}${input.slice(end)}`;
      updateDmDraft(next);
      emitTyping();
      requestAnimationFrame(() => {
        ta.focus();
        const caret = start + pastedText.length;
        ta.selectionStart = caret;
        ta.selectionEnd = caret;
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
      });
    },
    [input, emitTyping, updateDmDraft],
  );

  const handleComposerFiles = useCallback(async (files: File[]) => {
    const conversationId = selectedConvId;
    if (!conversationId || files.length === 0) return;
    setFileUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("conversationId", conversationId);
        const res = await fetch("/api/messages/upload", { method: "POST", body: fd });
        if (!res.ok) continue;
        uploaded.push(await res.json());
      }
      if (uploaded.length > 0) setPendingAttachments((prev) => [...prev, ...uploaded]);
    } finally {
      setFileUploading(false);
    }
  }, [selectedConvId]);

  // Whole-area drag&drop + paste of files/screenshots (tz-connect-update).
  const dropPaste = useFileDropPaste({ onFiles: handleComposerFiles });

  const handleComposerDrop = useCallback(
    (e: React.DragEvent<HTMLFormElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const text = e.dataTransfer.getData("text/plain");
      const files = Array.from(e.dataTransfer.files || []);
      if (text) updateDmDraft(input ? `${input}\n${text}` : text);
      if (files.length > 0) handleComposerFiles(files);
    },
    [handleComposerFiles, input, updateDmDraft],
  );

  // ── Edit / Delete ───────────────────────────────────────────────────────────
  const startEdit = useCallback((msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  const saveEdit = useCallback(
    async (messageId: string) => {
      if (!selectedConvId || !editContent.trim()) return;
      const prevContent = messages.find((m) => m.id === messageId)?.content;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: editContent } : m)));
      setEditingId(null);
      try {
        const res = await fetch(`/api/dm/${selectedConvId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ messageId, content: editContent }),
        });
        if (!res.ok) {
          showToast("Не удалось сохранить");
          setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: prevContent || "" } : m)));
        }
      } catch {
        showToast("Ошибка сети");
      }
    },
    [selectedConvId, editContent, messages, showToast],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!selectedConvId) return;
      setConfirmDelete(null);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, deleted: true, content: "" } : m)));
      try {
        await fetch(`/api/dm/${selectedConvId}?messageId=${messageId}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch {
        showToast("Не удалось удалить");
      }
    },
    [selectedConvId, showToast],
  );

  // ── E2EE file decryption (for VoicePlayer) ──────────────────────────────────
  const handleDecryptFile = useCallback(
    async (encrypted: ArrayBuffer, iv: string): Promise<ArrayBuffer> => {
      if (!myPrivateKey || !peerPublicKey) return encrypted;
      const { decryptFile } = await import("@/lib/e2ee");
      return decryptFile(encrypted, iv, myPrivateKey, peerPublicKey);
    },
    [myPrivateKey, peerPublicKey],
  );

  // ── Reactions ────────────────────────────────────────────────────────────────
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      // Optimistic
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const reactions = m.reactions || [];
          const exists = reactions.some((r) => r.userId === currentUserId && r.emoji === emoji);
          return {
            ...m,
            reactions: exists
              ? reactions.filter((r) => !(r.userId === currentUserId && r.emoji === emoji))
              : [...reactions, { id: `${currentUserId}-${emoji}`, emoji, userId: currentUserId, user: { id: currentUserId, name: "Вы" } }],
          };
        }),
      );
      try {
        await fetch("/api/dm/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ messageId, emoji }),
        });
      } catch {
        /* server will reconcile via socket */
      }
    },
    [currentUserId],
  );

  // ── Pin ──────────────────────────────────────────────────────────────────────
  const pinMessage = useCallback(
    async (messageId: string) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m)));
      try {
        await fetch("/api/dm/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ messageId }),
        });
      } catch {
        showToast("Не удалось закрепить");
      }
    },
    [showToast],
  );

  const fetchPinnedMessages = useCallback(async () => {
    if (!selectedConvId) return;
    try {
      const res = await fetch(`/api/dm/pin?conversationId=${selectedConvId}`, { credentials: "include" });
      if (res.ok) setPinnedMessages(await res.json());
    } catch {
      /* ignore */
    }
  }, [selectedConvId]);

  // ── Threads ──────────────────────────────────────────────────────────────────
  const openThread = useCallback(
    async (msg: Message) => {
      setActiveThread({ id: msg.id, user: msg.user.name, content: msg.content.slice(0, 100) });
      setThreadInput(localStorage.getItem(`tz-chat-draft:dm-thread:${msg.id}`) ?? "");
      setThreadMessages([]);
      try {
        const res = await fetch(`/api/dm/${selectedConvId}?threadId=${msg.id}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setThreadMessages(data.messages || []);
        }
      } catch {
        /* ignore */
      }
    },
    [selectedConvId],
  );

  const sendThreadReply = useCallback(async () => {
    if (!selectedConvId || !activeThread || !threadInput.trim()) return;
    const text = threadInput.trim();
    setThreadInput("");
    localStorage.removeItem(`tz-chat-draft:dm-thread:${activeThread.id}`);
    const optimistic: Message = {
      id: `opt-thread-${Date.now()}`,
      content: text,
      userId: currentUserId,
      edited: false,
      deleted: false,
      attachments: null,
      createdAt: new Date().toISOString(),
      user: { id: currentUserId, name: "Вы", username: "", avatar: null, role: "user", avatarGlowEnabled: false, avatarGlowColors: null },
      threadId: activeThread.id,
    };
    setThreadMessages((prev) => [...prev, optimistic]);
    try {
      const res = await fetch(`/api/dm/${selectedConvId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: text, threadId: activeThread.id }),
      });
      if (res.ok) {
        const saved = await res.json();
        setThreadMessages((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
      }
    } catch {
      showToast("Ошибка отправки");
    }
  }, [selectedConvId, activeThread, threadInput, currentUserId, showToast]);

  // ── Forward ────────────────────────────────────────────────────────────────
  const openForwardModal = useCallback(async (msg: Message) => {
    // FIX-FWD: сообщения приватного (зашифрованного) чата пересылать нельзя.
    if (msg._encrypted || isE2EEMessage(msg.content)) {
      showToast("Сообщения из приватного чата пересылать нельзя");
      return;
    }
    setForwardMsg({ id: msg.id, content: msg.content, userName: msg.user.name, attachments: msg.attachments ?? null });
    setForwardSearch("");
    // Load targets (channels + conversations)
    try {
      const [channelsRes, dmRes] = await Promise.all([
        fetch("/api/channels", { credentials: "include" }),
        fetch("/api/dm", { credentials: "include" }),
      ]);
      const targets: ForwardTarget[] = [];
      if (channelsRes.ok) {
        const channels = await channelsRes.json();
        const flat = Array.isArray(channels) ? channels : channels.channels || [];
        for (const c of flat) {
          targets.push({ type: "channel", id: c.id, name: c.name, icon: c.icon });
        }
      }
      if (dmRes.ok) {
        const convs = await dmRes.json();
        for (const c of convs) {
          if (c.id !== selectedConvId) targets.push({ type: "dm", id: c.id, name: c.other.name, icon: c.other.avatar });
        }
      }
      setForwardTargets(targets);
    } catch {
      /* ignore */
    }
  }, [selectedConvId, showToast]);

  const doForward = useCallback(
    async (target: { type: "channel" | "dm"; id: string; name: string }) => {
      if (!forwardMsg) return;
      setForwarding(true);
      try {
        // FIX-FWD: ЛС и каналы — разные эндпоинты; вложения сохраняются при пересылке.
        let atts: unknown;
        try {
          atts = forwardMsg.attachments ? JSON.parse(forwardMsg.attachments) : undefined;
        } catch {
          atts = undefined;
        }
        const isChannel = target.type === "channel";
        const res = await fetch(isChannel ? "/api/messages" : `/api/dm/${target.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            isChannel
              ? { content: forwardMsg.content, channelId: target.id, attachments: atts }
              : { content: forwardMsg.content, attachments: atts },
          ),
        }).catch(() => null);
        if (res?.ok) {
          showToast(`Переслано: ${target.name}`);
        } else {
          showToast("Не удалось переслать сообщение");
        }
        setForwardMsg(null);
      } finally {
        setForwarding(false);
      }
    },
    [forwardMsg, showToast],
  );

  // ── Add to Favorites (self-conversation) ──────────────────────────────────────
  const addToFavorites = useCallback(
    async (msg: Message) => {
      try {
        // Find or create the self-conversation (favorites)
        const res = await fetch("/api/dm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userId: currentUserId, isFavorite: true }),
        });
        if (!res.ok) {
          showToast("Не удалось открыть Сейф");
          return;
        }
        const { id: favConvId } = await res.json();
        // Forward the message content into the favorites conversation
        await fetch(`/api/dm/${favConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            content: msg.content,
            attachments: msg.attachments ? JSON.parse(msg.attachments) : undefined,
          }),
        });
        showToast("Добавлено в Сейф");
      } catch {
        showToast("Ошибка при добавлении в Сейф");
      }
    },
    [currentUserId, showToast],
  );

  // ── FIX-VAULT: «Сейф» — избранная переписка с самим собой ──────────────────
  const openVault = useCallback(async () => {
    try {
      const res = await fetch("/api/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId: currentUserId, isFavorite: true }),
      });
      if (!res.ok) {
        showToast("Не удалось открыть Сейф");
        return;
      }
      const { id } = await res.json();
      await loadConversations();
      setSelectedConvId(id);
    } catch {
      showToast("Ошибка сети");
    }
  }, [currentUserId, loadConversations, showToast]);

  // ── Text formatting ───────────────────────────────���──────────────────────────
  const insertFormat = useCallback((prefix: string, suffix: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      updateDmDraft(`${input}${prefix}${suffix}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = input.slice(start, end);
    const next = `${input.slice(0, start)}${prefix}${selected}${suffix}${input.slice(end)}`;
    updateDmDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const caret = start + prefix.length;
      ta.selectionStart = caret;
      ta.selectionEnd = caret + selected.length;
    });
  }, [input, updateDmDraft]);

  // ── Scroll handling ──────────────────────────────────────────────────────────
  /* Считаем не чаще одного раза на кадр: замер высоты заставляет браузер
     пересчитывать раскладку, а событий прокрутки — десятки в секунду.

     Замок синхронный, ref, а не состояние: messagesLoading выставляется
     асинхронно, и при быстром движении вверх успевало уйти несколько запросов
     подряд — страницы приходили вперемешку, лента дёргалась и дублировала
     сообщения. Догрузка начинается за 600 пикселей до верха, чтобы не упираться
     в край. */
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const el = scrollContainerRef.current;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowScrollBtn(!nearBottom && messages.length > 0);
      /* Сначала окно: пока сверху есть загруженные, но не отрисованные строки,
         за новой страницей идти рано. */
      syncWindow();
      if (el.scrollTop < 600 && winHiddenAbove === 0 && hasMore && !loadLockRef.current && selectedConvId) {
        loadLockRef.current = true;
        void loadMessages(selectedConvId, true, nextCursor || undefined).finally(() => {
          setTimeout(() => { loadLockRef.current = false; }, 300);
        });
      }
    });
  }, [hasMore, messages.length, nextCursor, loadMessages, selectedConvId, syncWindow, winHiddenAbove]);

  useEffect(() => () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); }, []);

  /* Возврат позиции после подстановки: именно useLayoutEffect — обычный эффект
     выполняется после отрисовки, и рывок успевает попасть на экран. */
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    const anchor = prependAnchorRef.current;
    if (!el || anchor === null) return;
    prependAnchorRef.current = null;
    el.scrollTop = el.scrollHeight - anchor;
  }, [messages]);

  /**
   * FIX-SCROLLEND: переход в конец переписки по кнопке «вниз».
   *
   * Было `scrollIntoView({ behavior: "smooth" })`, и на длинной переписке это
   * не срабатывало по двум причинам сразу.
   *
   * 1. Плавная прокрутка на десятки тысяч пикселей идёт секунды. Кнопка «в
   *    конец» должна телепортировать: её нажимают именно чтобы не листать.
   *
   * 2. Главное: при уходе вверх хвост ленты вынут из дерева и заменён нижней
   *    распоркой, высота которой — ОЦЕНКА (см. hooks/useMessageWindow).
   *    Прокрутка приезжала в конец распорки, там хвост отрисовывался, оценка
   *    сменялась настоящей высотой — и низ уезжал из-под ног.
   *
   * Поэтому сначала раскрываем хвост, потом доводим до низа по фактической
   * высоте: сразу и ещё раз после отрисовки.
   */
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    revealWindowTail();
    setShowScrollBtn(false);
    el.scrollTop = el.scrollHeight;
    endScrollRef.current = 2;
    requestAnimationFrame(() => {
      endScrollRef.current = 0;
      const node = scrollContainerRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, [revealWindowTail]);

  /* Доводка в layout-эффекте: обычный эффект выполняется после кадра, и
     промежуточное положение успевает мелькнуть на экране. */
  useLayoutEffect(() => {
    if (endScrollRef.current <= 0) return;
    endScrollRef.current -= 1;
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // ── Reply handler ────────────────────────────────────────────────────────────
  const handleReply = useCallback((msg: Message) => {
    setReplyTo({ id: msg.id, name: msg.user.name, content: msg.content.slice(0, 80) || "[вложение]" });
    textareaRef.current?.focus();
  }, []);

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400">
        <span className="text-sm">Загрузка диалогов…</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex h-full overflow-hidden relative">
        {/* COL 2: conversation list */}
        <DMConversationList
          conversations={conversations}
          selectedConv={selectedConvId}
          currentUserId={currentUserId}
          onSelect={setSelectedConvId}
          /* «Сейф» — это личная переписка с самим собой; в деловом разделе ему
             делать нечего. */
          onOpenVault={isBusiness ? undefined : openVault}
          onClose={onClose}
          title={isBusiness ? "Бизнес чат" : "Личные сообщения"}
          emptyText={isBusiness ? businessEmptyText : "Нет диалогов"}
          /* ARCHIVE: архивы разделов не смешиваются: убранная деловая заявка не
             должна влиять на список личных сообщений и наоборот. */
          archiveKind={isBusiness ? "business" : "dm"}
          onPurged={(convId) => {
            setConversations((prev) => prev.filter((c) => c.id !== convId));
            setSelectedConvId((prev) => (prev === convId ? null : prev));
          }}
        />

        {/* COL 3: chat area */}
        {selectedConv && otherUser ? (
          /* PREMIUM-SKIN: тот же фон переписки, что и в каналах сообществ — личные
             сообщения не должны выглядеть чужим окном. */
          <section {...dropPaste.dropProps} className="tz-skin-chat flex-1 flex flex-col h-full bg-[var(--cn-main)] relative min-w-0">
            {dropPaste.isDragOver && (
              <div className="tz-dropzone">Отпустите файлы, чтобы прикрепить</div>
            )}
            {dayNightEnabled && (
              <DayNightBackground opacity={dayNightOpacity / 100} />
            )}
            <DMMessageHeader
              other={otherUser.id === currentUserId ? { ...otherUser, name: "Сейф" } : otherUser}
              subtitle={businessSubtitle}
              e2eeReady={e2eeReady}
              e2eeEnabled={e2eeEnabled}
              showPinned={showPinned}
              onToggleE2EE={() => setChatMode((mm) => (mm === "secure" ? "open" : "secure"))}
              onTogglePinned={() => {
                setShowPinned((v) => !v);
                if (!showPinned) fetchPinnedMessages();
              }}
              onBack={() => setSelectedConvId(null)}
              /* В деловом разговоре меню действий с собеседником не даём: чёрный
                 список и автоответ относятся к человеку, а здесь сторона —
                 администрация. Занести её в ЧС значило бы отрезать себе канал по
                 своей же заявке. */
              onUserMenu={isBusiness ? undefined : (e) => {
                e.preventDefault();
                setUserMenu({ x: e.clientX, y: e.clientY });
              }}
              /* BUSINESS-PAY: undefined в личной переписке — кнопки нет вовсе;
                 null в деловом — кнопка есть и говорит «Не оплачено». */
              paymentStatus={isBusiness ? (payment?.status ?? null) : undefined}
              onOpenPayment={isBusiness ? () => setPaymentOpen(true) : undefined}
            />

            {/* FIX-DM: контекстное меню по нику и модалки */}
            {userMenu && (
              <DMUserContextMenu
                x={userMenu.x}
                y={userMenu.y}
                name={otherUser.name}
                settings={dmSettings}
                onToggleBlacklist={() => { void updateDmSetting({ blacklisted: !dmSettings.blacklisted }); setUserMenu(null); }}
                onToggleVoiceBan={() => { void updateDmSetting({ voiceBan: !dmSettings.voiceBan }); setUserMenu(null); }}
                onShowAttachments={() => { setShowAttachmentsPanel(true); setUserMenu(null); }}
                onShowAutoReply={() => { setShowAutoReply(true); setUserMenu(null); }}
                onClose={() => setUserMenu(null)}
              />
            )}
            {showAttachmentsPanel && selectedConvId && (
              <DMAttachmentsModal
                conversationId={selectedConvId}
                peerName={otherUser.name}
                onClose={() => setShowAttachmentsPanel(false)}
              />
            )}
            {showAutoReply && (
              <DMAutoReplyModal
                peerName={otherUser.name}
                settings={dmSettings}
                onSave={(patch) => updateDmSetting(patch)}
                onClose={() => setShowAutoReply(false)}
              />
            )}

            {/* Pinned panel */}
            <AnimatePresence>
              {showPinned && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-b border-[var(--cn-border)] bg-amber-50/50 dark:bg-amber-400/5 overflow-hidden"
                >
                  <div className="p-3">
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1">
                      <PinIcon size={14} style={{ color: "inherit" }} />
                      Закреплённые сообщения
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {pinnedMessages.length === 0 ? (
                        <p className="text-xs text-neutral-400 text-center py-2">Нет закреплённых</p>
                      ) : (
                        pinnedMessages.map((p) => (
                          <div key={p.id} className="p-2 rounded-lg bg-white/50 dark:bg-white/5 text-xs">
                            <span className="text-neutral-500">{p.user?.name}:</span>{" "}
                            <span className="text-[var(--cn-text)]">{p.content?.slice(0, 80)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>


            {/* Messages */}
            <DMMessageList
              messages={visibleMessages}
              currentUserId={currentUserId}
              selectedConvId={selectedConvId!}
              editingId={editingId}
              editContent={editContent}
              onEditContentChange={setEditContent}
              onSaveEdit={saveEdit}
              onCancelEdit={cancelEdit}
              onReply={handleReply}
              onDelete={(id) => setConfirmDelete(id)}
              onToggleReaction={toggleReaction}
              onPin={pinMessage}
              onOpenThread={openThread}
              onForward={openForwardModal}
              onFavorite={addToFavorites}
              onStartEdit={startEdit}
              /* BUSINESS-PAY: в деловом разговоре убираются «В сейф», «Переслать»
                 и «На доску»: переписка по заявке — документ двух сторон, её не
                 растаскивают по личным хранилищам и публичным доскам. */
              isBusiness={isBusiness}
              peerReadAt={peerReadAt}
              onResend={resendMessage}
              onDecryptFile={handleDecryptFile}
              onImageClick={setLightboxSrc}
              scrollContainerRef={scrollContainerRef}
              messagesEndRef={messagesEndRef}
              onScroll={handleScroll}
              winStart={winStart}
              winEnd={winEnd}
              winPadTop={winPadTop}
              winPadBottom={winPadBottom}
              hasMore={hasMore}
              nextCursor={nextCursor}
              messagesLoading={messagesLoading}
              onLoadMore={() => loadMessages(selectedConvId!, true, nextCursor || undefined)}
              showScrollBtn={showScrollBtn}
              onScrollToBottom={scrollToBottom}
            />

            {/* BUSINESS-LOCK: клиенту при закрытой отправке ввод заменяется
                объяснением. Отказ на отправку он увидел бы только после того, как
                набрал текст, — а это хуже, чем честно закрытое поле. */}
            {lockedForMe ? (
              <div className="border-t border-[var(--cn-border)] px-4 py-4 text-center">
                <p className="text-xs text-[var(--cn-text-dim)]">
                  Администрация закрыла отправку сообщений по этому обращению.
                </p>
                <p className="mt-1 text-[11px] text-[var(--cn-text-dim)]">
                  Переписка остаётся доступной для чтения. Новое обращение открывает новый разговор.
                </p>
              </div>
            ) : (
            <>
            {/* Переключатель у администрации: состояние видно без открытия меню,
                потому что от него зависит, дойдёт ли до клиента ответ. */}
            {canToggleLock && (
              <div className="flex items-center justify-between gap-2 border-t border-[var(--cn-border)] px-3 py-1.5">
                <span className="min-w-0 truncate text-[11px] text-[var(--cn-text-dim)]">
                  {businessLocked ? "Отправка клиенту закрыта — отвечать можно" : "Клиент может писать в этот разговор"}
                </span>
                <button
                  type="button"
                  onClick={() => void toggleLock()}
                  className="shrink-0 rounded-lg border border-[var(--cn-border)] px-2 py-1 text-[11px] text-[var(--cn-text-dim)] transition-colors hover:text-[var(--cn-text)]"
                >
                  {businessLocked ? "Открыть отправку" : "Закрыть отправку"}
                </button>
              </div>
            )}

            <DMMessageComposer
              input={input}
              onInputChange={(v) => {
                updateDmDraft(v);
                emitTyping();
              }}
              onSend={sendMessage}
              onPaste={(e) => dropPaste.handlePaste(e, handleTextPaste)}
              onDrop={handleComposerDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              isDragOver={isDragOver}
              onFileUpload={handleFileUpload}
              fileInputRef={fileInputRef}
              imageInputRef={imageInputRef}
              textareaRef={textareaRef}
              fileUploading={fileUploading}
              uploadProgress={uploadProgress}
              sending={sending}
              voiceUploading={voiceUploading}
              pendingAttachments={pendingAttachments}
              onRemoveAttachment={(i) => setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))}
              onVoiceRecorded={handleVoiceRecorded}
              /* Видеосообщение — только в личной переписке. В деловом чате
                 собеседник — администрация по з��явке, и квадрат с камеры там не
                 к месту; голосовое остаётся. */
              allowVideoNote={!isBusiness}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              showFormatBar={showFormatBar}
              onToggleFormatBar={() => setShowFormatBar((v) => !v)}
              onInsertFormat={insertFormat}
              onOpenGeo={() => setShowGeoPicker(true)}
              typingName={typingName}
              e2eeEnabled={e2eeEnabled && e2eeReady}
              mentionMembers={otherUser ? [{ id: otherUser.id, username: otherUser.username, name: otherUser.name, avatar: otherUser.avatar, lastSeen: otherUser.lastSeen }] : []}
            />
            </>
            )}

            {/* Thread panel */}
            <DMThreadPanel
              activeThread={activeThread}
              threadMessages={threadMessages}
              threadInput={threadInput}
              onThreadInputChange={(v) => {
                setThreadInput(v);
                if (activeThread) {
                  const key = `tz-chat-draft:dm-thread:${activeThread.id}`;
                  if (v) localStorage.setItem(key, v); else localStorage.removeItem(key);
                }
              }}
              onSendThreadReply={sendThreadReply}
              onClose={() => setActiveThread(null)}
            />
          </section>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[var(--cn-main)]">
            <div className="text-center">
              <ChatIcon size={52} className="mx-auto mb-4" tone="muted" />
              <p className="text-sm text-neutral-400">Выберите диалог, чтобы начать общение</p>
            </div>
          </div>
        )}
      </div>

      {/* Image lightbox */}
      <AnimatePresence>
        {lightboxSrc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxSrc(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <img src={lightboxSrc} alt="" className="max-w-full max-h-full rounded-lg" />
            <button
              onClick={() => setLightboxSrc(null)}
              className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
              aria-label="Закрыть"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Forward modal */}
      <ForwardModal
        forwardMsg={forwardMsg ? { content: forwardMsg.content, userName: forwardMsg.userName } : null}
        search={forwardSearch}
        onSearchChange={setForwardSearch}
        targets={forwardTargets}
        sending={forwarding}
        onForward={doForward}
        onClose={() => setForwardMsg(null)}
      />

      {/* Geolocation picker */}
      <GeoPicker
        open={showGeoPicker}
        onClose={() => setShowGeoPicker(false)}
        onSend={sendGeolocation}
      />

      {/* Confirm delete modal */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirmDelete(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-72 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 p-4"
            >
              <p className="text-sm text-neutral-900 dark:text-white mb-4">Удалить сообщение?</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-600 dark:text-gray-300">
                  Отмена
                </button>
                <button onClick={() => deleteMessage(confirmDelete)} className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">
                  Удалить
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BUSINESS-PAY: форма оплаты */}
      <AnimatePresence>
        {paymentOpen && selectedConvId && (
          <BusinessPaymentModal
            conversationId={selectedConvId}
            onClose={() => setPaymentOpen(false)}
            onChanged={setPayment}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
