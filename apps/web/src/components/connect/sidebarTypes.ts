export interface Channel {
  id: string;
  name: string;
  type: string;
  icon: string | null;
  groupId: string;
  serviceId?: string | null;
  parentId?: string | null;
  channelGroupType?: string | null;
  postAccess?: string;
  sortOrder?: number;
  /** FIX-PRV: канал ограничен ролями (приватный) — рисуем мини-иконку с замком. */
  isRestricted?: boolean;
  _count: { members: number; messages: number };
}

export interface VoiceUser {
  socketId: string;
  userId: string;
  userName: string;
  muted: boolean;
  /** FIX-VAVATAR: аватар приходит с сервера вместе с присутствием. */
  avatar?: string | null;
}

export interface GroupDetail {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  banner?: string | null;
  /** GROUP-SKIN: оформление сообщества (JSON, см. lib/groupTheme.ts) */
  theme?: string | null;
  myRole: string;
  channels: Channel[];
  /* Поля присутствия и подсветки аватара необязательные: страница передаёт их
     всегда, но панели каналов они самой не нужны — она отдаёт список дальше, в
     `MembersList`. Здесь лежит только первая страница участников. */
  members: {
    user: {
      id: string;
      name: string;
      username: string;
      avatar: string | null;
      role: string;
      lastSeen?: string | null;
      avatarGlowEnabled?: boolean;
      avatarGlowColors?: string | null;
    };
    role: string;
  }[];
  /** Сколько участников всего — счётчик и признак «есть что догрузить». */
  membersTotal?: number;
  /** FIX-PREMIUM-EXPIRED: true если у владельца активна подписка. false = режим только для чтения. */
  ownerHasPremium?: boolean;
}

export interface VoiceState {
  isConnected: boolean;
  voiceStatus: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  connectionStage: "idle" | "microphone" | "optimizing-audio" | "server" | "channel" | "media" | "connected" | "reconnecting" | "disconnecting" | "error";
  channelId: string | null;
  channelName: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  users: VoiceUser[];
  speakingUsers: Set<string>;
  localSpeaking: boolean;
  nsEnabled: boolean;
  nsStatus: string;
  isSharingScreen: boolean;
  screenSharerId: string | null;
  screenSharerIds: Set<string>;
  userVolumes: Map<string, number>;
  connectionQuality: Map<string, "good" | "medium" | "poor" | "unknown">;
  localPing: number | null;
}

export interface VoiceActions {
  joinVoice: (channelId: string, channelName: string) => Promise<void>;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleNS: () => void;
  /**
   * SCREEN-PRIVATE: необязательный список userId для приватного показа.
   * `sourceId` — выбранный экран или окно (только в десктоп-оболочке).
   */
  startScreenShare: (allowUserIds?: string[] | null, sourceId?: string | null) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  setUserVolume: (socketId: string, volume: number) => void;
}
