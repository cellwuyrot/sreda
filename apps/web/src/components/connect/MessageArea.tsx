"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment, memo } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, Dispatch, SetStateAction } from "react";
import Spinner from "@/components/ui/Spinner";
import dynamic from "next/dynamic";
import GeoPicker from "@/components/ui/GeoPicker";
import { motion, AnimatePresence } from "framer-motion";
import { io, Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import Image from "next/image";
import ImageLightbox from "@/components/ui/ImageLightbox";
/* FIX-IMGMENU: правый клик и долгое нажатие на картинке со скачиванием под исходным именем. */
import ImageContextMenu, { useImageContextMenu } from "@/components/ui/ImageContextMenu";
import { playMsgNotification, playMentionNotification } from "@/lib/msgSound";
import GlowAvatar from "@/components/ui/GlowAvatar";
import TypingIndicator from "./TypingIndicator";
import VoiceRecorder from "@/components/ui/VoiceRecorder";
import MediaNoteRecorder from "@/components/ui/MediaNoteRecorder";
import VoicePlayer from "@/components/ui/VoicePlayer";
import VideoPlayer from "@/components/ui/VideoPlayer";
import VideoNotePlayer from "@/components/ui/VideoNotePlayer";
import { useMobile } from "@/hooks/useMobile";
import type { MediaNoteKind } from "@/lib/mediaNote";
import { noteFileName } from "@/lib/mediaNote";
import DayNightBackground from "@/components/connect/DayNightBackground";
import { PlusMenu } from "@/components/connect/ChannelTools";
import { ModuleSettingsButton } from "@/components/connect/ModuleSettingsModal"; // FIX-NEWSGEAR
import type { Message, MessageUser, ForwardTarget } from "./messageTypes";
/* Только тип: он стирается при сборке и не тянет ленту новостей в общий набор
   страницы, ради чего она ниже и подгружается по требованию. */
import type { NewsPost } from "@/components/connect/news/types";
import { parseAttachments, type RoleTag } from "./messageFormat";
import MessageBody from "./MessageBody";
import { messageLengthError, countWords, messageLimits } from "@/lib/messageLimits";
import { hasPremium } from "@/lib/premium";
import { useMessageWindow } from "@/hooks/useMessageWindow";
import ForwardModal from "./ForwardModal";
// FIX-FWDBUF: пересылка через внутренний буфер.
import ForwardPendingBar from "./ForwardPendingBar";
import { formatForwarded, putForward, type ForwardItem } from "@/lib/forwardBuffer";
import MessageHoverToolbar from "./MessageHoverToolbar";
import ThreadPanel from "./ThreadPanel";
import { useFileDropPaste } from "@/hooks/useFileDropPaste";
import { downscaleForChat } from "@/lib/clientImageResize"; // FIX-NOSHARP
import { getDesktopApi } from "@/lib/desktop";
import { fetchAllGroupMembers } from "@/lib/groupMembersFetch";
import { uploadWithProgress } from "@/lib/uploadWithProgress"; // FIX-UPLOAD
import { NewsIcon, ChatIcon, LockIcon, ThreadIcon, CheckIcon, DoubleCheckIcon, XIcon, ClockIcon, MapPinIcon } from "@/components/ui/ConnectIcons";
import { EditIcon } from "@/components/ui/ConnectIconsExtra"; // FIX-ICONS
import { useMentions, MentionPopupList, useRoleTagMentions, TagPopupList } from "@/components/ui/MentionPopup"; // FIX-TAGMENTION
import { TriozEmoji, TriozEmojiButton } from "@/components/ui/TriozEmoji";
import { type GroupEmojiItem } from "./EmojiPicker";
import { notifyExternal } from "@/lib/appNotify"; // ANDROID-NOTIFY
/* FIX-FORMATS: один список типов на клиент и сервер: раньше здесь был свой,
   самый узкий — и архив в канале было просто не выбрать в диалоге файлов. */
import { CHAT_ATTACHMENT_ACCEPT } from "@/lib/attachmentTypes";
import UserContextMenu from "./UserContextMenu";
import LinkPreviewCard, { firstLink } from "./LinkPreviewCard";
// MODERATION: ранги берём из общего модуля — здесь была своя копия карты, и в
// неё успел затесаться ключ SITE_ADMIN, который к групповой роли отношения не
// имеет и потому никогда не срабатывал.
import { rankOf, RANK_MODERATOR } from "@/lib/groupModeration";
import {
  CHAT_APPEARANCE_DEFAULT,
  CHAT_APPEARANCE_EVENT,
  ChatAppearance,
  formatMessageTime,
  loadChatAppearance,
} from "@/lib/chatAppearance";

// Day label for date separators: "Сегодня" / "Вчера" / "21 июня 2026 г."
function getDayLabel(date: Date): string {
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(date, now)) return "Сегодня";
  if (isSameDay(date, yesterday)) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}


const GeoMap = dynamic(() => import("@/components/ui/GeoMap"), { ssr: false });

/* Редактор приложенной картинки открывают редко, а в основном наборе страницы
   он лежал всегда — вместе с холстом и инструментами. Подгружаем по требованию,
   как карту выше. */
const DrawingEditor = dynamic(() => import("@/components/ui/DrawingEditor"), { ssr: false });

/* Лента новостей и редактор поста нужны только в каналах типа NEWS, а таких
   разделов в сообществе один-два на десяток. Подгружаем по требованию — так же,
   как карту и редактор рисунков выше: иначе разбор постов, черновики в
   localStorage и панель разметки ехали бы в общем наборе страницы к каждому, кто
   просто открыл переписку.

   ssr: false — по той же причине, что у соседей: оба компонента с первой же
   отрисовки работают с тем, чего на сервере нет (наблюдатель прокрутки у ленты,
   сохранённый черновик у редактора). */
const NewsFeed = dynamic(() => import("@/components/connect/news/NewsFeed"), { ssr: false });
const NewsComposer = dynamic(() => import("@/components/connect/news/NewsComposer"), { ssr: false });


interface MessageAreaProps {
  channelId: string;
  channelName: string;
  channelIcon: string | null;
  channelType?: string;
  postAccess?: string;
  currentUserId: string;
  currentUserName?: string;
  currentUserRole: string;
  currentUserCommunityRole?: string;
  isBanned: boolean;
  onBack?: () => void;
  onNewMessage?: () => void;
  highlightMessageId?: string | null;
  onHighlightConsumed?: () => void;
  onOpenDm?: (userId: string) => void;
}

// FIX-SEC-XSS: разрешаем в src/href вложений только безопасные схемы. URL
// вложения приходит внутри JSON сообщения (его формирует клиент), поэтому
// нельзя доверять ему вслепую — иначе `javascript:`/`data:` исполнится по клику
// на ссылку или (в части браузеров) при загрузке картинки.
function safeAttachmentUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("/uploads/")) return url;
  try {
    const u = new URL(url, "https://x.invalid");
    if (u.protocol === "http:" || u.protocol === "https:") return url;
  } catch { /* невалидный URL */ }
  return null;
}

/**
 * Почему картинка не открылась.
 *
 * Событие `onError` у <img> причину не сообщает — из него видно только «не
 * загрузилось». А причины разные и лечатся по-разному: файла нет на диске,
 * сессия истекла, нет права на этот файл, оборвалась сеть. Прежняя подпись была
 * одна на все случаи, и по ней нельзя было понять, что делать: ни человеку, ни
 * тому, кто потом разбирается.
 *
 * Спрашиваем статус отдельным запросом — только после неудачи, то есть на
 * исправных картинках лишнего трафика нет.
 */
type ImageFailure = "unknown" | "missing" | "auth" | "forbidden" | "offline";

const IMAGE_FAILURE_TEXT: Record<ImageFailure, string> = {
  missing: "Файл не найден на сервере",
  auth: "Войдите заново, чтобы увидеть вложение",
  forbidden: "Нет доступа к этому вложению",
  offline: "Нет связи с сервером",
  unknown: "Не удалось загрузить изображение",
};

function AttachmentImage({ src, alt, onZoom }: { src: string; alt: string; onZoom: (s: string) => void }) {
  const [failure, setFailure] = useState<ImageFailure | null>(null);
  const safe = safeAttachmentUrl(src);
  /* FIX-IMGMENU: меню живёт на уровне конкретной картинки, а не всего списка:
     так оно знает имя вложения без проброса через всю строку сообщения. */
  const imageMenu = useImageContextMenu();

  const diagnose = useCallback(async (url: string) => {
    setFailure("unknown");
    /* Только для своих файлов: чужой домен на HEAD может ответить чем угодно
       или не ответить вовсе, и толковать этот ответ нам нечем. */
    if (!url.startsWith("/uploads/")) return;
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.status === 404) setFailure("missing");
      else if (res.status === 401) setFailure("auth");
      else if (res.status === 403) setFailure("forbidden");
      else if (res.ok) setFailure("unknown"); // файл на месте — дело в самой картинке
    } catch {
      setFailure("offline");
    }
  }, []);

  if (!safe) return null; // FIX-SEC-XSS: небезопасная схема — не рендерим картинку
  if (failure) {
    return (
      <div className="mt-2 max-w-xs flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs border border-dashed border-neutral-300 dark:border-white/15 text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-white/5">
        <span>{IMAGE_FAILURE_TEXT[failure]}</span>
      </div>
    );
  }
  return (
    <div className="mt-2 max-w-xs">
      <Image
        src={safe} alt={alt} width={320} height={240}
        className="rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity"
        unoptimized
        onError={() => { void diagnose(safe); }}
        onClick={() => onZoom(safe)}
        {...imageMenu.bind(safe, alt)}
      />
      {imageMenu.menu && (
        <ImageContextMenu
          src={imageMenu.menu.src}
          name={imageMenu.menu.name}
          x={imageMenu.menu.x}
          y={imageMenu.menu.y}
          onClose={imageMenu.close}
          onOpen={() => onZoom(safe)}
        />
      )}
    </div>
  );
}

/* PERF-CHAT: строка сообщения вынесена в мемоизированный компонент. Раньше каждый
   введённый в композере символ перерисовывал весь список: для каждого из ~50
   сообщений заново выполнялись renderContent — regex-разметка — и parseAttachments().
   Теперь React.memo пропускает строки с неизменившимися пропсами — при наборе текста,
   тике слоумода и прочих локальных обновлениях список не перерисовывается.
   Вся разметка перенесена из messages.map() дословно. */
/**
 * «:имя:» → имя, иначе null. Реакция своим эмодзи хранится в базе такой же
 * строкой, что и в тексте сообщения, — по ней и отличаем её от символа.
 */
function customEmojiName(value: string): string | null {
  const match = /^:([a-z0-9_]{2,32}):$/.exec(value);
  return match ? match[1] : null;
}

type MessageRowProps = {
  msg: Message;
  /* Настройки внешнего вида, которые нельзя выразить CSS-переменной: они
     меняют не оформление, а состав и формат разметки. */
  prefs: ChatAppearance;
  /** С этого сообщения начинается непрочитанное — рисуем над ним черту. */
  firstUnread: boolean;
  showDateDivider: boolean;
  isGrouped: boolean;
  animate: boolean;
  flashed: boolean;
  editing: boolean;
  editContent: string;
  currentUserId: string;
  isPrivilegedRole: boolean;
  canPin: boolean;
  channelId: string;
  channelName: string;
  channelMembers: { id: string; name: string | null; username?: string | null; avatar?: string | null; lastSeen?: string | null }[];
  /** FIX-TAGMENTION: теги сообщества для подсветки «#тег». Ссылка стабильна
      (useMemo), иначе мемоизация строк перестала бы работать. */
  roleTags: Map<string, RoleTag>;
  /** Свои эмодзи сообщества: имя → адрес картинки. Карта идёт сверху вниз, а не
      берётся модулем-одиночкой: иначе два открытых сообщества делили бы один
      набор, а серверный рендер видел бы пустой. Ссылка стабильна (useMemo). */
  groupEmoji: Map<string, string>;
  /** Тот же набор списком — он нужен окну выбора реакции. */
  groupEmojiList: GroupEmojiItem[];
  ignoredIds: Set<string>;
  revealedIgnored: Set<string>;
  displayName: (u: { id: string; name: string }) => string;
  setReplyTo: (reply: { id: string; name: string; content: string } | null) => void;
  onJumpToMessage: (id: string) => void;
  setEditContent: (value: string) => void;
  setRevealedIgnored: Dispatch<SetStateAction<Set<string>>>;
  setLightboxSrc: Dispatch<SetStateAction<string | null>>;
  openThread: (msg: Message, anchorEl?: HTMLElement | null) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  startEdit: (msg: Message) => void;
  saveEdit: () => void;
  cancelEdit: () => void;
  deleteMessage: (messageId: string) => void;
  pinMessage: (messageId: string) => void;
  openUserCard: (anchor: HTMLElement, msg: Message, hover: boolean) => void;
  cancelUserCardHover: () => void;
};

const MessageRow = memo(function MessageRow({
  msg, prefs, firstUnread, showDateDivider, isGrouped, animate, flashed, editing, editContent, currentUserId, isPrivilegedRole, canPin, channelId, channelName, channelMembers, roleTags, groupEmoji, groupEmojiList, ignoredIds, revealedIgnored, displayName, openUserCard, cancelUserCardHover, setReplyTo, onJumpToMessage, setEditContent, setRevealedIgnored, setLightboxSrc, openThread, toggleReaction, startEdit, saveEdit, cancelEdit, deleteMessage, pinMessage,
}: MessageRowProps) {
  const msgDate = new Date(msg.createdAt);
  /* FIX-EDITBLINK: Сообщение скрыто игнором — вместо содержимого заглушка.
     Признак нужен в двух местах, поэтому считается один раз. */
  const hiddenByIgnore =
    ignoredIds.has(msg.user.id) && !revealedIgnored.has(msg.id) && msg.user.id !== currentUserId;
  /* Цвет первой роли сообщества, у которой он задан. Данные уже приходят в
     сообщении (`groupRoles`) — до этого их использовал только мини-профиль. */
  const roleColor = prefs.nameColor === "role" ? msg.user.groupRoles?.find((r) => r.color)?.color : undefined;
  // `tz-cv-show` снимает content-visibility с подсвеченной (после перехода) строки,
  // чтобы кольцо-обводка при переходе к сообщению не обрезалось paint-containment'ом.
  /* items-start: аватар стоит у первой строки реплики, а не посередине блока.
     У длинного сообщения растянутая колонка уводила его к центру, и связь
     «аватар — начало сообщения» ломалась. */
  const rowClassName = `tz-msg-row ${flashed ? "tz-cv-show " : ""}flex items-start gap-3 group transition-colors duration-500 ${isGrouped ? "mt-1" : showDateDivider ? "" : "mt-3"} ${msg.pinned ? "bg-amber-50/50 dark:bg-amber-400/5 px-2 py-1 rounded-lg" : ""} ${flashed ? "rounded-lg ring-2 ring-violet-400 dark:ring-cyan-400 bg-violet-50/70 dark:bg-cyan-400/10 px-2 py-1" : ""}`;
  // PERF-CHAT: анимируем «въезд» только у самого свежего (только что пришедшего)
  // сообщения. Раньше каждая из тысяч строк была motion-компонентом framer-motion —
  // это тысячи VisualElement'ов, тяжёлых по памяти и на монтировании. Бэклог теперь
  // рендерится обычными <div>, а живое сообщение по-прежнему плавно появляется.
  const rowInner = (
    <>
              {!msg.deleted && (
                <MessageHoverToolbar
                  message={{ id: msg.id, content: msg.content, attachments: parseAttachments(msg.attachments).map((a) => ({ url: a.url, name: a.name, mime: a.type })) }}
                  canEdit={msg.user.id === currentUserId}
                  canDelete={msg.user.id === currentUserId || isPrivilegedRole}
                  pinned={msg.pinned}
                  onReply={() => setReplyTo({ id: msg.id, name: msg.user.name, content: msg.content.slice(0, 50) })}
                  onThread={() => openThread(msg, document.getElementById(`msg-${msg.id}`))}
                  threadCount={msg._count?.threadReplies || msg.threadCount || 0}
                  onReact={(emoji) => toggleReaction(msg.id, emoji)}
                  groupEmojis={groupEmojiList}
                  onEdit={() => startEdit(msg)}
                  onDelete={() => deleteMessage(msg.id)}
                  onPin={canPin ? () => pinMessage(msg.id) : undefined}
                  boardContext={{ authorName: msg.user.name, channelName, channelId }}
                  /* FIX-FWDBUF: в каналах кнопки пересылки раньше вообще не было —
                     окно со списком открыть было неоткуда. Теперь пересылка одинаковая
                     в каналах и ЛС: сообщение в буфер, дальше — «Переслать сюда». */
                  onForward={() =>
                    putForward({
                      content: msg.content,
                      userName: msg.user.name,
                      attachments: msg.attachments ?? null,
                    })
                  }
                />
              )}
              {isGrouped ? (
                <div className="w-9 flex-shrink-0 flex items-start justify-end pr-0.5 pt-0.5 select-none">
                  <span className="text-[10px] leading-none text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                    {formatMessageTime(msgDate, prefs.timeFormat)}
                  </span>
                </div>
              ) : (
                /* Аватар открывает одно окно на всё: и мини-профиль, и
                   действия. Раньше наведение показывало отдельную карточку
                   MiniProfile, а правая кнопка — меню, и они налезали друг на
                   друга. */
                <button
                  type="button"
                  aria-label={`Открыть карточку пользователя ${msg.user.name}`}
                  className="tz-msg-avatar inline-block self-start rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400"
                  onMouseEnter={(e) => openUserCard(e.currentTarget, msg, true)}
                  onMouseLeave={cancelUserCardHover}
                  onClick={(e) => { e.stopPropagation(); openUserCard(e.currentTarget, msg, false); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openUserCard(e.currentTarget, msg, false); }}
                >
                  <GlowAvatar user={msg.user} size={36} />
                </button>
              )}
              <div className="flex-1 min-w-0 relative">
                {/* Pin indicator */}
                {msg.pinned && (
                  <div className="flex items-center gap-1 text-[10px] text-amber-500 mb-0.5">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M5 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H7a2 2 0 01-2-2V5zm0 8l3.5-1.5L10 14l1.5-2.5L15 13v2H5v-2z" /></svg>
                    Закреплено
                  </div>
                )}

                {/* Reply reference — клик ведёт к исходному сообщению (FIX-JUMP). */}
                {msg.replyTo && (
                  <button
                    type="button"
                    onClick={() => { if (msg.replyTo) onJumpToMessage(msg.replyTo.id); }}
                    title="Перейти к сообщению"
                    className="inline-flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-gray-400 mb-1 border-l-2 border-violet-400 dark:border-cyan-400 pl-2 pr-2 py-0.5 rounded-r-md bg-violet-50/60 dark:bg-cyan-400/[0.06] max-w-fit text-left cursor-pointer hover:bg-violet-100 dark:hover:bg-cyan-400/[0.12] transition-colors"
                  >
                    <span className="font-semibold text-violet-600 dark:text-cyan-300">{msg.replyTo.user.name}:</span>
                    <span className="truncate max-w-[240px]">{msg.replyTo.content}</span>
                  </button>
                )}

                {!isGrouped && <div className="flex items-baseline gap-2 flex-wrap">
                  {/* Имя автора — заголовок реплики, а не часть текста: класс
                      tz-chat-author задаёт размер и вес, и оба правятся в
                      «Настройки → TZ.Connect → Кастомизация чата».
                      Цвет берётся у первой роли сообщества, если у неё он
                      задан — так имя различимо по цвету, а палитру выбирает
                      владелец сообщества, а не мы. */}
                  <span
                    className="tz-chat-author text-neutral-900 dark:text-white"
                    style={roleColor ? { color: roleColor } : undefined}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openUserCard(e.currentTarget, msg, false); }}
                  >{displayName(msg.user)}</span>
                  {prefs.showUsername && msg.user.username && (
                    <span className="text-xs text-neutral-400 dark:text-gray-500">@{msg.user.username}</span>
                  )}
                  {prefs.showRoleTags && msg.user.groupRoles?.map((r) => (
                    <span
                      key={r.name}
                      className="text-[10px] leading-none px-1.5 py-0.5 rounded-md border"
                      style={{ color: r.color, borderColor: `${r.color}55`, background: `${r.color}14` }}
                    >{r.name}</span>
                  ))}
                  {/* Ник и роли из шапки сообщения убраны: в ленте они занимали
                      половину строки и повторялись у каждого автора. Всё это
                      показывает мини-профиль по правому клику, причём роль там
                      своя для каждого сообщества. */}
                  <span className="text-xs text-neutral-400 dark:text-gray-600">
                    {formatMessageTime(msgDate, prefs.timeFormat)}
                  </span>
                  {msg.user.id === currentUserId && !msg.deleted && (() => {
                    const readCount = (msg.reads || []).filter(r => r.userId !== currentUserId).length;
                    return (
                      <span className="text-[11px] text-neutral-400 inline-flex items-center gap-0.5" title={`Прочитано: ${readCount}`}>
                        {readCount > 0
                          ? <span className="text-violet-500 dark:text-cyan-400 inline-flex items-center gap-0.5"><DoubleCheckIcon size={13} style={{ color: "inherit" }} /> {readCount}</span>
                          : <CheckIcon size={13} style={{ color: "inherit" }} />}
                      </span>
                    );
                  })()}
                  {(msg.edited || msg.editedAt) && (
                    <span className="text-[10px] text-neutral-400" title={msg.editedAt ? `Изменено ${new Date(msg.editedAt).toLocaleString("ru-RU")}` : "Сообщение изменено"}>изм.</span>
                  )}
                </div>}

                {editing ? (
                  <div className="mt-1 space-y-1">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                        if (e.key === "Escape") cancelEdit();
                      }}
                      rows={Math.min(6, Math.max(1, editContent.split("\n").length))}
                      className="w-full bg-[var(--cn-accent-dim)] border border-[var(--cn-border)] rounded-lg px-3 py-1.5 text-sm text-neutral-900 dark:text-white resize-none break-words whitespace-pre-wrap focus:outline-none focus:ring-1 focus:ring-violet-500 dark:focus:ring-cyan-400"
                      style={{ minHeight: 32 }}
                      autoFocus
                    />
                    <div className="flex gap-2 items-center">
                      <button onClick={saveEdit} className="text-xs text-green-500 hover:underline">Сохранить</button>
                      <button onClick={cancelEdit} className="text-xs text-neutral-400 hover:underline">Отмена</button>
                      <span className="text-[10px] text-neutral-400 ml-auto">Enter — сохранить · Shift+Enter — новая строка</span>
                    </div>
                  </div>
                ) : hiddenByIgnore ? (
                  // Messages from ignored users collapse into a skeleton; a
                  // click reveals the single message.
                  <div
                    className="mt-1 max-w-[420px] cursor-pointer select-none"
                    title="Пользователь игнорируется — нажмите, чтобы показать сообщение"
                    onClick={() => setRevealedIgnored((prev) => new Set(prev).add(msg.id))}
                  >
                    <div className="space-y-1.5">
                      <div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-white/10 animate-pulse" />
                      <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-white/10 animate-pulse" />
                    </div>
                    <span className="mt-1 inline-block text-[10px] text-neutral-400">Сообщение скрыто (игнорируется)</span>
                  </div>
                ) : (
                  msg.content && (
                      /* Не <p>: в тексте теперь бывают блоки — код и свёрнутое
                         длинное сообщение, — а абзац блочные элементы внутри
                         себя не допускает, браузер разорвал бы разметку. */
                      <div data-i18n-skip className="tz-chat-body text-neutral-700 dark:text-gray-300 mt-0.5 break-words whitespace-pre-wrap">
                        {/* Длинное сообщение показывается свёрнутым — см. MessageBody. */}
                        <MessageBody text={msg.content} options={{ roleTags, emoji: groupEmoji }} />
                        {isGrouped && (msg.edited || msg.editedAt) && (
                          <span className="ml-1.5 text-[10px] text-neutral-400" title={msg.editedAt ? `Изменено ${new Date(msg.editedAt).toLocaleString("ru-RU")}` : "Сообщение изменено"}>изм.</span>
                        )}
                      </div>
                    )
                )}

                {/* FIX-EDITBLINK: вложения живут ВНЕ ветки редактирования.
                    Раньше они стояли внутри неё, и переключение «читаю →
                    редактирую → сохранил» снимало их с дерева и вешало заново.
                    Для React это новый узел, для браузера — новая картинка:
                    она перерисовывается с нуля, и это видно как мигание. Заодно
                    во время правки сообщения его картинки были не видны — а
                    правят как раз подпись к ним.

                    Превью ссылки лежит здесь же и по той же причине: при
                    монтировании оно заново ходит за описанием страницы.

                    Скрытые игнором сообщения остаются заглушкой: вложения там
                    показывать нельзя, в этом и смысл. */}
                {!hiddenByIgnore && (
                  <>
                    {parseAttachments(msg.attachments).map((att, i) => (
                      att.isGeo && att.lat != null && att.lng != null ? (
                      <div key={i} className="mt-1 w-[220px] rounded-xl overflow-hidden border border-[var(--cn-border)]">
                        <GeoMap lat={att.lat} lng={att.lng} height={140} interactive={false} />
                        {/* FIX-GEO: показываем адрес (улица, дом, город), если он определён */}
                        <div className="px-2 py-1 text-xs text-neutral-500 dark:text-gray-400 flex items-center gap-1"><MapPinIcon size={12} style={{ color: "inherit" }} /> {att.address || `${att.lat.toFixed(4)}, ${att.lng.toFixed(4)}`}</div>
                      </div>
                    ) : att.isVoice ? (
                        <div key={i} className="mt-1.5">
                          <VoicePlayer url={att.url} duration={att.duration} />
                        </div>
                      ) : att.isVideoNote ? (
                        /* Видеосообщение — квадрат, играет по касанию. */
                        <VideoNotePlayer key={i} url={att.url} duration={att.duration} />
                      ) : att.isVideo ? (
                        /* Обычное видео. Ветки для него здесь не было вовсе:
                           видео в канале выводилось ссылкой на файл, хотя сервер
                           давно отдаёт признак. */
                        <VideoPlayer key={i} url={att.url} />
                      ) : att.isImage ? (
                        <AttachmentImage key={i} src={att.url} alt={att.name} onZoom={setLightboxSrc} />
                      ) : (
                        (() => {
                          // FIX-SEC-XSS: ссылка-вложение только при безопасной схеме URL;
                          // иначе показываем имя файла как обычный текст (без href).
                          const safe = safeAttachmentUrl(att.url);
                          const inner = (<>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            {att.name} ({Math.round(att.size / 1024)}KB)
                          </>);
                          return safe ? (
                            <a key={i} href={safe} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-violet-500 dark:text-cyan-400 hover:underline">{inner}</a>
                          ) : (
                            <span key={i} className="mt-1 inline-flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400" title="Небезопасная ссылка">{inner}</span>
                          );
                        })()
                      )
                    ))}
                    {/* Превью первой ссылки в сообщении. Разворачиваем одну:
                        сообщение с десятком ссылок иначе растянулось бы на
                        весь экран. */}
                    {prefs.linkPreviews && msg.content && !msg.deleted && (() => {
                      const link = firstLink(msg.content);
                      return link ? <LinkPreviewCard url={link} /> : null;
                    })()}
                  </>
                )}

                {/* Reactions display */}
                {msg.reactions && msg.reactions.length > 0 && !msg.deleted && (
                  <div className="tz-reaction-row mt-1.5">
                    {Object.entries(msg.reactions.reduce<Record<string, { count: number; userReacted: boolean }>>((acc, r) => {
                      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, userReacted: false };
                      acc[r.emoji].count++;
                      if (r.userId === currentUserId) acc[r.emoji].userReacted = true;
                      return acc;
                    }, {})).map(([emoji, data]) => (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(msg.id, emoji)}
                        /* FIX-EMOJI: выравнивание живёт в tz-reaction-pill, а не здесь.
                           `text-xs` давал line-height 16px вокруг глифа 20px — холст не
                           помещался в строку и срезался сверху и снизу. Размер текста
                           задаём без line-height (`text-[12px]`), высоту считает глиф. */
                        className={`tz-reaction-pill px-2 py-1 rounded-full text-[12px] border transition-colors ${
                          data.userReacted
                            ? "bg-violet-50 dark:bg-cyan-400/10 border-violet-200 dark:border-cyan-400/30 text-accent"
                            : "bg-[var(--cn-accent-dim)] border-[var(--cn-border)] text-neutral-500 hover:bg-[var(--cn-hover)]"
                        }`}
                      >
                        {/* Реакция может быть своим эмодзи сообщества: в базе она
                            лежит строкой «:имя:», а рисуется картинкой набора. */}
                        {customEmojiName(emoji) && groupEmoji.get(customEmojiName(emoji)!)
                          /* eslint-disable-next-line @next/next/no-img-element */
                          ? <img src={groupEmoji.get(customEmojiName(emoji)!)} alt={emoji} title={emoji} width={20} height={20} loading="lazy" decoding="async" style={{ width: 20, height: 20 }} className="tz-emoji" draggable={false} />
                          : <TriozEmoji emoji={emoji} size={20} />}
                        <span className="tz-reaction-count">{data.count}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Thread indicator */}
                {(msg._count?.threadReplies || msg.threadCount || 0) > 0 && (
                  <button onClick={(e) => openThread(msg, e.currentTarget)} className="text-[11px] text-violet-500 dark:text-cyan-400 mt-0.5 hover:underline inline-flex items-center gap-1">
                    <ThreadIcon size={13} style={{ color: "inherit" }} /> {msg._count?.threadReplies || msg.threadCount} ответов
                  </button>
                )}

              </div>
    </>
  );

  return (
    <Fragment>
      {/* Черта «Непрочитанные». Лента и так прокручивается к первому
          непрочитанному, но без метки непонятно, где кончается прочитанное:
          человек видит середину переписки и не знает, вверх ему читать или
          вниз. Красная, чтобы отличаться от разделителя дат. */}
      {firstUnread && (
        <div className="flex items-center gap-3 mt-4 mb-1">
          <div className="flex-1 h-px bg-red-400/60" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-red-500 dark:text-red-400">
            Непрочитанные
          </span>
          <div className="flex-1 h-px bg-red-400/60" />
        </div>
      )}
      {showDateDivider && (
        <div className="flex items-center gap-3 mt-4 mb-1 first:mt-0">
          <div className="flex-1 h-px bg-[var(--cn-border)]" />
          <span className="text-[11px] font-semibold text-neutral-500 dark:text-gray-400 px-3 py-1 rounded-full bg-[var(--cn-card)] border border-[var(--cn-border)]">
            {getDayLabel(msgDate)}
          </span>
          <div className="flex-1 h-px bg-[var(--cn-border)]" />
        </div>
      )}
      {animate ? (
        <motion.div
          id={`msg-${msg.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className={rowClassName}
        >
          {rowInner}
        </motion.div>
      ) : (
        <div id={`msg-${msg.id}`} className={rowClassName}>
          {rowInner}
        </div>
      )}
    </Fragment>
  );
});

export default function MessageArea({
  channelId, channelName, channelIcon, channelType = "TEXT", postAccess = "ALL", currentUserId, currentUserName = "", currentUserRole, currentUserCommunityRole = "MEMBER", isBanned, onBack, onNewMessage, highlightMessageId, onHighlightConsumed, onOpenDm,
}: MessageAreaProps) {
  /* Роль аккаунта и подписка — из сессии: currentUserRole в пропсах это роль в
     сообществе, к тарифу она отношения не имеет. */
  const { data: session } = useSession();
  /* FIX-FEED: улучшенный чат рисуется той же лентой, что новости, но писать в
     него могут все участники — ограничение по роли ниже к нему не применяется. */
  const isFeedChannel = channelType === "FEED";
  const isNewsChannel = channelType === "NEWS" || isFeedChannel;
  const isOwnerAdmin = currentUserRole === "OWNER" || currentUserRole === "ADMIN" || currentUserRole === "SITE_ADMIN";
  const isPrivilegedRole = isOwnerAdmin || currentUserRole === "MODERATOR";
  const canWriteNews = isNewsChannel && (isFeedChannel || isPrivilegedRole);
  // Unified write-access gate (NEWS channels + block-level postAccess)
  //
  // FIX-NEWSACL: явно заданный postAccess проверяется ПЕРВЫМ. Раньше ветка
  // новостей стояла раньше и «съедала» более строгую настройку: для канала с
  // postAccess=ADMIN модератор проходил проверку в интерфейсе, писал сообщение
  // и получал отказ от сервера (getChannelPermissions строже). Теперь
  // интерфейс и сервер решают одинаково.
  let canPost = true;
  let readOnlyNotice = "";
  if (postAccess === "ADMIN" && !isOwnerAdmin) {
    canPost = false;
    readOnlyNotice = "Раздел только для чтения — публикует создатель или администратор";
  } else if (postAccess === "MOD" && !isPrivilegedRole) {
    canPost = false;
    readOnlyNotice = "Писать в этот раздел могут только администраторы и модераторы";
  } else if (isNewsChannel && !isFeedChannel && !canWriteNews) {
    // Канал новостей без явной настройки: прежнее поведение — модераторы+.
    canPost = false;
    readOnlyNotice = "Канал новостей — писать могут только администраторы и модераторы";
  }

  /* ── Новости ──────────────────────────────────────────────────────────────
     Право публиковать здесь не вычисляется по роли ещё раз: его вместе с первой
     страницей присылает сервер, а лента передаёт наверх (onCanPostChange). Роль
     в пропсах — только то, что известно клиенту о канале вообще, и она уже
     разошлась бы с сервером, например у автора собственного поста. Пока ответ
     не пришёл, кнопки нет: показать её и получить отказ хуже, чем показать
     секундой позже.

     newsRefresh — счётчик, а не флаг: лента перечитывает первую страницу на
     любое изменение числа, поэтому две публикации подряд не сливаются в одну. */
  const [newsCanPost, setNewsCanPost] = useState(false);
  const [newsComposerOpen, setNewsComposerOpen] = useState(false);
  /* Пост, который правят. Отдельно от newsComposerOpen: у редактора это разные
     состояния (создание против правки), а один флаг на двоих означал бы, что
     после закрытия правки «Написать» открывает редактор с чужим текстом. */
  const [newsEditPost, setNewsEditPost] = useState<NewsPost | null>(null);
  const [newsRefresh, setNewsRefresh] = useState(0);

  /* Смена канала: право забываем до ответа сервера. Компонент при переходе не
     размонтируется, и без сброса в новом разделе на секунду висела бы кнопка
     «Написать», доставшаяся от прежнего — с отказом по нажатию. Правка тоже
     сбрасывается: пост из прежнего раздела к новому отношения не имеет. */
  useEffect(() => {
    setNewsCanPost(false);
    setNewsComposerOpen(false);
    setNewsEditPost(null);
  }, [channelId]);

  /* Закрытие редактора одно на оба случая: не сними здесь правку — следующее
     «Написать» открыло бы редактор с прошлым постом. */
  const closeNewsComposer = useCallback(() => {
    setNewsComposerOpen(false);
    setNewsEditPost(null);
  }, []);

  const currentUserIdRef = useRef(currentUserId);
  const currentUserNameRef = useRef(currentUserName);
  const onNewMessageRef = useRef(onNewMessage);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);
  useEffect(() => { currentUserNameRef.current = currentUserName; }, [currentUserName]);
  useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  /* Тариф обрезал историю: сервер присылает число дней, чтобы подпись в чате не
     расходилась с фактическим фильтром (см. lib/premiumLimits). */
  const [forwardToast, setForwardToast] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<{ content: string; userName: string } | null>(null);
  const [forwardTargets, setForwardTargets] = useState<ForwardTarget[]>([]);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardSending, setForwardSending] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // FIX-UPLOAD: прогресс текущей загрузки файла для полоски над формой.
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number; index: number; total: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ReturnType<typeof parseAttachments>>([]);
  // FIX-DRAW: индекс приложенной картинки, открытой в редакторе рисунков
  const [editingAttachment, setEditingAttachment] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // FIX-DND: подсветка формы сбрасывается, если drag завершился вне зоны
  // (Esc, отпускание за окном) — иначе рамка «для файлов» оставалась висеть.
  useEffect(() => {
    if (!isDragOver) return;
    const reset = () => setIsDragOver(false);
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("mousemove", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("mousemove", reset);
    };
  }, [isDragOver]);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  /* CENSOR: карточка о рамках приличия. Показывается только отправителю и только
     на несколько секунд — это напоминание, а не наказание. Запрет отправки идёт
     обычным отказом (красный тост), здесь же сообщение ушло. */
  const [censorNotice, setCensorNotice] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [toolsRefresh, setToolsRefresh] = useState(0);
  const [channelMembers, setChannelMembers] = useState<{id:string;name:string|null;username?:string|null;avatar?:string|null;lastSeen?:string|null}[]>([]);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showPinned, setShowPinned] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [activeThread, setActiveThread] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadInput, setThreadInput] = useState("");
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadSending, setThreadSending] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  // FIX-THREAD: экранная точка привязки всплывающего окна ветки
  const [threadAnchor, setThreadAnchor] = useState<{ x: number; y: number } | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const threadReplyIdsRef = useRef<Set<string>>(new Set());
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduledList, setScheduledList] = useState<{ id: string; content: string; scheduledAt: string; channel?: { name: string } }[]>([]);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [slowmodeWait, setSlowmodeWait] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /* Узкий экран — значит телефон, в том числе оболочка Android. От этого зависит
     только одно: какая запись голоса стоит в строке ввода (см. ниже). */
  const isMobileViewport = useMobile();
  /** Предел длины зависит от подписки: без неё он вдвое меньше. */
  const isPremiumAccount = hasPremium(session?.user);
  const limits = messageLimits(isPremiumAccount);
  /** Длина набранного в словах — для счётчика и блокировки отправки. */
  const composerWords = useMemo(() => countWords(newMessage), [newMessage]);
  const composerOverLimit = composerWords > limits.words || newMessage.length > limits.chars;
  useEffect(() => { activeThreadIdRef.current = activeThread?.id ?? null; }, [activeThread]);

  // Keep an unsent draft per channel. Drafts are silent and local to this
  // browser; a successful send removes them.
  const channelDraftKey = `tz-chat-draft:channel:${channelId}`;
  useEffect(() => {
    setNewMessage(localStorage.getItem(channelDraftKey) ?? "");
    /* MOBILE-UI: на таче не фокусируем композер автоматически — иначе при
       каждом входе в канал выпрыгивает клавиатура и закрывает половину чата. */
    requestAnimationFrame(() => {
      if (!window.matchMedia("(hover: none)").matches) textareaRef.current?.focus();
    });
  }, [channelDraftKey]);

  // PERF-CHAT: черновик пишется в localStorage с дебаунсом 300 мс, а не синхронно
  // на каждый символ. Очистка (отправка сообщения) сбрасывается немедленно,
  // «хвост» дописывается при закрытии вкладки, смене канала и размонтировании.
  const draftSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDraftRef = useRef<string | null>(null);
  const flushDraft = useCallback(() => {
    if (draftSaveTimerRef.current) { clearTimeout(draftSaveTimerRef.current); draftSaveTimerRef.current = null; }
    const value = pendingDraftRef.current;
    if (value === null) return;
    pendingDraftRef.current = null;
    if (value) localStorage.setItem(channelDraftKey, value);
    else localStorage.removeItem(channelDraftKey);
  }, [channelDraftKey]);
  useEffect(() => {
    window.addEventListener("beforeunload", flushDraft);
    return () => {
      window.removeEventListener("beforeunload", flushDraft);
      flushDraft();
    };
  }, [flushDraft]);
  const updateChannelDraft = useCallback((value: string) => {
    setNewMessage(value);
    pendingDraftRef.current = value;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    if (!value) flushDraft();
    else draftSaveTimerRef.current = setTimeout(flushDraft, 300);
  }, [flushDraft]);

  // FIX-COMPOSER: авто-высота поля ввода следует за текстом при ЛЮБОМ его
  // изменении, включая программные (отправка, смена канала, черновики).
  // После отправки длинного сообщения поле возвращается к обычной высоте.
  // PERF-CHAT: это единственное место пересчёта высоты — дубли в onChange и paste убраны.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [newMessage]);

  // ── Right-click user menu, local nicknames and the ignore list ──
  const [userMenu, setUserMenu] = useState<{ user: MessageUser; msg: Message; x: number; y: number; hover: boolean } | null>(null);

  /* Одно окно на мини-профиль и действия. Таймеры держит здесь родитель, а не
     карточка: закрывать нужно тогда, когда курсор ушёл И с аватара, И с самой
     карточки, а знать про оба места может только общий владелец. Открытая
     кликом карточка по уходу курсора не закрывается — её закрывают щелчком
     мимо или Escape. */
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCardTimer = useCallback(() => {
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = null;
  }, []);
  useEffect(() => () => {
    if (cardTimer.current) clearTimeout(cardTimer.current);
  }, []);

  const openUserCard = useCallback((anchor: HTMLElement, msg: Message, hover: boolean) => {
    clearCardTimer();
    const r = anchor.getBoundingClientRect();
    const place = () => setUserMenu({ user: msg.user, msg, x: r.right + 8, y: r.top, hover });
    if (hover) cardTimer.current = setTimeout(place, 350);
    else place();
  }, [clearCardTimer]);

  const cancelUserCardHover = useCallback(() => {
    clearCardTimer();
    /* Пауза перед закрытием: между аватаром и карточкой есть зазор, и без неё
       карточка захлопывалась бы ровно в тот момент, когда к ней тянутся. */
    cardTimer.current = setTimeout(() => {
      setUserMenu((current) => (current && current.hover ? null : current));
    }, 220);
  }, [clearCardTimer]);
  const [localNicks, setLocalNicks] = useState<Record<string, string>>({});

  /* Настройки внешнего вида чата. Читаются после монтирования: на сервере
     localStorage нет, а расхождение разметки дало бы ошибку гидратации.
     Подписка на событие нужна, чтобы правки в настройках были видны сразу, без
     перезагрузки страницы. */
  /* Граница непрочитанного запоминается при открытии канала и дальше не
     пересчитывается: сообщения помечаются прочитанными сразу после показа, и
     живой расчёт стирал бы черту через мгновение после того, как её увидели. */
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);

  const [chatPrefs, setChatPrefs] = useState<ChatAppearance>(CHAT_APPEARANCE_DEFAULT);
  /* Тот же объект в ref: эффект автопрокрутки читает настройку, но не должен
     перезапускаться из-за неё — у него свой список зависимостей, и лишний
     прогон означал бы рывок ленты в момент правки настроек. */
  const chatPrefsRef = useRef<ChatAppearance>(CHAT_APPEARANCE_DEFAULT);
  useEffect(() => {
    const store = (next: ChatAppearance) => { chatPrefsRef.current = next; setChatPrefs(next); };
    store(loadChatAppearance());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ChatAppearance>).detail;
      if (next) store(next);
    };
    window.addEventListener(CHAT_APPEARANCE_EVENT, onChange);
    return () => window.removeEventListener(CHAT_APPEARANCE_EVENT, onChange);
  }, []);

  /* «Ответить» ставил только плашку над полем ввода, а курсор оставался там,
     где был: приходилось лишний раз целиться мышью в поле. Фокус переезжает
     сам и без настройки — выбирать тут нечего, обратный вариант никому не
     нужен: нажатие «Ответить» и означает намерение печатать ответ. */
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [revealedIgnored, setRevealedIgnored] = useState<Set<string>>(new Set());
  /* Набор своих эмодзи сообщества: один запрос на сообщество, а не на
     сообщение — по этой карте разбор разметки подставляет картинки. */
  const [groupEmojis, setGroupEmojis] = useState<GroupEmojiItem[]>([]);
  /* Идентификатор сообщества отдельно в ref: им пользуется обработчик события
     сокета, а зависеть от состояния он не может — иначе соединение
     пересоздавалось бы при каждом обновлении снимка сообщества. */
  const groupIdRef = useRef<string | null>(null);
  const [groupMeta, setGroupMeta] = useState<{
    groupId: string;
    roles: { id: string; name: string; color: string }[];
    members: { id: string; userId: string; role: string; roleIds: string[] }[];
  } | null>(null);

  useEffect(() => {
    try { setLocalNicks(JSON.parse(localStorage.getItem("tz-local-nicknames") ?? "{}")); } catch { /* ignore */ }
  }, []);

  /* MODERATION: список игнорируемых приходит с сервера. Раньше он лежал в
     localStorage этой вкладки — терялся при очистке браузера, не переезжал на
     другое устройство и не действовал в десктоп-клиенте. Игнор — единственная
     защита обычного участника, и терять её при переустановке браузера
     неправильно. Локальный ключ читаем один раз и переносим наверх, чтобы у
     тех, кто уже кого-то скрыл, список не обнулился. */
  useEffect(() => {
    let alive = true;
    const migrateLocal = async () => {
      let legacy: string[] = [];
      try { legacy = JSON.parse(localStorage.getItem("tz-ignored-users") ?? "[]"); } catch { /* ignore */ }
      if (!Array.isArray(legacy) || legacy.length === 0) return;
      await Promise.all(legacy.map((id) =>
        fetch("/api/ignores", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: id }),
        }).catch(() => null),
      ));
      try { localStorage.removeItem("tz-ignored-users"); } catch { /* ignore */ }
    };
    migrateLocal()
      .then(() => fetch("/api/ignores", { credentials: "include" }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((data: { ignored?: string[] } | null) => {
        if (alive && data?.ignored) setIgnoredIds(new Set(data.ignored));
      })
      .catch(() => { /* без списка чат работает как обычно */ });
    return () => { alive = false; };
  }, []);

  // Local nickname: replaces the displayed name only on this device; other
  // users keep seeing the real name.
  const displayName = useCallback(
    (u: { id: string; name: string }) => localNicks[u.id]?.trim() || u.name,
    [localNicks],
  );

  const setLocalNickname = useCallback((targetId: string, nick: string | null) => {
    setLocalNicks((prev) => {
      const next = { ...prev };
      if (nick && nick.trim()) next[targetId] = nick.trim();
      else delete next[targetId];
      try { localStorage.setItem("tz-local-nicknames", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /* Состояние переключаем сразу, запрос отправляем следом: игнор — жест
     мгновенный, и ждать ответа сети, глядя на неизменившийся список, незачем.
     Если запрос не прошёл, возвращаем как было. */
  const toggleIgnoreUser = useCallback((targetId: string) => {
    let adding = false;
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else { next.add(targetId); adding = true; }
      return next;
    });
    const request = adding
      ? fetch("/api/ignores", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: targetId }),
        })
      : fetch(`/api/ignores?userId=${encodeURIComponent(targetId)}`, { method: "DELETE", credentials: "include" });
    request
      .then((r) => {
        if (r.ok) return;
        setIgnoredIds((prev) => {
          const back = new Set(prev);
          if (adding) back.delete(targetId);
          else back.add(targetId);
          return back;
        });
      })
      .catch(() => {
        setIgnoredIds((prev) => {
          const back = new Set(prev);
          if (adding) back.delete(targetId);
          else back.add(targetId);
          return back;
        });
      });
  }, []);

  // The composer is focused through an effect so that no callback below
  // captures the textarea ref (react-hooks/refs).
  const [composerFocusTick, setComposerFocusTick] = useState(0);
  useEffect(() => {
    if (composerFocusTick === 0) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerFocusTick]);

  // "Упомянуть" = reply: attach the reply reference, prefill the @mention in
  // the composer and focus it so the user can start typing right away.
  const mentionUser = useCallback((msg: Message) => {
    setReplyTo({ id: msg.id, name: msg.user.name, content: msg.content });
    const mention = `@${msg.user.username || msg.user.name} `;
    setNewMessage((prev) => {
      const next = prev.includes(mention.trim()) ? prev : prev ? `${prev}${prev.endsWith(" ") ? "" : " "}${mention}` : mention;
      try { localStorage.setItem(channelDraftKey, next); } catch { /* ignore */ }
      return next;
    });
    setComposerFocusTick((t) => t + 1);
  }, [channelDraftKey]);

  // Derived values and stable handlers for the right-click user menu.
  const menuMember = userMenu ? (groupMeta?.members.find((m) => m.userId === userMenu.user.id) ?? null) : null;

  const closeUserMenu = useCallback(() => setUserMenu(null), []);

  const handleMenuMention = useCallback(() => {
    if (userMenu) mentionUser(userMenu.msg);
    setUserMenu(null);
  }, [userMenu, mentionUser]);

  const handleMenuOpenDm = useCallback((targetId: string) => {
    setUserMenu(null);
    if (onOpenDm) onOpenDm(targetId);
    else window.location.href = `/connect?section=dm&dm=${targetId}`;
  }, [onOpenDm]);

  /* FIX-TAGMENTION: карта тегов сообщества для подсветки «#тег» в сообщениях.
     Пересобирается только при смене списка ролей — ссылка стабильна, поэтому
     мемоизация строк MessageRow сохраняется. */
  const roleTagMap = useMemo(() => {
    const map = new Map<string, RoleTag>();
    for (const r of groupMeta?.roles ?? []) {
      if (r?.name) map.set(r.name.toLowerCase(), { name: r.name, color: r.color });
    }
    return map;
  }, [groupMeta?.roles]);

  /* Имя приводим к нижнему регистру: сервер хранит его так же, а в сообщении
     человек может набрать как угодно. Ссылка стабильна — иначе мемоизация
     строк MessageRow перестала бы работать. */
  const emojiMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of groupEmojis) map.set(item.name.toLowerCase(), item.url);
    return map;
  }, [groupEmojis]);

  // @mention autocomplete for the composer (last 10 active members + @everyone)
  const composerMentions = useMentions({
    members: channelMembers,
    includeEveryone: true,
    onApply: (next, caretAfter) => {
      updateChannelDraft(next);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = caretAfter;
          ta.selectionEnd = caretAfter;
        }
      });
    },
  });

  /* FIX-TAGMENTION: автодополнение тегов по «#». Отдельная машинка состояний —
     список кандидатов другой, вставляется «#имя ». Носителей тега уведомляет
     сервер, разбирая текст сообщения. */
  const composerTags = useRoleTagMentions({
    roles: groupMeta?.roles ?? [],
    onApply: (next, caretAfter) => {
      updateChannelDraft(next);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = caretAfter;
          ta.selectionEnd = caretAfter;
        }
      });
    },
  });

  // Resolve @username / @everyone in text to member IDs (never from the global user base)
  const resolveMentionIds = (text: string): string[] => {
    const ids = new Set<string>();
    if (/@everyone\b/.test(text)) {
      channelMembers.forEach((m) => { if (m.id !== currentUserId) ids.add(m.id); });
      return [...ids];
    }
    const usernames = new Set(Array.from(text.matchAll(/@([A-Za-z0-9_а-яА-ЯёЁ]+)/g), (m) => m[1].toLowerCase()));
    if (usernames.size === 0) return [];
    channelMembers.forEach((m) => {
      if (m.username && usernames.has(m.username.toLowerCase())) ids.add(m.id);
    });
    return [...ids];
  };

  // Pinning is restricted to community admins/moderators (plus site admins)
  const canPin = rankOf(currentUserCommunityRole) >= RANK_MODERATOR || currentUserRole === "SITE_ADMIN";

  // PERF-CHAT: обработчики, попадающие в пропсы MessageRow, обёрнуты в useCallback —
  // без стабильных ссылок React.memo считал бы пропсы изменившимися на каждый рендер.
  const fetchPinned = useCallback(async () => {
    const res = await fetch(`/api/messages/pin?channelId=${channelId}`);
    if (res.ok) setPinnedMessages(await res.json());
  }, [channelId]);

  const togglePin = async (messageId: string) => {
    await fetch("/api/messages/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    fetchPinned();
  };

  // Day-Night background (optional, controlled via profile settings)
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /* MOBILE-UI: тулбар действий с сообщением на сенсорных экранах открывается
     долгим нажатием (~450 мс). Работаем напрямую с DOM (класс tz-msg-touch на
     строке .tz-msg-row), чтобы не ломать мемоизацию тяжёлых MessageRow. */
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !window.matchMedia("(hover: none)").matches) return;
    let timer: number | null = null;
    let active: HTMLElement | null = null;
    const clearActive = () => {
      active?.classList.remove("tz-msg-touch");
      active = null;
    };
    const cancelTimer = () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
    };
    const onTouchStart = (e: TouchEvent) => {
      const row = (e.target as HTMLElement | null)?.closest?.(".tz-msg-row") as HTMLElement | null;
      cancelTimer();
      if (!row) { clearActive(); return; }
      if (active && active !== row) clearActive();
      timer = window.setTimeout(() => {
        active = row;
        row.classList.add("tz-msg-touch");
      }, 450);
    };
    const onTouchMove = () => cancelTimer();
    const onTouchEnd = () => cancelTimer();
    const onScroll = () => { cancelTimer(); clearActive(); };
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: true });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelTimer(); clearActive();
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("scroll", onScroll);
    };
  }, []);
  const socketRef = useRef<Socket | null>(null);
  // Mirror the live socket into state so the typing indicator (a child) can
  // subscribe to it reactively without reading a ref during render.
  const [chatSocket, setChatSocket] = useState<Socket | null>(null);
  const hasConnectedRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // PERF-CHAT: время последнего отправленного "typing" для троттлинга
  const lastTypingEmitRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAtBottomRef = useRef(true);
  const scrollFetchLock = useRef(false);
  const didInitialScrollRef = useRef(false);
  /** Расстояние до низа ленты перед подстановкой старых сообщений сверху. */
  const prependAnchorRef = useRef<number | null>(null);
  /* Оконный рендер: в DOM живёт полоса вокруг видимой области, остальное —
     распорки. Без него дерево росло вместе с историей, и каждая догруженная
     страница делала прокрутку тяжелее (см. hooks/useMessageWindow). */
  /* Разбираем по частям намеренно: сам объект пересоздаётся на каждый рендер, и
     попади он в зависимости эффекта — эффект перезапускался бы бесконечно.
     Колбэки стабильны, значения меняются вместе с окном. */
  const {
    start: winStart, end: winEnd, padTop: winPadTop, padBottom: winPadBottom,
    hiddenAbove: winHiddenAbove, sync: syncWindow, reveal: revealWindow, revealTail: revealWindowTail,
    reset: resetWindow,
  } = useMessageWindow(messages.length, scrollContainerRef);
  /** Кадр, в котором обработчик прокрутки уже запланирован. */
  const scrollRafRef = useRef(0);
  /**
   * FIX-SCROLLEND: сколько ещё раз довести ленту до низа после раскрытия хвоста.
   * Считается в отрисовках, а не в миллисекундах: ждать «примерно столько,
   * сколько занимает вёрстка» — это гадание, которое ломается на медленной
   * машине и на длинной истории.
   */
  const endScrollRef = useRef(0);

  /**
   * FIX-SCROLLEND: переход в конец ленты по кнопке «вниз».
   *
   * Было `scrollIntoView({ behavior: "smooth" })`, и на длинной истории это не
   * работало сразу по двум причинам.
   *
   * 1. Плавная прокрутка на десятки тысяч пикселей — это секунды ожидания.
   *    Кнопка «в конец» должна телепортировать, а не ехать: человек нажал её
   *    именно потому, что не хочет листать.
   *
   * 2. Куда важнее: при уходе вверх хвост ленты вынут из дерева и заменён
   *    нижней распоркой, высота которой — ОЦЕНКА (см. hooks/useMessageWindow).
   *    Прокрутка приезжала в конец распорки; там срабатывал обработчик, хвост
   *    отрисовывался по-настоящему, оценка сменялась фактической высотой — и
   *    низ уезжал. Со стороны это и выглядит как «нажал, а в конец не встало».
   *
   * Поэтому: сначала раскрываем хвост, потом доводим до низа по НАСТОЯЩЕЙ
   * высоте — сразу и ещё раз после отрисовки.
   */
  const scrollToEnd = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    revealWindowTail();
    isAtBottomRef.current = true;
    setShowScrollBtn(false);
    /* Первый прыжок сразу: если хвост уже отрисован, на этом всё и закончится
       — без единого лишнего кадра. */
    el.scrollTop = el.scrollHeight;
    /* Два добора: первый — после отрисовки раскрытого хвоста, второй — когда
       осядут высоты картинок и вложений. */
    endScrollRef.current = 2;
    requestAnimationFrame(() => {
      endScrollRef.current = 0;
      const node = scrollContainerRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, [revealWindowTail]);

  /* Доводка живёт в layout-эффекте: обычный эффект выполняется после кадра, и
     промежуточное положение успевает попасть на экран рывком. */
  useLayoutEffect(() => {
    if (endScrollRef.current <= 0) return;
    endScrollRef.current -= 1;
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  /* Запрос истории привязан к каналу: при быстром переключении ответ по
     прежнему каналу мог прийти ПОСЛЕ ответа по новому и затереть ленту чужими
     сообщениями. Держим отменяющий сигнал текущего канала — эффект ниже рвёт
     его при уходе, и опоздавший ответ до setMessages уже не доходит. */
  const fetchAbortRef = useRef<AbortController | null>(null);

  const fetchMessages = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    const url = `/api/messages?channelId=${channelId}&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: signal ?? fetchAbortRef.current?.signal });
    } catch (err) {
      // Прерванный запрос — это не сбой: канал сменился, ответ больше не нужен.
      if ((err as Error)?.name === "AbortError") return;
      throw err;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (cursor) {
      /* Запоминаем расстояние до низа ленты. Пятьдесят старых сообщений
         встанут СВЕРХУ, лента станет выше, а браузер сохраняет scrollTop — и
         прочитанное уезжает вниз вместе с содержимым: со стороны это выглядит
         как бросок то на середину, то к самому верху. Восстанавливаем позицию
         по этому расстоянию сразу после отрисовки (эффект ниже). */
      const el = scrollContainerRef.current;
      if (el) prependAnchorRef.current = el.scrollHeight - el.scrollTop;
      setMessages((prev) => [...data.messages, ...prev]);
    } else {
      setMessages(data.messages);
    }
    setNextCursor(data.nextCursor);
    setHasMore(!!data.nextCursor);
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setMessages([]);
    setLoading(true);
    setNextCursor(null);
    didInitialScrollRef.current = false;
    isAtBottomRef.current = true;
    resetWindow();
    fetchMessages(undefined, controller.signal);
    return () => controller.abort();
  }, [channelId, fetchMessages, resetWindow]);

  // Unified "jump to a message": used both by notification deep-links
  // (highlightMessageId prop) and by clicking a reply reference in chat.
  // It scrolls to the target once, briefly flashes it, and — if the message
  // isn't in the loaded page yet — pulls older pages until it appears.
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);
  const jumpAttemptsRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jumpToMessage = useCallback((id: string) => {
    jumpAttemptsRef.current = 0;
    setJumpTargetId(id);
  }, []);

  // A notification deep-link arrives via prop — feed it into the same machinery.
  useEffect(() => {
    if (highlightMessageId) {
      jumpAttemptsRef.current = 0;
      setJumpTargetId(highlightMessageId);
    }
  }, [highlightMessageId]);

  // FIX-JUMP: раньше эффект зависел от `messages` и пере-скроллил к сообщению на
  // КАЖДОЕ обновление ленты (новое сообщение, отметка о прочтении, реакция),
  // из-за чего вид «залипал» на сообщении и не давал прокручивать вниз. Теперь
  // цель прокручивается ровно один раз, после чего немедленно освобождается —
  // мигание живёт своим таймером и не мешает ручной прокрутке.
  useEffect(() => {
    if (!jumpTargetId) { jumpAttemptsRef.current = 0; return; }
    if (loading) return;

    const release = () => {
      jumpAttemptsRef.current = 0;
      setJumpTargetId(null);
      onHighlightConsumed?.();
    };

    /* Сообщение может быть загружено, но не отрисовано: лента показывает окно
       вокруг видимой области (см. useMessageWindow). Сначала просим окно
       включить нужную строку, элемент появится на следующем проходе эффекта. */
    const targetIndex = messages.findIndex((m) => m.id === jumpTargetId);
    if (targetIndex >= 0 && (targetIndex < winStart || targetIndex >= winEnd)) {
      revealWindow(targetIndex);
      return;
    }

    const el = document.getElementById(`msg-${jumpTargetId}`);
    if (el) {
      // Мы намеренно уходим от низа к конкретному сообщению — снимаем
      // «автоследование за низом», иначе автопрокрутка вниз перебила бы переход.
      isAtBottomRef.current = false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashMessageId(jumpTargetId);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashMessageId(null), 2400);
      release();
      return;
    }
    if (hasMore && nextCursor && jumpAttemptsRef.current < 8) {
      jumpAttemptsRef.current += 1;
      fetchMessages(nextCursor);
    } else {
      // Message not reachable (too old or deleted) — release the highlight.
      release();
    }
  }, [jumpTargetId, messages, loading, hasMore, nextCursor, fetchMessages, onHighlightConsumed, winStart, winEnd, revealWindow]);

  // Clear the flash timer on unmount so it never fires against a stale component.
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  // Mute state ref
  const isMutedRef = useRef(false);
  /* FIX-NEWS-MUTE: то же самое значение, но в состоянии: ref годится обработчику
     входящего сообщения (ему перерисовка не нужна), но кнопка в шапке обязана
     менять вид сразу после нажатия. */
  const [channelMuted, setChannelMuted] = useState(false);

  // Fetch channel members for tools (polls/tasks assignment) + mute state.
  // Полный список участников здесь нужен честно: по нему работает
  // автодополнение упоминаний, а меню по правому клику должно найти запись
  // участника для любого автора сообщения, а не только для первой страницы.
  // Поэтому список догружается страницами (без тяжёлых полей), а из снимка
  // сообщества берутся только роли-теги.
  useEffect(() => {
    fetch(`/api/channels/${channelId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((ch) => {
        if (!ch?.groupId) return;
        groupIdRef.current = ch.groupId;
        // Fetch members + mute state in parallel
        Promise.all([
          fetch(`/api/groups/${ch.groupId}`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/channels/mute?groupId=${ch.groupId}`).then((r) => r.ok ? r.json() : null),
          fetchAllGroupMembers(ch.groupId),
          fetch(`/api/groups/${ch.groupId}/emoji`).then((r) => r.ok ? r.json() : null),
        ]).then(([g, muteData, allMembers, emojiData]) => {
          setGroupEmojis(emojiData?.emojis ?? []);
          if (allMembers.length > 0) {
            setChannelMembers(allMembers.map((m) => ({ id: m.user.id, name: m.user.name, username: m.user.username ?? null, avatar: m.user.avatar ?? null, lastSeen: m.user.lastSeen ?? null })));
            // Raw member/role data for the right-click user menu: timeout, ban
            // and role assignment need GroupMember ids and group role ids.
            setGroupMeta({
              groupId: ch.groupId,
              roles: (g?.roles ?? []).map((r: { id: string; name: string; color: string }) => ({ id: r.id, name: r.name, color: r.color })),
              members: allMembers.map((m) => ({
                id: m.id,
                userId: m.user.id,
                role: m.role,
                roleIds: (m.tags ?? []).map((t) => t.role?.id ?? "").filter(Boolean),
              })),
            });
          }
          if (muteData) {
            const groupMuted = muteData.groupMuted ?? false;
            const channelMuted = muteData.channels?.[channelId];
            // Muted if: channel explicitly muted, or group muted and channel not explicitly unmuted
            const mutedNow = channelMuted === true || (groupMuted && channelMuted !== false);
            isMutedRef.current = mutedNow;
            setChannelMuted(mutedNow);
          }
        });
      })
      .catch(() => {});
  }, [channelId]);

  // Socket.IO connection
  useEffect(() => {
    const socket = io({ path: "/api/socketio", withCredentials: true });
    socketRef.current = socket;
    setChatSocket(socket);
    // Distinguishes the first `connect` (initial fetch already ran via the
    // channelId effect) from later reconnects (which must re-sync).
    hasConnectedRef.current = false;

    socket.on("connect", () => {
      socket.emit("join-channel", { channelId });
      if (hasConnectedRef.current) {
        // A reconnect after the socket dropped (e.g. while the server was
        // redeploying). Live events emitted during the outage never reached us,
        // so re-fetch the latest page to re-sync instead of silently missing
        // messages until a manual reload.
        fetchMessages();
      }
      hasConnectedRef.current = true;
    });

    // Тип Message (messageTypes) не объявляет channelId, но сервер его
    // возвращает в payload new-message (Prisma отдаёт все скалярные поля).
    // Расширяем тип обработчика, чтобы читать channelId без ошибки сборки.
    socket.on("new-message", (msg: Message & { channelId?: string }) => {
      // FIX-SEC-BLEED: событие приходит по общему сокету; в окне между
      // leave-channel и его обработкой сервером может прилететь сообщение чужого
      // канала. Отбрасываем всё, что не относится к открытому каналу.
      if (msg.channelId && msg.channelId !== channelId) return;
      if (msg.threadId) {
        if (!threadReplyIdsRef.current.has(msg.id)) {
          threadReplyIdsRef.current.add(msg.id);
          if (activeThreadIdRef.current === msg.threadId) setThreadMessages((prev) => [...prev, msg]);
          setMessages((prev) => prev.map((message) => message.id === msg.threadId ? { ...message, threadCount: (message.threadCount || 0) + 1, _count: { ...message._count, threadReplies: (message._count?.threadReplies || 0) + 1 } } : message));
        }
        return;
      }
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        // If this is our own message, replace optimistic placeholder
        if (msg.user.id === currentUserIdRef.current) {
          const hasOptimistic = prev.some((m) => m.id.startsWith("opt-"));
          if (hasOptimistic) return prev.map((m) => m.id.startsWith("opt-") && m.user.id === msg.user.id ? msg : m);
        }
        return [...prev, msg];
      });
      onNewMessageRef.current?.();
      // Play notification only for messages from others (unless muted)
      if (msg.user.id !== currentUserIdRef.current && !isMutedRef.current) {
        const uname = currentUserNameRef.current;
        // Багфикс: раньше упоминание искалось простым includes — @user срабатывал
        // и на чужое упоминание @user123. Теперь после ника должна быть граница
        // слова — как на сервере при создании уведомлений.
        let isMention = /@everyone\b/.test(msg.content);
        if (!isMention && uname) {
          const lower = msg.content.toLowerCase();
          const token = `@${uname.toLowerCase()}`;
          let idx = lower.indexOf(token);
          while (idx !== -1) {
            const after = lower.charAt(idx + token.length);
            if (!after || !/[0-9a-z_а-яё-]/.test(after)) { isMention = true; break; }
            idx = lower.indexOf(token, idx + 1);
          }
        }
        if (isMention) playMentionNotification();
        else playMsgNotification();
        // Багфикс: в десктопном приложении нативные тосты показывает сама
        // оболочка (notification bridge) — браузерный Notification здесь давал
        // ВТОРОЙ, дублирующий тост поверх системного.
        /* ANDROID-NOTIFY: через фасад — в Android-оболочке это настоящее
           системное уведомление, в браузере прежний Web Notification. */
        if (!getDesktopApi() && document.hidden) {
          /* Текст уведомления можно скрыть: всплывающий тост читают все, кто
             видит экран, а в нём приходит содержимое личной переписки. */
          notifyExternal(
            msg.user.name,
            chatPrefsRef.current.hideNotificationText ? "Новое сообщение" : msg.content.slice(0, 80),
            `msg-${channelId}`,
          );
        }
      }
    });

    socket.on("message-edited", (msg: Message) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      setThreadMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      setActiveThread((prev) => prev?.id === msg.id ? msg : prev);
    });

    socket.on("message-deleted", ({ id }: { id: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      setThreadMessages((prev) => prev.filter((m) => m.id !== id));
      if (activeThreadIdRef.current === id) setActiveThread(null);
    });

    /* Набор эмодзи сообщества мог измениться в настройках — перечитываем.
       Без этого добавленный эмодзи оставался в сообщениях текстом до
       перезагрузки страницы: список запрашивается один раз при входе. */
    socket.on("group-emoji-updated", () => {
      const gid = groupIdRef.current;
      if (!gid) return;
      fetch(`/api/groups/${gid}/emoji`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setGroupEmojis(data?.emojis ?? []))
        .catch(() => { /* сеть подвела — набор обновится при следующем входе */ });
    });

    socket.on("reaction-added", ({ messageId, emoji, userId: uid, userName }: { messageId: string; emoji: string; userId: string; userName: string }) => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = [...(m.reactions || [])];
        if (!reactions.find((r) => r.userId === uid && r.emoji === emoji)) {
          reactions.push({ id: `${uid}-${emoji}`, emoji, userId: uid, user: { id: uid, name: userName } });
        }
        return { ...m, reactions };
      }));
    });

    socket.on("reaction-removed", ({ messageId, emoji, userId: uid }: { messageId: string; emoji: string; userId: string }) => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m;
        return { ...m, reactions: (m.reactions || []).filter((r) => !(r.userId === uid && r.emoji === emoji)) };
      }));
    });

    socket.on("message-pinned", ({ messageId, pinned }: { messageId: string; pinned: boolean }) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, pinned } : m));
    });

    socket.on("profile-updated", (data: { id: string; avatar?: string | null; avatarGlowEnabled?: boolean; avatarGlowColors?: string | null; profileBanner?: string | null }) => {
      setMessages((prev) => prev.map((m) => {
        if (m.user.id !== data.id) return m;
        return {
          ...m,
          user: {
            ...m.user,
            avatar: "avatar" in data ? (data.avatar ?? null) : m.user.avatar,
            avatarGlowEnabled: data.avatarGlowEnabled ?? m.user.avatarGlowEnabled,
            avatarGlowColors: data.avatarGlowColors ?? m.user.avatarGlowColors,
            profileBanner: "profileBanner" in data ? (data.profileBanner ?? null) : m.user.profileBanner,
          },
        };
      }));
    });

    socket.on("messages-read", ({ userId: readerId, messageIds: readIds }: { userId: string; messageIds: string[] }) => {
      setMessages((prev) => prev.map((m) => {
        if (!readIds.includes(m.id)) return m;
        if ((m.reads || []).some(r => r.userId === readerId)) return m;
        return { ...m, reads: [...(m.reads || []), { userId: readerId }] };
      }));
    });

    return () => {
      socket.emit("leave-channel", { channelId });
      socket.disconnect();
      socketRef.current = null;
      setChatSocket(null);
    };
  }, [channelId, fetchMessages]);

  /* Возврат позиции после подстановки старых сообщений сверху. Именно
     useLayoutEffect: обычный эффект выполняется после отрисовки, и человек
     успевает увидеть рывок. Считаем от низа — высота выросшей ленты нам заранее
     не известна, а расстояние до низа не изменилось. */
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    const anchor = prependAnchorRef.current;
    if (!el || anchor === null) return;
    prependAnchorRef.current = null;
    el.scrollTop = el.scrollHeight - anchor;
  }, [messages]);

  // Scroll to bottom on new messages if already at bottom
  useEffect(() => {
    if (messages.length === 0) return;
    // First load for a channel: jump instantly to the newest message so the
    // chat opens already scrolled to the bottom (no visible smooth animation).
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      isAtBottomRef.current = true;
      // FIX-JUMP: если открываемся по ссылке на конкретное сообщение
      // (из уведомления), не прыгаем в самый низ — позиционированием займётся
      // эффект перехода к сообщению, иначе он «перебивался» скроллом вниз.
      if (highlightMessageId || jumpTargetId) return;
      const el = scrollContainerRef.current;
      if (!el) return;

      /* UNREAD-ANCHOR: открываем канал там, где человек остановился.
         Раньше вход всегда прыгал в самый низ, и пропущенные сообщения
         приходилось искать прокруткой вверх — при десятке новых это значит
         «листать вслепую, пока не найдёшь знакомое».

         Первое непрочитанное считаем ровно так же, как это делает пометка
         прочтения ниже: чужое сообщение без моей отметки в `reads`. Эффект
         прокрутки объявлен ВЫШЕ эффекта пометки, поэтому на первом проходе он
         ещё видит исходные отметки; иначе всё оказалось бы прочитанным ровно
         в тот момент, когда мы это проверяем. */
      const firstUnread = messages.find(
        (m) => m.user.id !== currentUserId && !(m.reads || []).some((r) => r.userId === currentUserId),
      );

      setFirstUnreadId(firstUnread ? firstUnread.id : null);

      if (firstUnread) {
        /* Уходим от низа осознанно — иначе автоследование за последним
           сообщением тут же утащило бы нас обратно вниз. */
        isAtBottomRef.current = false;
        const goToUnread = () => {
          const node = document.getElementById(`msg-${firstUnread.id}`);
          if (node) node.scrollIntoView({ block: "start" });
          else el.scrollTop = el.scrollHeight;
        };
        goToUnread();
        // Повтор после отрисовки: высота ещё может измениться из-за картинок.
        requestAnimationFrame(goToUnread);
        return;
      }

      const jumpToBottom = () => { el.scrollTop = el.scrollHeight; };
      jumpToBottom();
      // Re-run after paint in case content height settles (e.g. images).
      requestAnimationFrame(jumpToBottom);
      return;
    }
    /* Следование за новыми сообщениями можно выключить: когда читаешь
       историю в живом канале, лента дёргает вниз при каждом чужом сообщении. */
    if (isAtBottomRef.current && chatPrefsRef.current.autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, highlightMessageId, jumpTargetId, currentUserId]);

  /* Прокрутка идёт десятками событий в секунду, а лента — самый тяжёлый список
     в проекте. Считаем не чаще одного раза на кадр: замеры высоты (scrollHeight)
     заставляют браузер пересчитывать раскладку, и на каждом событии это и было
     причиной подтормаживания при быстром движении вверх.

     Догрузка начинается не у самого верха, а за 600 пикселей до него: пока
     человек доезжает, страница уже пришла, и упереться в верх с рывком не
     получается. */
  const handleScroll = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const el = scrollContainerRef.current;
      if (!el) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isAtBottomRef.current = distFromBottom < 100;
      setShowScrollBtn(distFromBottom > 300);
      /* Сначала окно: пока сверху есть загруженные, но не отрисованные строки,
         за новой страницей идти рано — иначе память копится зря. */
      syncWindow();
      if (el.scrollTop < 600 && winHiddenAbove === 0 && hasMore && nextCursor && !scrollFetchLock.current) {
        scrollFetchLock.current = true;
        fetchMessages(nextCursor).finally(() => {
          setTimeout(() => { scrollFetchLock.current = false; }, 300);
        });
      }
    });
  };

  useEffect(() => () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); }, []);

  // PERF-CHAT: раньше событие "typing" уходило в сокет на каждый нажатый символ.
  // Теперь — не чаще одного раза в 1.5 секунды; "stop-typing" по-прежнему уходит
  // через 2 секунды после последнего ввода и сбрасывает троттлинг.
  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingEmitRef.current >= 1500) {
      lastTypingEmitRef.current = now;
      socketRef.current?.emit("typing", { channelId });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("stop-typing", { channelId });
      lastTypingEmitRef.current = 0;
    }, 2000);
  };

  // Mark messages as read when visible
  const lastMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    const lastId = messages[messages.length - 1]?.id;
    if (lastId === lastMsgIdRef.current) return;
    lastMsgIdRef.current = lastId;
    const unread = messages.filter(m => m.user.id !== currentUserId && !(m.reads || []).some(r => r.userId === currentUserId));
    if (unread.length === 0) return;
    /* Отметку можно не отправлять: тогда автор не увидит галочку «прочитано».
       Обратная сторона честная и заметная — сервер не запоминает прочитанное,
       и граница непрочитанного считается заново при каждом входе. */
    if (!chatPrefsRef.current.sendReadReceipts) return;
    fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds: unread.map(m => m.id), channelId }),
    }).then(() => {
      // NEW: сразу гасим цифру на значке приложения (десктоп), не ждём поллинга
      getDesktopApi()?.refreshBadge?.();
      setMessages(prev => prev.map(m => {
        if (unread.some(u => u.id === m.id)) {
          return { ...m, reads: [...(m.reads || []), { userId: currentUserId }] };
        }
        return m;
      }));
    }).catch(() => {});
  }, [messages, currentUserId, channelId]);

  // Slowmode countdown
  useEffect(() => {
    if (slowmodeWait <= 0) return;
    const t = setInterval(() => setSlowmodeWait(prev => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(t);
  }, [slowmodeWait]);

  // Thread functions
  const openThread = useCallback(async (msg: Message, anchorEl?: HTMLElement | null) => {
    // FIX-THREAD: ветка открывается компактным всплывающим окном возле
    // сообщения, а не панелью на всю высоту приложения.
    const rect = (anchorEl ?? document.getElementById(`msg-${msg.id}`))?.getBoundingClientRect();
    setThreadAnchor(rect ? { x: rect.left + 40, y: rect.bottom + 6 } : null);
    setActiveThread(msg);
    activeThreadIdRef.current = msg.id;
    setThreadMessages([]);
    threadReplyIdsRef.current = new Set();
    setThreadError(null);
    setThreadLoading(true);
    setThreadInput(localStorage.getItem(`tz-chat-draft:thread:${msg.id}`) ?? "");
    try {
      const res = await fetch(`/api/messages?channelId=${channelId}&threadId=${msg.id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить ветку");
      const replies = Array.isArray(data.messages) ? data.messages : [];
      threadReplyIdsRef.current = new Set(replies.map((reply: Message) => reply.id));
      setThreadMessages(replies);
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : "Не удалось загрузить ветку");
    } finally {
      setThreadLoading(false);
    }
  }, [channelId]);

  const sendThreadReply = async () => {
    if (!threadInput.trim() || !activeThread || threadSending) return;
    const content = threadInput.trim();
    setThreadSending(true);
    setThreadError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, channelId, threadId: activeThread.id }),
      });
      const msg = await res.json();
      if (!res.ok) throw new Error(msg.error || "Не удалось отправить ответ");
      if (!threadReplyIdsRef.current.has(msg.id)) {
        threadReplyIdsRef.current.add(msg.id);
        setThreadMessages((prev) => [...prev, msg]);
        setMessages((prev) => prev.map((m) => m.id === activeThread.id ? { ...m, threadCount: (m.threadCount || 0) + 1, _count: { ...m._count, threadReplies: (m._count?.threadReplies || 0) + 1 } } : m));
      }
      setThreadInput("");
      localStorage.removeItem(`tz-chat-draft:thread:${activeThread.id}`);
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : "Не удалось отправить ответ");
    } finally {
      setThreadSending(false);
    }
  };

  // Scheduled messages
  const loadScheduled = async () => {
    const res = await fetch("/api/messages/scheduled");
    if (res.ok) setScheduledList(await res.json());
  };

  const scheduleMessage = async () => {
    if (!newMessage.trim() || !scheduleDate || !scheduleTime) return;
    const dt = new Date(`${scheduleDate}T${scheduleTime}`);
    if (dt.getTime() <= Date.now()) { setErrorToast("Время должно быть в будущем"); setTimeout(() => setErrorToast(null), 3500); return; }
    await fetch("/api/messages/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newMessage, channelId, scheduledAt: dt.toISOString() }),
    });
    updateChannelDraft("");
    setShowSchedule(false);
    loadScheduled();
  };

  const deleteScheduled = async (id: string) => {
    await fetch(`/api/messages/scheduled?id=${id}`, { method: "DELETE" });
    loadScheduled();
  };

  // Format helpers
  const insertFormat = (prefix: string, suffix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = newMessage;
    const selected = text.slice(start, end);
    const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    updateChannelDraft(newText);
    setTimeout(() => { ta.focus(); ta.selectionStart = start + prefix.length; ta.selectionEnd = end + prefix.length; }, 0);
  };

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? newMessage.length;
    const end = ta?.selectionEnd ?? start;
    const next = newMessage.slice(0, start) + emoji + newMessage.slice(end);
    updateChannelDraft(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = start + emoji.length;
      ta.selectionEnd = start + emoji.length;
    });
  };


  const [showGeoPicker, setShowGeoPicker] = useState(false);

  const sendGeolocation = async (lat: number, lng: number, address?: string | null) => {
    setShowGeoPicker(false);
    // FIX-GEO: вместе с точкой сохраняем адрес (улица, дом, город) из Google Geocoding.
    const geoAttachment = {
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
      createdAt: new Date().toISOString(),
      edited: false,
      deleted: false,
      pinned: false,
      attachments: JSON.stringify([geoAttachment]),
      user: { id: currentUserId, name: currentUserName, avatar: null, avatarGlowEnabled: false, avatarGlowColors: null, role: currentUserRole },
      reads: [],
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    isAtBottomRef.current = true;
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", channelId, attachments: [geoAttachment] }),
      });
      if (!res.ok) {
        setMessages((prev) => prev.filter((mm) => mm.id !== optimisticId));
        setErrorToast("Не удалось отправить геолокацию");
        setTimeout(() => setErrorToast(null), 3500);
      } else {
        const real = await res.json();
        setMessages((prev) => prev.map((mm) => (mm.id === optimisticId ? { ...real } : mm)));
      }
    } catch {
      setMessages((prev) => prev.filter((mm) => mm.id !== optimisticId));
      setErrorToast("Ошибка сети");
      setTimeout(() => setErrorToast(null), 3500);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && pendingAttachments.length === 0) || sending || uploading || slowmodeWait > 0) return;

    /* Предел длины проверяем до отправки. Раньше его знал только сервер: человек
       набирал длинный текст, жал отправить и получал отказ уже после. */
    const lengthError = messageLengthError(newMessage, { premium: isPremiumAccount });
    if (lengthError) {
      setErrorToast(lengthError);
      setTimeout(() => setErrorToast(null), 4500);
      return;
    }

    setSending(true);
    socketRef.current?.emit("stop-typing", { channelId });

    const content = newMessage;
    const attachments = pendingAttachments.length > 0 ? pendingAttachments : null;
    const body: Record<string, unknown> = { content, channelId, attachments };
    if (replyTo) body.replyToId = replyTo.id;
    const mentionIds = resolveMentionIds(content);
    if (mentionIds.length > 0) body.mentions = mentionIds;

    updateChannelDraft("");
    setPendingAttachments([]);
    const savedReply = replyTo;
    setReplyTo(null);

    // Optimistic update — show message immediately
    const optimisticId = `opt-${Date.now()}`;
    const optimisticMsg: Message = {
      id: optimisticId,
      content,
      createdAt: new Date().toISOString(),
      edited: false,
      deleted: false,
      pinned: false,
      attachments: attachments ? JSON.stringify(attachments) : null,
      user: { id: currentUserId, name: currentUserName, avatar: null, avatarGlowEnabled: false, avatarGlowColors: null, role: currentUserRole },
      replyTo: savedReply ? { id: savedReply.id, content: savedReply.content, user: { id: "", name: savedReply.name } } : undefined,
      reads: [],
    };
    setMessages(prev => [...prev, optimisticMsg]);
    isAtBottomRef.current = true;

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        updateChannelDraft(content);
        setPendingAttachments(attachments ?? []);
        setMessages(prev => prev.filter(m => m.id !== optimisticId));
        if (res.status === 429 && data.error) {
          const secs = parseInt(data.error.match(/\d+/)?.[0] || "5");
          setSlowmodeWait(secs);
        }
        setErrorToast(data.error || "Ошибка отправки");
        setTimeout(() => setErrorToast(null), 3500);
      } else {
        // Replace optimistic message with real one from server
        const real = await res.json();
        setMessages(prev => prev.map(m => m.id === optimisticId ? { ...real } : m));
        if (real.censorWarning) {
          setCensorNotice(true);
          window.setTimeout(() => setCensorNotice(false), 6000);
        }
      }
    } catch {
      updateChannelDraft(content);
      setPendingAttachments(attachments ?? []);
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
    } finally {
      setSending(false);
    }
  };

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    await fetch("/api/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, emoji }),
    });
  }, []);

  const pinMessage = useCallback(async (messageId: string) => {
    const res = await fetch("/api/messages/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    if (res.ok) {
      const { pinned } = await res.json();
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, pinned } : m));
      if (showPinned) fetchPinned();
    }
  }, [showPinned, fetchPinned]);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploadedAttachments: ReturnType<typeof parseAttachments> = [];
      // FIX-UPLOAD: загрузка через XHR с прогрессом — над формой рисуется
      // полоска «имя файла · N%» вместо молчаливого ожидания.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fd = new FormData();
        // FIX-NOSHARP: уменьшаем в браузере — на сервере обработки больше нет.
        fd.append("file", await downscaleForChat(file));
        fd.append("channelId", channelId);
        setUploadProgress({ name: file.name, percent: 0, index: i + 1, total: files.length });
        try {
          const uploadRes = await uploadWithProgress("/api/messages/upload", fd, (percent) => {
            setUploadProgress({ name: file.name, percent, index: i + 1, total: files.length });
          });
          if (!uploadRes.ok) {
            const data = await uploadRes.json<{ error?: string }>().catch(() => ({} as { error?: string }));
            setErrorToast(data.error || "Ошибка загрузки");
            setTimeout(() => setErrorToast(null), 3500);
            continue;
          }
          uploadedAttachments.push(await uploadRes.json());
        } catch {
          setErrorToast("Ошибка загрузки");
          setTimeout(() => setErrorToast(null), 3500);
        }
      }
      if (uploadedAttachments.length > 0) {
        setPendingAttachments((prev) => [...prev, ...uploadedAttachments]);
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // FIX-DRAW: сохранить картинку, отредактированную прямо в композере чата —
  // загружаем новый PNG и заменяем им исходное вложение.
  // FIX-DRAWSAVE: раньше PNG получали через fetch(dataUrl), но CSP сайта
  // (connect-src 'self') блокирует запросы к data:-URL — исключение молча
  // проглатывалось (catch не было) и «Сохранить и заменить» не применялось.
  // Теперь декодируем base64 напрямую (без сети/CSP) и показываем ошибки.
  const saveEditedAttachment = async (dataUrl: string) => {
    const index = editingAttachment;
    if (index === null) return;
    const original = pendingAttachments[index];
    if (!original) return;
    setUploading(true);
    try {
      const base64 = dataUrl.split(",")[1] || "";
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const base = (original.name || "рисунок").replace(/\.[a-z0-9]+$/i, "");
      const fd = new FormData();
      fd.append("file", new File([bytes], `${base}.png`, { type: "image/png" }));
      fd.append("channelId", channelId);
      const res = await fetch("/api/messages/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorToast(data.error || "Не удалось сохранить рисунок");
        setTimeout(() => setErrorToast(null), 3500);
        return;
      }
      const uploaded = await res.json();
      setPendingAttachments((prev) => prev.map((a, i) => (i === index ? uploaded : a)));
    } catch {
      // FIX-DRAWSAVE: любая ошибка (декодирование, сеть) теперь видна пользователю
      setErrorToast("Не удалось сохранить рисунок");
      setTimeout(() => setErrorToast(null), 3500);
    } finally {
      setUploading(false);
    }
  };

  /* Обернуть выделенное в блок кода. Тройные кавычки руками набирают редко и
     чаще не знают, что так вообще можно, — поэтому кнопка. Если ничего не
     выделено, вставляется пустой блок с курсором внутри. */
  const wrapSelectionAsCode = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? newMessage.length;
    const end = ta.selectionEnd ?? start;
    const selected = newMessage.slice(start, end);
    const before = newMessage.slice(0, start);
    const after = newMessage.slice(end);
    /* Открывающие кавычки должны стоять на своей строке, иначе первая строка
       кода прилипнет к предыдущему абзацу. */
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const block = `${lead}\`\`\`\n${selected}\n\`\`\`\n`;
    updateChannelDraft(`${before}${block}${after}`);
    requestAnimationFrame(() => {
      ta.focus();
      const caret = before.length + lead.length + 4 + selected.length;
      ta.selectionStart = caret;
      ta.selectionEnd = caret;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    });
  };

  const handleTextPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData("text/plain");
    if (!pastedText) return;
    e.preventDefault();
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = `${newMessage.slice(0, start)}${pastedText}${newMessage.slice(end)}`;
    updateChannelDraft(nextValue);
    emitTyping();
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + pastedText.length;
      textarea.selectionStart = caret;
      textarea.selectionEnd = caret;
    });
  };

  const handleComposerFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploadedAttachments: ReturnType<typeof parseAttachments> = [];
      for (const file of files) {
        const fd = new FormData();
        // FIX-NOSHARP: уменьшаем в браузере — на сервере обработки больше нет.
        fd.append("file", await downscaleForChat(file));
        fd.append("channelId", channelId);
        const uploadRes = await fetch("/api/messages/upload", { method: "POST", body: fd });
        if (!uploadRes.ok) {
          const data = await uploadRes.json();
          setErrorToast(data.error || "Ошибка загрузки");
          setTimeout(() => setErrorToast(null), 3500);
          continue;
        }
        uploadedAttachments.push(await uploadRes.json());
      }
      if (uploadedAttachments.length > 0) {
        setPendingAttachments((prev) => [...prev, ...uploadedAttachments]);
      }
    } finally {
      setUploading(false);
    }
  };

  // Whole-area drag&drop + paste of files/screenshots (tz-connect-update). Files
  // are funnelled into the same composer upload path as the paperclip button.
  const dropPaste = useFileDropPaste({ onFiles: handleComposerFiles });

  const handleDrop = async (e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const text = e.dataTransfer.getData("text/plain");
    const files = Array.from(e.dataTransfer.files || []);
    if (text) {
      updateChannelDraft(newMessage ? `${newMessage}\n${text}` : text);
    }
    if (files.length > 0) {
      await handleComposerFiles(files);
    }
  };

  /**
   * Отправка записанной заметки — голосовой или квадратного видеосообщения.
   *
   * `kind` появился вместе с видеозаметками: от него зависит имя файла и
   * пометка `note`, по которой получатель покажет квадрат, а не проигрыватель.
   * Прежний вызов без второго вида остался рабочим — по умолчанию это голос.
   */
  const handleVoiceRecorded = async (blob: Blob, duration: number, kind: MediaNoteKind = "audio") => {
    setRecordingVoice(false);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, noteFileName(kind, blob.type));
      fd.append("channelId", channelId);
      fd.append("duration", String(duration));
      if (kind === "video") fd.append("note", "1");
      const uploadRes = await fetch("/api/messages/upload", { method: "POST", body: fd });
      /* Причину отказа обязательно показываем. Раньше здесь был молчаливый
         `return`: сервер отвечал 415 на тип с кодеками, запись не отправлялась, а
         человек видел ровно ничего — «не работает, и непонятно почему». */
      if (!uploadRes.ok) {
        const failure = await uploadRes.json().catch(() => null);
        setErrorToast(
          (failure && typeof failure.error === "string" && failure.error) ||
            (kind === "video" ? "Не удалось отправить видеосообщение" : "Не удалось отправить голосовое"),
        );
        setTimeout(() => setErrorToast(null), 4500);
        return;
      }
      const attachment = await uploadRes.json();
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", channelId, attachments: [attachment] }),
      });
    } finally {
      setUploading(false);
    }
  };

  const startEdit = useCallback((msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || !editContent.trim()) return;
    const res = await fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: editingId, content: editContent }),
    });
    if (res.ok) cancelEdit();
  }, [editingId, editContent, cancelEdit]);

  const deleteMessage = useCallback(async (messageId: string) => {
    setConfirmModal({
      message: "Удалить сообщение?",
      onConfirm: async () => {
        await fetch(`/api/messages?messageId=${messageId}`, { method: "DELETE" });
        setConfirmModal(null);
      },
    });
  }, []);


  /** FIX-FWDBUF: отправить содержимое буфера в этот канал. */
  const forwardHere = useCallback(
    async (item: ForwardItem) => {
      if (!channelId) return false;
      let atts: unknown;
      try {
        atts = item.attachments ? JSON.parse(item.attachments) : undefined;
      } catch {
        atts = undefined;
      }
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelId, content: formatForwarded(item), attachments: atts }),
      }).catch(() => null);
      return !!res?.ok;
    },
    [channelId],
  );

  const openForwardModal = async (msg: Message) => {
    setForwardMsg({ content: msg.content, userName: msg.user.name });
    setForwardSearch("");
    try {
      const [chRes, dmRes] = await Promise.all([
        fetch("/api/channels"),
        fetch("/api/dm"),
      ]);
      const targets: { type: "channel" | "dm"; id: string; name: string; icon?: string | null }[] = [];
      if (chRes.ok) {
        const channels = await chRes.json();
        for (const ch of channels) {
          if (ch.id !== channelId) targets.push({ type: "channel", id: ch.id, name: ch.name, icon: null });
        }
      }
      if (dmRes.ok) {
        const convs = await dmRes.json();
        for (const c of convs) {
          const peer = c.user1?.id === currentUserId ? c.user2 : c.user1;
          if (peer) targets.push({ type: "dm", id: c.id, name: peer.name || peer.username || "DM", icon: peer.avatar });
        }
      }
      setForwardTargets(targets);
    } catch { /* ignore */ }
  };

  const doForward = async (target: { type: "channel" | "dm"; id: string; name: string }) => {
    if (!forwardMsg || forwardSending) return;
    setForwardSending(true);
    const fwdContent = `> Переслано от ${forwardMsg.userName}:\n> ${forwardMsg.content.split("\n").join("\n> ")}\n`;
    try {
      if (target.type === "channel") {
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: target.id, content: fwdContent }),
        });
      } else {
        await fetch(`/api/dm/${target.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: fwdContent }),
        });
      }
      setForwardMsg(null);
      setForwardSearch("");
      setForwardToast(true);
      setTimeout(() => setForwardToast(false), 2000);
    } catch { /* ignore */ }
    setForwardSending(false);
  };

  /* Крутилка ждёт первую страницу ПЕРЕПИСКИ. В канале новостей переписки нет:
     лента грузится сама и на время загрузки рисует скелетоны своих карточек, а
     общий спиннер здесь означал бы, что новости не видно, пока не ответит чужой
     запрос сообщений — и вовсе не появятся, если он ответит отказом (тогда
     loading так и остаётся включённым). Порядок вызова хуков это условие не
     трогает: оно, как и раньше, ниже их всех. */
  if (loading && !isNewsChannel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    /* PREMIUM-SKIN: класс tz-skin-chat кладёт задний фон переписки, выбранный
       подписчиком. Пока оформление выключено, переменная равна none и класс
       ничего не меняет. */
    <div {...dropPaste.dropProps} className="tz-skin-chat flex-1 flex flex-col h-full min-w-0 relative">
      {dropPaste.isDragOver && (
        <div className="tz-dropzone">Отпустите файлы, чтобы прикрепить</div>
      )}
      {/* Day-Night atmospheric background (optional) */}
      {dayNightEnabled && (
        <DayNightBackground opacity={dayNightOpacity / 100} />
      )}
      {/* Header */}
      <header className="h-12 border-b bg-[var(--cn-main)]/80 backdrop-blur-sm flex items-center px-4 gap-2 backdrop-blur-sm flex-shrink-0">
        {onBack && (
          <button onClick={onBack} className="md:hidden -ml-3 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-neutral-400 active:text-neutral-600 dark:active:text-white" aria-label="Открыть каналы">
            {/* MOBILE-DRAWER: кнопка открывает выдвижную панель каналов слева */}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round">
              <path d="M4 6h16M4 12h10M4 18h16" />
            </svg>
          </button>
        )}
        <span aria-hidden="true" className="flex items-center">{channelIcon ? channelIcon : (isNewsChannel ? <NewsIcon size={18} tone="active" /> : <ChatIcon size={18} tone="active" />)}</span>
        <span className="font-medium text-neutral-900 dark:text-white text-sm">{channelName}</span>
        {isNewsChannel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">
            Новости
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* FIX-NEWSGEAR: в разделе новостей не было шестерёнки настроек, хотя
              в остальных модульных разделах она есть. Показываем её тем, кто
              может настраивать канал (владелец, администратор, модератор). */}
          {isNewsChannel && canPin && <ModuleSettingsButton channelId={channelId} />}
          {/* FIX-NEWS-MUTE: Заглушка раздела новостей. Моделей ради неё не заводим:
              ChannelMute уже есть и уже учитывается и при рассылке анонсов
              (lib/newsPost.ts), и теперь при подсчёте непрочитанных. Не хватало
              ровно этого переключателя. Состояние меняем сразу, а при ошибке
              возвращаем обратно: молчаливо врать про включённую тишину хуже
              всего — человек перестанет ждать уведомлений, а они придут. */}
          {isNewsChannel && (
            <button
              onClick={async () => {
                const next = !channelMuted;
                setChannelMuted(next);
                isMutedRef.current = next;
                try {
                  const res = await fetch("/api/channels/mute", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ channelId, muted: next }),
                  });
                  if (!res.ok) throw new Error(String(res.status));
                } catch {
                  setChannelMuted(!next);
                  isMutedRef.current = !next;
                }
              }}
              className={`p-1.5 rounded-lg transition-colors ${channelMuted ? "text-violet-500 dark:text-cyan-400 bg-violet-50 dark:bg-cyan-900/20" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-white"}`}
              aria-label={channelMuted ? "Включить уведомления о новостях" : "Заглушить новости"}
              aria-pressed={channelMuted}
              title={channelMuted ? "Новости заглушены" : "Заглушить новости"}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
                {channelMuted && <path strokeLinecap="round" d="M4 4l16 16" />}
              </svg>
            </button>
          )}
          <button
            onClick={() => { setShowPinned(!showPinned); if (!showPinned) fetchPinned(); }}
            className={`p-1.5 rounded-lg transition-colors ${showPinned ? "text-violet-500 dark:text-cyan-400 bg-violet-50 dark:bg-cyan-900/20" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-white"}`}
            aria-label="Pinned messages"
            title="Закреплённые"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Pinned messages panel */}
      {showPinned && (
        <div className="border-b border-[var(--cn-border)] bg-[var(--cn-accent-dim)] max-h-[40vh] overflow-y-auto">
          <div className="px-4 py-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider flex items-center justify-between">
            <span>Закреплённые ({pinnedMessages.length})</span>
            <button onClick={() => setShowPinned(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          {pinnedMessages.length === 0 ? (
            <p className="px-4 pb-3 text-sm text-neutral-400">Нет закреплённых сообщений</p>
          ) : (
            pinnedMessages.map(pm => (
              <div key={pm.id} className="px-4 py-2 flex items-start gap-2 hover:bg-black/5 dark:hover:bg-white/5 border-b border-[var(--cn-border)] last:border-0">
              <div className="flex-1 min-w-0 relative">

                  <span className="text-xs font-medium text-accent">{pm.user.name}</span>
                  <p className="text-sm text-[var(--cn-text)] line-clamp-2">{pm.content || "[файл]"}</p>
                </div>
                {canPin && (
                  <button onClick={() => togglePin(pm.id)} className="flex-shrink-0 p-1 text-neutral-400 hover:text-red-500" title="Открепить">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* NEWS: под общей шапкой канала вместо переписки — лента постов.
          Шапка, панель закреплённого и все окна ниже (пересылка, карточка
          участника, подтверждения) остаются общими: в новостях у канала то же
          имя, та же шестерёнка настроек и та же кнопка «назад», и разводить два
          набора одной и той же шапки значило бы чинить каждую правку дважды.
          Разметка переписки ниже не тронута — она целиком ушла во вторую ветку
          этого же условия. */}
      {isNewsChannel ? (
        <div className="relative min-h-0 flex-1">
          {/* key по каналу — лента пересоздаётся, а не переезжает на новый
              channelId. Иначе при переходе между новостными разделами поверх
              новой ленты остался бы открытым пост из прежней (её экран поста
              живёт во внутреннем состоянии), а признак «можно публиковать»
              лента сообщает только на ИЗМЕНЕНИЕ — из true в true он бы не
              сработал, и кнопка «Написать» после сброса ниже не вернулась бы. */}
          <NewsFeed
            key={channelId}
            channelId={channelId}
            onCanPostChange={setNewsCanPost}
            onEditPost={setNewsEditPost}
            refreshToken={newsRefresh}
          />

          {/* Кнопка поверх ленты, а не в шапке: экран открытого поста лента
              рисует слоем над собой (выше по слоям), и «написать» сама собой
              скрывается на время чтения — из шапки она торчала бы над чужим
              постом.

              Отступ снизу — сумма, а не большее из двух. С max() на телефоне с
              полосой жестов кнопка вставала ровно на её верхнюю кромку: видно
              её было целиком, но нижняя треть попадала в зону, которой система
              ловит свайп вверх, и движение уходило не в приложение, а в список
              запущенных программ. Прибавляя безопасную зону к обычному отступу,
              оставляем между кнопкой и полосой те же шестнадцать точек, что и
              везде. На большом экране безопасная зона нулевая — отступ прежний.

              Место под кнопку в самой ленте резервирует NewsFeed
              (POST_BUTTON_CLEARANCE): своего места в потоке кнопка не занимает
              и иначе накрывает низ последней карточки. */}
          {newsCanPost && (
            <button
              type="button"
              onClick={() => setNewsComposerOpen(true)}
              className="absolute right-4 z-10 inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-violet-600 px-4 text-sm font-medium text-white shadow-lg transition-transform hover:scale-105 dark:bg-cyan-500 dark:text-neutral-950"
              style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <EditIcon size={16} style={{ color: "inherit" }} />
              Написать
            </button>
          )}

          {/* Редактор — отдельный экран во весь экран (он сам себя так и
              размещает), поэтому держим его здесь, рядом с кнопкой, а не среди
              окон переписки. Он же и правит существующий пост: экран поста
              сообщает наверх выбранную запись (onEditPost выше), а различие
              «создание или правка» для редактора — это один проп post.

              key разводит два случая: начальное состояние полей редактор берёт
              из пропа один раз, при создании, и без пересоздания правка после
              «Написать» открылась бы с пустыми полями. */}
          {(newsComposerOpen || newsEditPost) && (
            <NewsComposer
              key={newsEditPost ? `edit:${newsEditPost.id}` : "new"}
              channelId={channelId}
              post={newsEditPost}
              onClose={closeNewsComposer}
              /* Пост уже на сервере, а первая страница ленты у нас старая:
                 сдвигаем счётчик — лента перечитает её сама и получит порядок
                 (закреплённое, потом по дате) из одного места, с сервера. Она же
                 по этому счётчику закрывает открытый пост, иначе поверх новой
                 ленты остался бы его экран с текстом до правки. */
              onSaved={() => setNewsRefresh((n) => n + 1)}
            />
          )}
        </div>
      ) : (
        <>
        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 pb-4 pt-5"
          role="log"
          aria-label="Messages"
        >
          {hasMore && (
            <div className="text-center py-2">
              <button onClick={() => nextCursor && fetchMessages(nextCursor)} className="text-sm text-violet-500 dark:text-cyan-400 hover:underline">
                Загрузить ранее
              </button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-neutral-400">
              <div className="text-center">
                <span className="block mb-4 flex justify-center opacity-80"><ChatIcon size={56} tone="inactive" /></span>
                <p className="text-base font-semibold text-neutral-600 dark:text-neutral-300">Здесь пока пусто</p>
                <p className="text-sm mt-1 text-neutral-400">Будьте первым — напишите сообщение, чтобы начать обсуждение.</p>
              </div>
            </div>
          ) : (
            <>
            {/* Распорка вместо скрытых сверху строк: держит длину ползунка и не
                даёт ленте «схлопнуться» к нулевой высоте. */}
            {winPadTop > 0 && <div aria-hidden style={{ height: winPadTop }} />}
            {messages.slice(winStart, winEnd).map((msg, sliceIdx) => {
              /* Индекс в ПОЛНОМ массиве: от него зависят группировка с предыдущим
                 сообщением и анимация последнего. Иначе первая строка окна всегда
                 считалась бы началом беседы. */
              const idx = winStart + sliceIdx;
              const prev = idx > 0 ? messages[idx - 1] : null;
              const msgDate = new Date(msg.createdAt);
              const prevDate = prev ? new Date(prev.createdAt) : null;
              const showDateDivider = !prev
                || prevDate!.getDate() !== msgDate.getDate()
                || prevDate!.getMonth() !== msgDate.getMonth()
                || prevDate!.getFullYear() !== msgDate.getFullYear();
              // Сообщения одного автора объединяются только в короткую серию.
              // Между разными авторами и после паузы начинается новый визуальный блок.
              /* Считаем ровно так же, как эффект прокрутки к непрочитанному:
                 чужое сообщение без моей отметки в reads. */
              const isFirstUnread = msg.id === firstUnreadId;
              const isGrouped = !!prev
                && prev.user.id === msg.user.id
                && chatPrefs.groupWindowMin > 0
                && msgDate.getTime() - prevDate!.getTime() <= chatPrefs.groupWindowMin * 60 * 1000
                && !msg.replyTo
                && !msg.pinned
                && !showDateDivider;
              return (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  prefs={chatPrefs}
                  firstUnread={isFirstUnread}
                  showDateDivider={showDateDivider}
                  isGrouped={isGrouped}
                  animate={idx === messages.length - 1}
                  flashed={flashMessageId === msg.id}
                  editing={editingId === msg.id}
                  editContent={editingId === msg.id ? editContent : ""}
                  currentUserId={currentUserId}
                  isPrivilegedRole={isPrivilegedRole}
                  canPin={canPin}
                  channelId={channelId}
                  channelName={channelName}
                  channelMembers={channelMembers}
                  openUserCard={openUserCard}
                  cancelUserCardHover={cancelUserCardHover}
                  roleTags={roleTagMap}
                  groupEmoji={emojiMap}
                  groupEmojiList={groupEmojis}
                  ignoredIds={ignoredIds}
                  revealedIgnored={revealedIgnored}
                  displayName={displayName}
                  setReplyTo={setReplyTo}
                  onJumpToMessage={jumpToMessage}
                  setEditContent={setEditContent}
                  setRevealedIgnored={setRevealedIgnored}
                  setLightboxSrc={setLightboxSrc}
                  openThread={openThread}
                  toggleReaction={toggleReaction}
                  startEdit={startEdit}
                  saveEdit={saveEdit}
                  cancelEdit={cancelEdit}
                  deleteMessage={deleteMessage}
                  pinMessage={pinMessage}
                />
              );
            })}
            {winPadBottom > 0 && <div aria-hidden style={{ height: winPadBottom }} />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        <AnimatePresence>
          {showScrollBtn && (
            <motion.button
              key="scroll-btn"
              initial={{ opacity: 0, scale: 0.8, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 8 }}
              onClick={scrollToEnd}
              className="absolute bottom-24 right-6 z-10 w-9 h-9 rounded-full bg-violet-500 dark:bg-cyan-500 text-white shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
              aria-label="Прокрутить вниз"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Typing indicator */}
        <TypingIndicator socket={chatSocket} target={{ kind: "channel", channelId }} selfUserId={currentUserId} />

        {/* Reply indicator */}
        {replyTo && (
          <div className="px-4 py-2 border-t border-[var(--cn-border)] flex items-center gap-2 text-xs text-neutral-500 dark:text-gray-400 bg-[var(--cn-accent-dim)]">
            <div className="w-0.5 h-4 bg-violet-400 dark:bg-cyan-400 rounded-full" />
            <span>Ответ для <strong className="text-neutral-700 dark:text-gray-300">{replyTo.name}</strong>: {replyTo.content}</span>
            <button onClick={() => setReplyTo(null)} className="ml-auto text-neutral-400 hover:text-neutral-600 dark:hover:text-white">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}


        {/* Input */}
        {!canPost ? (
          <div className="p-3 border-t border-[var(--cn-border)] text-center text-neutral-400 text-sm flex items-center justify-center gap-2">
            <span aria-hidden="true" className="flex items-center"><LockIcon size={18} tone="muted" /></span>{readOnlyNotice}
          </div>
        ) : !isBanned ? (
          <div className="relative z-20 border-t border-[var(--cn-border)] bg-[var(--cn-main)]/80 backdrop-blur-sm">
            {/* Extra tools panel */}
            {showFormatBar && (
              <div className="px-3 pt-2 pb-1">
                <div className="flex flex-wrap items-center gap-1 p-2 rounded-lg bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10">
                  <span className="text-[10px] text-neutral-400 mr-1">Формат:</span>
                  <button type="button" onClick={() => insertFormat("**", "**")} className="px-2 py-1 text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Жирный">B</button>
                  <button type="button" onClick={() => insertFormat("*", "*")} className="px-2 py-1 text-xs italic text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Курсив">I</button>
                  <button type="button" onClick={() => insertFormat("`", "`")} className="px-2 py-1 text-xs font-mono text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Код">&lt;/&gt;</button>
                  {/* Блок кода. Рядом с «код внутри строки» — они про разное:
                      одиночные кавычки для имени переменной, тройные для куска
                      программы, где важны переносы и отступы. */}
                  <button type="button" onClick={wrapSelectionAsCode} className="px-2 py-1 text-xs font-mono text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Блок кода — переносы и отступы сохраняются">```</button>
                  <button type="button" onClick={() => insertFormat("- ", "")} className="px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Список">•</button>
                  <button type="button" onClick={() => insertFormat("#", "")} className="px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Упоминание канала">#</button>
                  <div className="w-px h-4 bg-neutral-200 dark:bg-white/10 mx-1" />
                  <button type="button" onClick={() => { setShowSchedule(!showSchedule); if (!showSchedule) loadScheduled(); }} className="px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors inline-flex items-center gap-1" title="Запланировать"><ClockIcon size={13} style={{ color: "inherit" }} /> Расписание</button>
                  <div className="flex-1" />
                  <button type="button" onClick={() => setShowFormatBar(false)} className="px-1.5 py-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors" title="Закрыть" aria-label="Закрыть"><XIcon size={13} style={{ color: "inherit" }} /></button>
                </div>
              </div>
            )}

            {/* Slowmode indicator */}
            {slowmodeWait > 0 && (
              <div className="px-3 py-1 text-xs text-amber-500">
                Слоумод: подождите {slowmodeWait} сек.
              </div>
            )}

            {/* Schedule panel */}
            {showSchedule && (
              <div className="px-3 py-2 border-b border-[var(--cn-border)] bg-[var(--cn-accent-dim)]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-neutral-600 dark:text-gray-300">Запланировать отправку:</span>
                  <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="input-field !py-1 !px-2 text-xs" />
                  <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="input-field !py-1 !px-2 text-xs" />
                  <button type="button" onClick={scheduleMessage} disabled={!newMessage.trim() || !scheduleDate || !scheduleTime} className="btn-primary !py-1 !px-3 text-xs disabled:opacity-50">Запланировать</button>
                  {/* FIX-SCHED-CLOSE: панель открывалась из меню «Отложенная
                      отправка», но закрыть её было нечем: кнопка-переключатель есть
                      только в панели форматирования, а из меню инструментов состояние
                      выставлялось безусловно (setShowSchedule(true)). Если передумал —
                      выйти было нельзя. Закрытие заодно чистит незавершённый выбор
                      даты/времени, чтобы при следующем открытии не всего было старого. */}
                  <button
                    type="button"
                    onClick={() => { setShowSchedule(false); setScheduleDate(""); setScheduleTime(""); }}
                    className="ml-auto p-1 rounded text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    title="Закрыть"
                    aria-label="Закрыть панель отложенной отправки"
                  >
                    <XIcon size={14} style={{ color: "inherit" }} />
                  </button>
                </div>
                {scheduledList.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] text-neutral-400">Запланированные:</span>
                    {scheduledList.map(s => (
                      <div key={s.id} className="flex items-center gap-2 text-xs text-neutral-500">
                        <span>{new Date(s.scheduledAt).toLocaleString("ru")}</span>
                        <span className="truncate flex-1">{s.content.slice(0, 50)}</span>
                        <button onClick={() => deleteScheduled(s.id)} className="text-red-400 hover:text-red-600" aria-label="Удалить запланированное"><XIcon size={12} style={{ color: "inherit" }} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="p-3">
              {/* FIX-UPLOAD: полоска прогресса загрузки файла */}
              {uploading && uploadProgress && (
                <div className="mb-2 px-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-gray-400 mb-1">
                    <span className="truncate">
                      Загрузка{uploadProgress.total > 1 ? ` ${uploadProgress.index}/${uploadProgress.total}` : ""}: {uploadProgress.name}
                    </span>
                    <span className="flex-shrink-0 tabular-nums">{uploadProgress.percent}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-violet-500 dark:bg-cyan-400 transition-[width] duration-150"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
              {recordingVoice ? (
                <VoiceRecorder onRecorded={handleVoiceRecorded} />
              ) : (
                <form onSubmit={sendMessage} onDragOver={(e) => { e.preventDefault(); if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) setIsDragOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false); }} onDrop={handleDrop} className={`flex flex-col rounded-2xl border transition-colors px-2 py-1.5 focus-within:ring-2 focus-within:ring-violet-400/20 dark:focus-within:ring-cyan-400/20 focus-within:border-violet-400 dark:focus-within:border-cyan-400 ${isDragOver ? "bg-violet-50 dark:bg-cyan-900/10 border-violet-300 dark:border-cyan-700" : "border-[var(--cn-border)] bg-[var(--cn-card)]"}`}>
                  {/* MOBILE-FIX: вложения — отдельным рядом над строкой ввода. Раньше
                      этот блок стоял в одной flex-строке с кнопками и textarea и
                      сжимал поле ввода (на телефоне — до нуля, «всё съезжает»). */}
                  {pendingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-1 pt-1 pb-2">
                      {pendingAttachments.map((attachment, index) => (
                        <div key={`${attachment.url}-${index}`} className="flex items-center gap-2 max-w-[220px] rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3 py-2 text-xs text-neutral-600 dark:text-gray-300">
                          <span className="truncate">{attachment.name}</span>
                          {attachment.isImage && (
                            <button
                              type="button"
                              onClick={() => setEditingAttachment(index)}
                              className="text-neutral-400 hover:text-violet-600 dark:hover:text-cyan-400"
                              title="Редактировать рисунок"
                              aria-label="Редактировать рисунок"
                            >
                              <EditIcon size={14} style={{ color: "inherit" }} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== index))}
                            className="text-neutral-400 hover:text-red-500"
                            aria-label="Удалить вложение"
                          >
                            <XIcon size={13} style={{ color: "inherit" }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* relative — под панель записи заметки: на время записи
                      мини-редактор раскрывается во всю ширину строки поверх поля
                      ввода (см. MediaNoteRecorder). */}
                  <div className="relative flex w-full items-end gap-2">
                  <PlusMenu
                    channelId={channelId}
                    onCreated={() => setToolsRefresh((n) => n + 1)}
                    onAttach={() => fileInputRef.current?.click()}
                    onImage={() => fileInputRef.current?.click()}
                    onGeo={() => setShowGeoPicker(true)}
                    onToggleFormat={() => setShowFormatBar((v) => !v)}
                    onSchedule={() => { setShowSchedule((v) => { const next = !v; if (next) loadScheduled(); return next; }); }}
                    formatActive={showFormatBar}
                  />
                  {/* Набор сообщества показывается в этой же кнопке, а не рядом:
                      отдельная кнопка была ошибкой — свои эмодзи ищут там, где
                      все остальные. */}
                  <TriozEmojiButton onSelect={insertEmoji} groupEmojis={groupEmojis} />
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept={CHAT_ATTACHMENT_ACCEPT} multiple />
                  <div className="relative flex-1">
                    {composerMentions.open && (
                      <MentionPopupList
                        entries={composerMentions.entries}
                        activeIndex={composerMentions.activeIndex}
                        onPick={(entry) => composerMentions.pick(entry, newMessage)}
                        onHover={composerMentions.setActiveIndex}
                      />
                    )}
                    {/* FIX-TAGMENTION: подсказка тегов сообщества по «#» */}
                    {!composerMentions.open && composerTags.open && (
                      <TagPopupList
                        entries={composerTags.entries}
                        activeIndex={composerTags.activeIndex}
                        onPick={(entry) => composerTags.pick(entry, newMessage)}
                        onHover={composerTags.setActiveIndex}
                      />
                    )}
                    {/* FIX-FWDBUF: полоса «выберите получателя» — одна и та же в каналах и ЛС. */}
                    <ForwardPendingBar onSendHere={forwardHere} disabled={!channelId} />
                    <textarea
                      ref={textareaRef}
                      value={newMessage}
                      onChange={(e) => { updateChannelDraft(e.target.value); composerMentions.update(e.target.value, e.target.selectionStart ?? e.target.value.length); composerTags.update(e.target.value, e.target.selectionStart ?? e.target.value.length); emitTyping(); }}
                      onPaste={(e) => dropPaste.handlePaste(e, handleTextPaste)}
                      onKeyDown={(e) => {
                        if (composerMentions.handleKeyDown(e, newMessage)) return;
                        if (composerTags.handleKeyDown(e, newMessage)) return; // FIX-TAGMENTION
                        /* MOBILE-UI: на сенсорных устройствах Enter — перенос строки,
                           отправка — кнопкой (как в мобильных мессенджерах). */
                        /* MOBILE-UI выше: на сенсорных Enter всегда переносит строку.
                           На остальных решает настройка: либо Enter отправляет
                           (Shift+Enter — перенос), либо наоборот — Enter переносит,
                           а отправляет Ctrl+Enter. */
                        if (window.matchMedia("(hover: none)").matches) return;
                        if (e.key !== "Enter") return;
                        if (chatPrefs.sendOnEnter) {
                          if (!e.shiftKey) { e.preventDefault(); sendMessage(e); }
                        } else if (e.ctrlKey || e.metaKey) {
                          e.preventDefault(); sendMessage(e);
                        }
                      }}
                      onClick={(e) => composerMentions.update(newMessage, e.currentTarget.selectionStart ?? newMessage.length)}
                      onBlur={() => setTimeout(composerMentions.close, 150)}
                      placeholder={slowmodeWait > 0 ? `Слоумод: ${slowmodeWait} сек...` : "Сообщение"}
                      className="input-field w-full !py-2.5 resize-none overflow-y-auto leading-tight placeholder:truncate"
                      rows={1}
                      style={{ minHeight: 44, maxHeight: 120 }}
                      disabled={slowmodeWait > 0}
                      aria-label={`Message ${channelName}`}
                    />
                    {/* Счётчик появляется только у длинного текста: постоянно
                        висящие цифры под полем ввода мешают, а узнать о пределе
                        после того, как всё набрано, — ещё хуже. */}
                    {composerWords > limits.words / 2 && (
                      <div
                        className={`mt-1 text-right text-[11px] tabular-nums ${
                          composerOverLimit ? "text-red-500" : "text-neutral-400 dark:text-neutral-500"
                        }`}
                      >
                        {composerWords.toLocaleString("ru-RU")} / {limits.words.toLocaleString("ru-RU")} слов
                        {newMessage.length > limits.chars / 2 &&
                          ` · ${newMessage.length.toLocaleString("ru-RU")} / ${limits.chars.toLocaleString("ru-RU")} знаков`}
                        {!isPremiumAccount && composerOverLimit && " · с Premium вдвое больше"}
                      </div>
                    )}
                  </div>
                  {newMessage.trim() || pendingAttachments.length > 0 ? (
                    <button type="submit" disabled={slowmodeWait > 0 || sending || uploading || composerOverLimit} className="btn-primary !px-4 !py-2.5 disabled:opacity-50" aria-label="Send message" title={composerOverLimit ? "Сообщение слишком длинное" : undefined}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  ) : isMobileViewport ? (
                    /* На телефоне — запись с мини-редактором: короткое нажатие
                       переключает микрофон и квадрат, удержание пишет, отпускание
                       ставит паузу. На настольной версии остаётся прежняя запись
                       голоса: удерживать кнопку мышью — не жест настольного
                       приложения, а камера у монитора для квадратов не годится. */
                    <MediaNoteRecorder onRecorded={handleVoiceRecorded} disabled={uploading} allowVideo />
                  ) : (
                    <VoiceRecorder onRecorded={handleVoiceRecorded} disabled={uploading} />
                  )}
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3 border-t border-[var(--cn-border)] text-center text-red-400/60 text-sm">
            Отправка сообщений ограничена
          </div>
        )}
        </>
      )}

      {/* Thread Panel */}
      <AnimatePresence>
        {activeThread && (
          <ThreadPanel
            emoji={emojiMap}
            rootMessage={activeThread}
            anchor={threadAnchor}
            replies={threadMessages}
            input={threadInput}
            loading={threadLoading}
            sending={threadSending}
            error={threadError}
            onInputChange={(value) => {
              setThreadInput(value);
              const key = `tz-chat-draft:thread:${activeThread.id}`;
              if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
            }}
            onSend={sendThreadReply}
            onClose={() => { setActiveThread(null); setThreadError(null); setThreadAnchor(null); }}
          />
        )}
      </AnimatePresence>

      {/* Image Lightbox */}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {/* FIX-DRAW: редактор приложенной картинки в композере */}
      {editingAttachment !== null && pendingAttachments[editingAttachment]?.isImage && (
        <DrawingEditor
          initialImage={pendingAttachments[editingAttachment].url}
          title="Редактирование изображения"
          saveLabel="Сохранить и заменить"
          onSave={saveEditedAttachment}
          onClose={() => setEditingAttachment(null)}
        />
      )}

      {/* Forward modal */}
      <ForwardModal
        forwardMsg={forwardMsg}
        search={forwardSearch}
        onSearchChange={setForwardSearch}
        targets={forwardTargets}
        sending={forwardSending}
        onForward={doForward}
        onClose={() => { setForwardMsg(null); setForwardSearch(""); }}
      />

      {/* Forward toast */}
      {forwardToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-green-500 text-white text-sm rounded-xl shadow-lg animate-fade-in">
          Сообщение переслано
        </div>
      )}

      {/* CENSOR: напоминание о рамках приличия. Стоит выше тоста ошибок и другим
          цветом: это не сбой, сообщение отправлено. */}
      {censorNotice && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 max-w-[340px] rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 shadow-lg animate-fade-in backdrop-blur">
          <strong className="block text-[13px] font-semibold">Держите себя в рамках приличия</strong>
          <span className="mt-0.5 block text-xs leading-relaxed opacity-90">
            В сообществе есть слова, которых здесь не ждут. Сообщение отправлено, но администрация это видит.
          </span>
        </div>
      )}

      {/* Error toast */}
      {errorToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-500 text-white text-sm rounded-xl shadow-lg animate-fade-in">
          {errorToast}
        </div>
      )}

      {/* Confirm modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirmModal(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative z-10 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-neutral-900 dark:text-white mb-4">{confirmModal.message}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmModal(null)} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5">Отмена</button>
              <button onClick={confirmModal.onConfirm} className="px-4 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors">Удалить</button>
            </div>
          </div>
        </div>
      )}
      {/* Right-click user context menu */}
      {userMenu && (
        <UserContextMenu
          user={{
            ...userMenu.user,
            /* lastSeen у автора сообщения приходит не всегда — прежняя карточка
               добирала его из списка участников канала, и без этого строка
               «был(а) …» пропала бы. */
            lastSeen: userMenu.user.lastSeen ?? channelMembers.find((m) => m.id === userMenu.user.id)?.lastSeen ?? null,
          }}
          x={userMenu.x}
          y={userMenu.y}
          currentUserId={currentUserId}
          groupId={groupMeta?.groupId ?? null}
          targetMemberId={menuMember?.id ?? null}
          viewerRole={currentUserCommunityRole}
          targetRole={menuMember?.role ?? null}
          targetTags={userMenu.user.groupRoles ?? []}
          onPointerKeep={clearCardTimer}
          onPointerAway={cancelUserCardHover}
          message={{ id: userMenu.msg.id, channelId }}
          roles={groupMeta?.roles ?? []}
          targetRoleIds={menuMember?.roleIds ?? []}
          nickname={localNicks[userMenu.user.id] ?? null}
          ignored={ignoredIds.has(userMenu.user.id)}
          onClose={closeUserMenu}
          onMention={handleMenuMention}
          onOpenDm={handleMenuOpenDm}
          onSetNickname={(nick) => setLocalNickname(userMenu.user.id, nick)}
          onToggleIgnore={() => toggleIgnoreUser(userMenu.user.id)}
        />
      )}
      <GeoPicker open={showGeoPicker} onClose={() => setShowGeoPicker(false)} onSend={sendGeolocation} />
    </div>
  );
}
