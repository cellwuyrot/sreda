export interface MessageUser {
  id: string;
  name: string;
  username?: string;
  avatar: string | null;
  role: string;
  lastSeen?: string | null;
  avatarGlowEnabled?: boolean;
  avatarGlowColors?: string | null;
  profileBanner?: string | null;
  groupRoles?: { name: string; color: string }[];
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  type: string;
  isImage: boolean;
  isVoice?: boolean;
  /**
   * Видео во вложении. Признака здесь не было вовсе, хотя сервер его отдаёт: из-за
   * этого видео, отправленное в канал, выводилось ссылкой на файл — ветки вывода
   * для него просто не существовало.
   */
  isVideo?: boolean;
  /**
   * Видеосообщение — квадратная заметка с камеры («кружок», только квадратный).
   * От обычного видео отличается выводом: не проигрыватель с элементами
   * управления, а квадрат, который играет по касанию.
   */
  isVideoNote?: boolean;
  duration?: number;
  isGeo?: boolean;
  lat?: number;
  lng?: number;
  /** FIX-GEO: адрес точки (улица, дом, город) из обратного геокодирования */
  address?: string;
}

export interface Reaction {
  id: string;
  emoji: string;
  userId: string;
  user: { id: string; name: string };
}

export interface ReplyTo {
  id: string;
  content: string;
  user: { id: string; name: string };
}

export interface Message {
  id: string;
  content: string;
  createdAt: string;
  edited?: boolean;
  editedAt?: string | null;
  deleted?: boolean;
  pinned?: boolean;
  attachments?: string | null;
  reactions?: Reaction[];
  replyTo?: ReplyTo | null;
  reads?: { userId: string }[];
  threadId?: string | null;
  threadCount?: number;
  _count?: { threadReplies: number };
  user: MessageUser;
}

export interface ForwardTarget {
  type: "channel" | "dm";
  id: string;
  name: string;
  icon?: string | null;
}
