// Shared types and helpers for the DM subsystem.

export interface Attachment {
  url: string;
  name: string;
  size: number;
  type: string;
  isImage: boolean;
  isVideo?: boolean;
  /**
   * Видеосообщение — квадратная заметка с камеры. Выводится квадратом, который
   * играет по касанию, а не обычным проигрывателем: это реплика, а не файл.
   */
  isVideoNote?: boolean;
  isVoice?: boolean;
  isGeo?: boolean;
  lat?: number;
  lng?: number;
  /** FIX-GEO: адрес точки (улица, дом, город) из обратного геокодирования */
  address?: string;
  duration?: number;
  e2eeIv?: string;
  isE2EE?: boolean;
}

export interface DMUser {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  role: string;
  lastSeen: string | null;
  customStatus: string | null;
  statusEmoji: string | null;
  avatarGlowEnabled: boolean;
  avatarGlowColors: string | null;
}

/**
 * Связка делового разговора с обращением — приходит только в разделе «Бизнес».
 *
 * `party` говорит, с какой стороны смотрит текущий пользователь: клиент видит
 * администрацию одним лицом, администрация видит клиента и того, кто ведёт
 * разговор. Поле заполняет сервер (/api/dm): решать это на клиенте по роли
 * значило бы держать одно правило в двух местах.
 */
export interface BusinessInfo {
  appealId: string | null;
  subject: string;
  status: string;
  party: "client" | "handler";
  clientName: string;
  /** Кто ведёт разговор. null — заявку ещё никто не взял. */
  handlerName: string | null;
  /**
   * BUSINESS-LOCK: администрация закрыла клиенту отправку сообщений.
   *
   * Клиенту по этому признаку ввод заменяется объяснением — отказ на отправку он
   * увидел бы уже после того, как набрал текст. Администрации показывается
   * состояние переключателя; писать она может и при закрытой отправке.
   */
  locked?: boolean;
}

export interface Conversation {
  id: string;
  other: DMUser;
  lastMessage: { id: string; content: string; createdAt: string; userId: string } | null;
  lastMessageAt: string | null;
  /**
   * Начало переписки. По нему строится порядок списка диалогов: кто написал
   * раньше, тот выше. Необязательное — старый клиент без этого поля просто
   * откатится к ранжированию по lastMessageAt.
   */
  createdAt?: string | null;
  unread?: number;
  business?: BusinessInfo;
  /**
   * FIX-E2EECHAT: защищённая (E2EE) переписка — отдельный разговор с тем же человеком.
   *
   * Шифрование здесь — свойство переписки, а не переключатель в шапке: в таком
   * разговоре шифруется всё и всегда, и смешать открытое с зашифрованным негде.
   */
  secure?: boolean;
}

export interface DMReplyTo {
  id: string;
  content: string;
  user: { id: string; name: string };
}

export interface DMReaction {
  id: string;
  emoji: string;
  userId: string;
  user?: { id: string; name: string; username?: string };
}

export interface Message {
  id: string;
  content: string;
  userId: string;
  edited: boolean;
  deleted: boolean;
  attachments: string | null;
  replyTo?: DMReplyTo | null;
  pinned?: boolean;
  threadId?: string | null;
  threadCount?: number;
  reactions?: DMReaction[];
  encrypted?: boolean;
  status?: "sending" | "sent" | "failed";
  createdAt: string;
  user: { id: string; name: string; username: string; avatar: string | null; role: string; avatarGlowEnabled: boolean; avatarGlowColors: string | null };
  conversationId?: string;
  _encrypted?: boolean;
}

export interface ForwardTarget {
  type: "channel" | "dm";
  id: string;
  name: string;
  icon?: string | null;
}

// Parse the raw attachments JSON string into a typed array.
export function parseAttachments(raw: string | null | undefined): Attachment[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Attachment[];
  } catch {
    return [];
  }
}

// Day label for date separators: "Сегодня" / "Вчера" / "21 июня 2026 г."
export function getDayLabel(date: Date): string {
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
