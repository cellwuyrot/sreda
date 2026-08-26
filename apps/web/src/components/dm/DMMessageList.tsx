"use client";

/* FIX-DM-DOTS: useEffect/useRef держались здесь только ради обработчика «клик
   мимо меню» — вместе с меню «три точки» ушли и они. */
import { Fragment } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import VoicePlayer from "@/components/ui/VoicePlayer";
import VideoPlayer from "@/components/ui/VideoPlayer";
import VideoNotePlayer from "@/components/ui/VideoNotePlayer";
import MessageBody from "@/components/connect/MessageBody";
import MessageHoverToolbar from "@/components/connect/MessageHoverToolbar";
/* HOVER-GRACE: запас времени на перевод мыши с текста на кнопки бара. */
import { useHoverToolbar } from "@/components/connect/useHoverToolbar";
/* FIX-IMGMENU: правый клик и долгое нажатие на картинке — тот же компонент, что и в каналах. */
import ImageContextMenu, { useImageContextMenu } from "@/components/ui/ImageContextMenu";
import { TriozEmoji } from "@/components/ui/TriozEmoji";
// FIX-ICONS: единый стиль иконок — фирменные SVG вместо PNG (/icons/*) и глифов ✓✕💬
import { PinIcon, ThreadIcon, ShieldIcon, XIcon, CheckIcon, DoubleCheckIcon, ClockIcon, ResendIcon, ChatIcon, VaultIcon } from "@/components/ui/ConnectIcons";
// Leaflet touches `window` — load client-only
const GeoMap = dynamic(() => import("@/components/ui/GeoMap"), { ssr: false });
import { getDayLabel, parseAttachments, type Attachment, type Message } from "./dmTypes";

interface DMMessageListProps {
  messages: Message[];
  currentUserId: string;
  selectedConvId: string;
  // Editing state
  editingId: string | null;
  editContent: string;
  onEditContentChange: (v: string) => void;
  onSaveEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  // Reply
  onReply: (msg: Message) => void;
  // Delete
  onDelete: (messageId: string) => void;
  /* FIX-DM-DOTS: меню «три точки» убрано целиком — все действия переехали в
     hover-бар сообщения. Поэтому пропсы его состояния (openMessageMenuId,
     onToggleMenu, showEmojiPicker, onToggleEmojiPicker) больше не нужны. */
  onToggleReaction: (messageId: string, emoji: string) => void;
  // Pin
  onPin: (messageId: string) => void;
  // Thread
  onOpenThread: (msg: Message) => void;
  // Forward
  onForward: (msg: Message) => void;
  // Add to favorites (self-conversation)
  onFavorite: (msg: Message) => void;
  /* BUSINESS-PAY: деловой разговор — не личная переписка. «В Сейф», «Переслать»
     и «На доску» там убраны: деловая переписка ведётся с администрацией по
     конкретному обращению, и растаскивание её кусков по личным сейфам, чужим
     диалогам и общим доскам — это утечка, а не удобство. Пропсы обработчиков
     остаются обязательными: список не должен знать, чем именно их подменили,
     он лишь перестаёт показывать кнопки. */
  isBusiness?: boolean;
  // Start edit helper
  onStartEdit: (msg: Message) => void;
  // Read receipt
  peerReadAt: string | null;
  // Resend failed message
  onResend: (messageId: string) => void;
  // E2EE file decryption
  onDecryptFile: (encrypted: ArrayBuffer, iv: string) => Promise<ArrayBuffer>;
  // Image lightbox
  onImageClick: (src: string) => void;
  // Scroll handling
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  /* Оконный рендер: границы и высоты распорок считает DMPanel через
     useMessageWindow — здесь только отрисовка. */
  winStart: number;
  winEnd: number;
  winPadTop: number;
  winPadBottom: number;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  hasMore: boolean;
  nextCursor: string | null;
  messagesLoading: boolean;
  onLoadMore: () => void;
  showScrollBtn: boolean;
  onScrollToBottom: () => void;
}

// FIX-SEC-XSS: в src/href вложений допускаем только безопасные схемы. URL
// приходит в JSON сообщения — нельзя доверять слепо (иначе javascript:/data:
// сработают по клику/при загрузке картинки).
function safeAttachmentUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("/uploads/")) return url;
  try {
    const u = new URL(url, "https://x.invalid");
    if (u.protocol === "http:" || u.protocol === "https:") return url;
  } catch { /* невалидный URL */ }
  return null;
}

function jumpToDMMessage(id: string) {
  const el = document.getElementById(`dm-msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const prevBg = el.style.backgroundColor;
  el.style.transition = "background-color 0.4s ease";
  el.style.borderRadius = "0.5rem";
  el.style.backgroundColor = "rgba(34,211,238,0.18)";
  window.setTimeout(() => { el.style.backgroundColor = prevBg; }, 1400);
}

export default function DMMessageList(props: DMMessageListProps) {
  /* Меню одно на весь список: открыта всегда ровно одна копия, и не нужно плодить
     по подписке на mousedown/keydown для каждого вложения в длинной переписке. */
  const imageMenu = useImageContextMenu();
  /* HOVER-GRACE: бар висит над пузырём, через зазор — чистый CSS `:hover` гасил его
     ровно в момент, когда курсор шёл к кнопкам. Подробно — в useHoverToolbar. */
  const hoverBar = useHoverToolbar();
  const {
    messages,
    currentUserId,
    editingId,
    editContent,
    onEditContentChange,
    onSaveEdit,
    onCancelEdit,
    onReply,
    onDelete,
    onToggleReaction,
    onPin,
    onOpenThread,
    onForward,
    onFavorite,
    onStartEdit,
    isBusiness = false,
    peerReadAt,
    onResend,
    onDecryptFile,
    onImageClick,
    scrollContainerRef,
    winStart,
    winEnd,
    winPadTop,
    winPadBottom,
    messagesEndRef,
    onScroll,
    hasMore,
    nextCursor,
    messagesLoading,
    onLoadMore,
    showScrollBtn,
    onScrollToBottom,
  } = props;

  // Render aggregated reactions for a message
  const renderReactions = (msg: Message) => {
    const reactions = msg.reactions || [];
    if (reactions.length === 0) return null;
    // Group by emoji
    const grouped: Record<string, { count: number; users: string[]; userReacted: boolean }> = {};
    for (const r of reactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, users: [], userReacted: false };
      grouped[r.emoji].count++;
      grouped[r.emoji].users.push(r.user?.name || "User");
      if (r.userId === currentUserId) grouped[r.emoji].userReacted = true;
    }
    return (
      <div className="tz-reaction-row mt-1">
        {Object.entries(grouped).map(([emoji, info]) => (
          <button
            key={emoji}
            onClick={() => onToggleReaction(msg.id, emoji)}
            title={info.users.join(", ")}
            /* FIX-EMOJI: тот же случай, что и в каналах — глиф 20px внутри строки 16px.
               Выравнивание вынесено в tz-reaction-pill, чтобы три места с реакциями
               не расходились при следующей правке. */
            className={`tz-reaction-pill px-2 py-1 rounded-full text-[12px] transition-colors ${
              info.userReacted
                ? "bg-violet-500/20 dark:bg-cyan-400/20 border border-violet-400 dark:border-cyan-400"
                : "bg-black/5 dark:bg-white/10 border border-transparent hover:bg-black/10 dark:hover:bg-white/15"
            }`}
          >
            <TriozEmoji emoji={emoji} size={20} />
            <span className={`tz-reaction-count ${info.userReacted ? "text-violet-600 dark:text-cyan-300" : "text-neutral-500 dark:text-gray-400"}`}>
              {info.count}
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <>
      <div ref={scrollContainerRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-2 md:px-4 py-4 space-y-0.5" role="log" aria-label="Личные сообщения">
        {hasMore && (
          <button onClick={onLoadMore} disabled={messagesLoading} className="mx-auto flex items-center gap-1.5 rounded-full border border-neutral-200 dark:border-white/10 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm px-4 py-1.5 text-xs font-medium text-neutral-600 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5 shadow-sm disabled:opacity-50 transition-all">
            {messagesLoading ? (
              <><svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30" strokeDashoffset="10"/></svg>Загрузка…</>
            ) : (
              <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 15l7-7 7 7"/></svg>История</>
            )}
          </button>
        )}
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-400">
            <div className="text-center">
              <ChatIcon size={44} className="mx-auto mb-3" tone="muted" />
              <p className="text-sm">Нет сообщений. Начните общение!</p>
            </div>
          </div>
        ) : (
          <>
          {/* Распорка вместо скрытых сверху строк: держит длину ползунка. */}
          {winPadTop > 0 && <div aria-hidden style={{ height: winPadTop }} />}
          {messages.slice(winStart, winEnd).map((msg, sliceIdx) => {
            /* Индекс в ПОЛНОМ массиве: от него зависят группировка с предыдущим
               сообщением и анимация последнего. */
            const idx = winStart + sliceIdx;
            const prev = idx > 0 ? messages[idx - 1] : null;
            // Message grouping: same user, no reply, not pinned, < 5 min apart
            const isGrouped = prev
              && prev.userId === msg.userId
              && !msg.replyTo
              && !msg.pinned
              && (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000;
            const msgDate = new Date(msg.createdAt);
            const prevDate = prev ? new Date(prev.createdAt) : null;
            const showDateDivider = !prev
              || prevDate!.getDate() !== msgDate.getDate()
              || prevDate!.getMonth() !== msgDate.getMonth()
              || prevDate!.getFullYear() !== msgDate.getFullYear();
            // PERF-CHAT: анимируем «въезд» только у самого свежего сообщения. Остальные
            // строки — обычные <div>, чтобы не держать тысячи framer-motion компонентов
            // при большой истории (совместно с content-visibility в globals.css).
            const isLast = idx === messages.length - 1;
            /* FIX-DM-DOTS: класс tz-cv-show снимал paint-containment ради
               выпадающего меню. Меню больше нет, а свой пикер реакций hover-бар
               снимает сам (см. MessageHoverToolbar) — значит и дёргать раскладку
               строки при открытии меню больше нечем. */
            /* HOVER-GRACE: класс tz-msg-hot держит бар видимым дольше самого наведения.
               Активный id один на список, поэтому при переходе на другое сообщение
               предыдущий бар гаснет сам, без отдельного сброса. */
            const barHot = hoverBar.activeId === msg.id;
            const holdBar = () => hoverBar.hold(msg.id);
            const releaseBar = () => hoverBar.release(msg.id);
            const dmRowClassName = `tz-msg-row tz-dm-msg-row ${barHot ? "tz-msg-hot " : ""}${msg.userId === currentUserId ? "tz-dm-own flex-row-reverse" : "tz-dm-peer"} group/dm flex items-end gap-2 py-0.5 px-1 ${msg.pinned ? "bg-amber-50/50 dark:bg-amber-400/5 rounded-2xl" : ""}`;
            const dmRowBody = (
              <>
                  {!msg.deleted && (
                    <MessageHoverToolbar
                      message={{ id: msg.id, content: msg.content, attachments: parseAttachments(msg.attachments).map((a) => ({ url: a.url, name: a.name, mime: a.type })) }}
                      canEdit={msg.userId === currentUserId}
                      canDelete={msg.userId === currentUserId}
                      pinned={msg.pinned}
                      onReply={() => onReply(msg)}
                      onEdit={() => onStartEdit(msg)}
                      onDelete={() => onDelete(msg.id)}
                      onPin={() => onPin(msg.id)}
                      /* BUSINESS-PAY: undefined, а не пустая функция. Бар сам
                         решает, рисовать ли кнопку, по наличию обработчика
                         (см. MessageHoverToolbar) — так кнопка исчезает целиком,
                         а не остаётся мёртвой. То же с boardContext. */
                      onForward={isBusiness ? undefined : () => onForward(msg)}
                      onThread={() => onOpenThread(msg)}
                      onReact={(emoji) => onToggleReaction(msg.id, emoji)}
                      boardContext={isBusiness ? undefined : { authorName: msg.user?.name }}
                      /* Наведение на сам бар замораживает таймер скрытия. */
                      onHoverStart={holdBar}
                      onHoverEnd={releaseBar}
                    >
                      {/* FIX-DM-DOTS: раньше здесь были «три точки», открывавшие
                          выпадающее меню поверх переписки. Теперь это просто ещё
                          одна кнопка бара — без всплывающей панели, которой было
                          некуда поместиться. */}
                      {!isBusiness && (
                        <button type="button" onClick={() => onFavorite(msg)} title="В Сейф" aria-label="Добавить в Сейф">
                          <VaultIcon size={16} />
                        </button>
                      )}
                    </MessageHoverToolbar>
                  )}
                  <div className={`max-w-[80%] md:max-w-[640px] px-3.5 py-2.5 shadow-sm ${
                    msg.userId === currentUserId
                      ? "bg-gradient-to-br from-violet-600 to-violet-700 dark:from-cyan-700 dark:to-cyan-800 text-white rounded-[20px] rounded-br-[5px]"
                      : "bg-[var(--cn-card)] border border-[var(--cn-border)] text-neutral-900 dark:text-white rounded-[20px] rounded-bl-[5px]"
                  }`}>
                    {/* Pin indicator */}
                    {msg.pinned && (
                      <div className={`flex items-center gap-1 text-[10px] mb-0.5 ${msg.userId === currentUserId ? "text-amber-200" : "text-amber-500"}`}>
                        <PinIcon size={14} style={{ color: "inherit" }} className="!text-current" />
                        Закреплено
                      </div>
                    )}

                    {/* Reply reference */}
                    {msg.replyTo && (
                      <button
                        type="button"
                        onClick={() => jumpToDMMessage(msg.replyTo!.id)}
                        title="Перейти к исходному сообщению"
                        className={`group/reply w-full text-left flex items-stretch gap-1.5 mb-1 rounded-md overflow-hidden transition-colors ${msg.userId === currentUserId ? "bg-white/10 hover:bg-white/20" : "bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10"}`}
                      >
                        <span className={`w-0.5 flex-shrink-0 rounded-full ${msg.userId === currentUserId ? "bg-white/60" : "bg-violet-500 dark:bg-cyan-400"}`} />
                        <span className="flex-1 min-w-0 py-0.5 pr-1 text-[11px] leading-tight">
                          <span className={`font-medium ${msg.userId === currentUserId ? "text-white/90" : "text-violet-600 dark:text-cyan-400"}`}>{msg.replyTo.user.name}</span>{" "}
                          <span className={`truncate inline-block max-w-[150px] align-bottom ${msg.userId === currentUserId ? "text-white/70" : "text-neutral-500 dark:text-neutral-400"}`}>{msg.replyTo.content?.slice(0, 50) || "[файл]"}</span>
                        </span>
                        <svg className={`w-3 h-3 mt-0.5 mr-0.5 flex-shrink-0 opacity-0 group-hover/reply:opacity-100 transition-opacity ${msg.userId === currentUserId ? "text-white/70" : "text-neutral-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                      </button>
                    )}

                    {editingId === msg.id ? (
                      <div className="flex gap-1">
                        <input
                          value={editContent}
                          onChange={(e) => onEditContentChange(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && onSaveEdit(msg.id)}
                          className="flex-1 bg-transparent border-b border-white/30 text-sm outline-none"
                          autoFocus
                        />
                        <button onClick={() => onSaveEdit(msg.id)} className="opacity-70 hover:opacity-100" aria-label="Сохранить"><CheckIcon size={14} style={{ color: "inherit" }} /></button>
                        <button onClick={onCancelEdit} className="opacity-70 hover:opacity-100" aria-label="Отменить"><XIcon size={14} style={{ color: "inherit" }} /></button>
                      </div>
                    ) : (
                      /* Длинное сообщение показывается свёрнутым — см. MessageBody. */
                      /* div, а не p: внутри бывают блоки — код и свёрнутый
                         длинный текст, — абзац их не допускает. */
                      msg.content && <div data-i18n-skip className="tz-chat-body whitespace-pre-wrap break-words"><MessageBody text={msg.content} /></div>
                    )}

                    {/* FIX-EDITBLINK: вложения живут ВНЕ ветки редактирования.
                        Раньше они стояли внутри неё, и переключение «читаю →
                        редактирую → сохранил» снимало их с дерева и вешало
                        заново. Для React это новый узел, для браузера — новая
                        картинка: она перерисовывается с нуля, и это видно как
                        мигание. Заодно во время правки сообщения его картинки
                        были не видны — а правят как раз подпись к ним. */}
                    {parseAttachments(msg.attachments).map((att: Attachment, i) => (
                          att.isVoice ? (
                            <div key={i} className="mt-1">
                              <VoicePlayer
                                url={att.url}
                                duration={att.duration}
                                isOwn={msg.userId === currentUserId}
                                e2eeIv={att.e2eeIv}
                                e2eeDecrypt={att.e2eeIv ? onDecryptFile : undefined}
                              />
                            </div>
                          ) : att.isGeo && att.lat != null && att.lng != null ? (
                            <div key={i} className="mt-1 w-[220px]">
                              <GeoMap lat={att.lat} lng={att.lng} height={140} interactive={false} />
                              {/* FIX-GEO: показываем адрес (улица, дом, город), если он определён */}
                              <p className={`text-[10px] mt-1 ${msg.userId === currentUserId ? "text-white/60" : "text-neutral-400"}`}>
                                {att.address || `${att.lat.toFixed(4)}, ${att.lng.toFixed(4)}`}
                              </p>
                            </div>
                          ) : att.isVideoNote ? (
              /* Видеосообщение — квадрат, играет по касанию. */
              <VideoNotePlayer key={i} url={att.url} duration={att.duration} />
            ) : att.isVideo ? (
                            <div key={i} className="mt-1">
                              <VideoPlayer url={att.url} isOwn={msg.userId === currentUserId} />
                            </div>
                          ) : att.isImage && safeAttachmentUrl(att.url) ? (
                            <div key={i} className="mt-1">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {/* FIX-IMGMENU: та же привязка, что и в каналах — правый клик плюс
                                  долгое нажатие. Имя вложения здесь есть, и именно под ним файл
                                  сохранится. */}
                              <img
                                src={safeAttachmentUrl(att.url) as string}
                                alt={att.name}
                                className="w-auto max-w-full sm:max-w-[320px] max-h-[360px] object-cover rounded-xl border border-white/10 cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => onImageClick(safeAttachmentUrl(att.url) as string)}
                                {...imageMenu.bind(safeAttachmentUrl(att.url) as string, att.name)}
                              />
                            </div>
                          ) : safeAttachmentUrl(att.url) ? (
                            <a key={i} href={safeAttachmentUrl(att.url) as string} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs underline opacity-80">
                              {att.name}
                            </a>
                          ) : (
                            // FIX-SEC-XSS: небезопасная схема URL — показываем имя без ссылки
                            <span key={i} className="mt-1 block text-xs opacity-60" title="Небезопасная ссылка">{att.name}</span>
                          )
                        ))}
                    {editingId !== msg.id && (
                      <>
                        {renderReactions(msg)}
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-[10px] ${msg.userId === currentUserId ? "text-white/60" : "text-neutral-400"}`}>
                            {new Date(msg.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {msg.edited && <span className={`text-[9px] ${msg.userId === currentUserId ? "text-white/40" : "text-neutral-400"}`}>(ред.)</span>}
                          {/* Status icons (own messages only) */}
                          {msg.userId === currentUserId && (
                            <>
                              {msg.status === "failed" ? (
                                <button
                                  onClick={() => onResend(msg.id)}
                                  className="flex items-center gap-0.5 text-[9px] text-red-400 hover:text-red-300"
                                  title="Отправить повторно"
                                  aria-label="Отправить повторно"
                                >
                                  <ResendIcon size={15} style={{ color: "inherit" }} />
                                </button>
                              ) : msg.status === "sending" ? (
                                <span title="Отправляется" aria-label="Отправляется">
                                  <ClockIcon size={15} className="animate-pulse" style={msg.userId === currentUserId ? { color: "rgba(255,255,255,.85)" } : undefined} />
                                </span>
                              ) : peerReadAt && new Date(peerReadAt) >= new Date(msg.createdAt) ? (
                                <span title="Прочитано" aria-label="Прочитано">
                                  <DoubleCheckIcon size={15} style={msg.userId === currentUserId ? { color: "rgba(255,255,255,.85)" } : undefined} />
                                </span>
                              ) : msg.status === "sent" ? (
                                <span title="Отправлено" aria-label="Отправлено">
                                  <CheckIcon size={15} style={msg.userId === currentUserId ? { color: "rgba(255,255,255,.85)" } : undefined} />
                                </span>
                              ) : null}
                            </>
                          )}
                          {msg._encrypted && (
                            <span title="Зашифровано" aria-label="Зашифровано">
                              <ShieldIcon size={15} style={{ color: "inherit" }} />
                            </span>
                          )}
                          {/* Thread count indicator */}
                          {(msg.threadCount ?? 0) > 0 && (
                            <button
                              onClick={() => onOpenThread(msg)}
                              className={`flex items-center gap-0.5 text-[9px] ${msg.userId === currentUserId ? "text-white/70 hover:text-white" : "text-violet-500 dark:text-cyan-400 hover:underline"}`}
                              title="Открыть тред"
                            >
                              <ThreadIcon size={15} style={{ color: "inherit" }} />
                              {msg.threadCount}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
              </>
            );
            return (
              <Fragment key={msg.id}>
                {showDateDivider && (
                  <div className="flex items-center gap-3 mt-4 mb-1 first:mt-0">
                    <div className="flex-1 h-px bg-[var(--cn-border)]" />
                    <span className="text-[11px] font-medium text-neutral-400 dark:text-gray-500 px-2">
                      {getDayLabel(msgDate)}
                    </span>
                    <div className="flex-1 h-px bg-[var(--cn-border)]" />
                  </div>
                )}
                {isLast ? (
                  <motion.div
                    id={`dm-msg-${msg.id}`}
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 26, mass: 0.75 }}
                    className={dmRowClassName}
                    onMouseEnter={holdBar}
                    onMouseLeave={releaseBar}
                  >
                    {dmRowBody}
                  </motion.div>
                ) : (
                  <div
                    id={`dm-msg-${msg.id}`}
                    className={dmRowClassName}
                    onMouseEnter={holdBar}
                    onMouseLeave={releaseBar}
                  >
                    {dmRowBody}
                  </div>
                )}
              </Fragment>
            );
          })}
          {winPadBottom > 0 && <div aria-hidden style={{ height: winPadBottom }} />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <motion.button
          initial={{ scale: 0.6, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          exit={{ scale: 0, opacity: 0 }}
          onClick={onScrollToBottom}
          className="absolute bottom-20 right-4 z-20 w-11 h-11 rounded-full bg-white/90 dark:bg-neutral-800/90 backdrop-blur-md border border-neutral-200/60 dark:border-white/10 shadow-xl flex items-center justify-center text-neutral-600 dark:text-gray-200 hover:bg-white dark:hover:bg-neutral-700 hover:shadow-2xl active:scale-95 transition-all duration-150"
          aria-label="Прокрутить вниз"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
        </motion.button>
      )}

      {/* FIX-IMGMENU: само меню рисуется через портал, поэтому место в разметке ему
          безразлично — важно лишь, чтобы оно было в дереве раз и не попадало в
          обрезающий контейнер сообщения. */}
      {imageMenu.menu && (
        <ImageContextMenu
          src={imageMenu.menu.src}
          name={imageMenu.menu.name}
          x={imageMenu.menu.x}
          y={imageMenu.menu.y}
          onClose={imageMenu.close}
          onOpen={() => onImageClick(imageMenu.menu!.src)}
        />
      )}
    </>
  );
}