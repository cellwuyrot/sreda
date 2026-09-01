"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { io, Socket } from "socket.io-client";
import { NoiseSuppressor, NSStatus } from "@/lib/noiseSuppressor";
import { patchedOffer, patchedAnswer } from "@/lib/sdpUtils";
import { getDesktopApi } from "@/lib/desktop";
import { hasPremium } from "@/lib/premium";
import { ReplayRecorder } from "@/lib/replayBuffer"; // FIX-REPLAY: кольцевой буфер мгновенного повтора
import { playUiSound, setUiSoundsSink } from "@/lib/uiSounds"; // FIX-SFX: локальные звуки действий (только для нажавшего)

/* ─── Types ─── */

export interface VoiceUser {
  socketId: string;
  userId:   string;
  userName: string;
  muted:    boolean;
  /** Аватар участника; приходит с сервера вместе с присутствием. */
  avatar?:  string | null;
}

/** A single active screen share (local or remote). `socketId` is "local" for
 *  the current user's own share; otherwise it's the sharer's socket id. */
export interface ScreenShare {
  socketId: string;
  userName: string;
  stream:   MediaStream;
  isLocal:  boolean;
  quality:  ScreenShareQuality;
}

/** FIX-CAM: одна активная камера (своя или удалённая). `socketId` — "local"
 *  для собственной камеры текущего пользователя. */
export interface CameraShare {
  socketId: string;
  userName: string;
  stream:   MediaStream;
  isLocal:  boolean;
}

export interface ScreenShareStats {
  droppedFrames: number;
  lossPercent: number;
}

export type ConnectionQuality = "good" | "medium" | "poor" | "unknown";
/* VOICE-VOLKEEP: где лежат личные громкости собеседников. Это выбор слушателя,
   он никому не отправляется и потому хранится на устройстве. */
const USER_VOLUME_KEY = "voice-user-volumes";

/** Запомненные громкости: userId -> проценты (0..200). */
function readSavedUserVolumes(): Map<string, number> {
  const map = new Map<string, number>();
  if (typeof window === "undefined") return map;
  try {
    const raw = window.localStorage.getItem(USER_VOLUME_KEY);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return map;
    for (const [userId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const num = Number(value);
      if (userId && Number.isFinite(num)) map.set(userId, Math.max(0, Math.min(200, num)));
    }
  } catch { /* битое значение не должно ломать голос */ }
  return map;
}

/** Сохранение всей карты: записей ровно столько, сколько людей вручную настроили. */
function writeSavedUserVolumes(map: Map<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    const plain: Record<string, number> = {};
    map.forEach((value, userId) => { plain[userId] = value; });
    window.localStorage.setItem(USER_VOLUME_KEY, JSON.stringify(plain));
  } catch { /* переполненное хранилище — не причина падать */ }
}

export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";
export type VoiceConnectionStage =
  | "idle"
  | "microphone"
  | "optimizing-audio"
  | "server"
  | "channel"
  | "media"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

/** Screen-share resolution (vertical pixels) and frame rate the user can pick. */
export type ScreenResolution = 720 | 1080;
export type ScreenFps = 30 | 60;
export interface ScreenShareQuality {
  resolution: ScreenResolution;
  fps:        ScreenFps;
}

interface VoiceState {
  isConnected:     boolean;
  voiceStatus:     VoiceStatus;
  connectionStage: VoiceConnectionStage;
  channelId:       string | null;
  channelName:     string | null;
  isMuted:         boolean;
  isDeafened:      boolean;
  users:           VoiceUser[];
  speakingUsers:   Set<string>;
  localSpeaking:   boolean;
  error:           string | null;
  isSharingScreen: boolean;
  screenSharerId:  string | null;
  screenSharerIds: Set<string>;
  screenShareName: string;
  screenStream:    MediaStream | null;
  screenShares:    ScreenShare[];
  /** SCREEN-PRIVATE: ваша трансляция приватная (виден список разрешённых). */
  isScreenPrivate: boolean;
  /** SCREEN-PRIVATE-LIVE: кому виден текущий показ (null — всем в канале). */
  screenAllowUserIds: string[] | null;
  /** SCREEN-VIEWERS: кто сейчас смотрит трансляцию, ключ — socketId ведущего. */
  screenViewers:   Map<string, { userId: string; userName: string }[]>;
  /** FIX-CAM: включена ли собственная камера. */
  isCameraOn:      boolean;
  /** FIX-CAM: все активные камеры канала (своя первой). */
  cameraShares:    CameraShare[];
  /** FIX-CAM: socketId участников с включённой камерой (для бейджей в списке). */
  cameraUserIds:   Set<string>;
  /** FIX-CAM-DEV: выбранная камера (deviceId) или null — системная по умолчанию. */
  cameraDeviceId:  string | null;
  /** FIX-CAM-DEV: доступные камеры (обновляются через refreshCameraDevices). */
  cameraDevices:   Array<{ deviceId: string; label: string }>;
  /** FIX-AUDIO-DEV: выбранный микрофон (deviceId) или null — системный по умолчанию. */
  micDeviceId:     string | null;
  /** FIX-AUDIO-DEV: выбранное устройство вывода (наушники/динамики) или null — системное. */
  outputDeviceId:  string | null;
  /** FIX-AUDIO-DEV: доступные микрофоны (обновляются через refreshAudioDevices). */
  inputDevices:    Array<{ deviceId: string; label: string }>;
  /** FIX-AUDIO-DEV: доступные устройства вывода (обновляются через refreshAudioDevices). */
  outputDevices:   Array<{ deviceId: string; label: string }>;
  nsEnabled:       boolean;
  nsIntensity:     number;
  nsStatus:        NSStatus;
  screenShareQuality: ScreenShareQuality;
  /** Передавать ли звук системы вместе с картинкой (выбор запоминается). */
  screenAudioEnabled: boolean;
  /** Outgoing video statistics; exposed only for the local sharer's UI. */
  screenShareStats: ScreenShareStats | null;
  isPremium:       boolean;
  userVolumes:     Map<string, number>;
  channelUsersMap: Map<string, VoiceUser[]>;
  connectionQuality: Map<string, ConnectionQuality>;
  localPing:       number | null;
  pttEnabled:      boolean;
  pttKeys:         string[];
  pttActive:       boolean;
  /** FIX-REPLAY: включён ли буфер мгновенного повтора (настройка хранится локально). */
  replayEnabled:   boolean;
  /** FIX-REPLAY: браузерный бинд «сохранить повтор» (формат как у рации). */
  replayKeys:      string[];
  /** FIX-REPLAY: длительность буфера в секундах (30…180, настройка Premium). */
  replaySeconds:   number;
  /** FIX-REPLAY: буфер запущен и готов сохранять. */
  replayReady:     boolean;
  /** EQ: усиление полос эквалайзера в дБ, порядок — как в EQ_BANDS (Premium). */
  eqGains:         number[];
  /** EQ: выбранный пресет; «custom» — полосы правили ползунками. */
  eqPreset:        EqPresetId;
  /** EQ: включён ли монитор (слышно свой обработанный голос). */
  monitorEnabled:  boolean;
  /** EQ: громкость монитора, 0…1. */
  monitorVolume:   number;
  /** Собрана ли цепочка эквалайзера прямо сейчас (в канале и по подписке). */
  eqActive:        boolean;
  /** Усиление микрофона в дБ. 0 — сигнал как есть. */
  micGainDb:       number;
  setMicGain:      (db: number) => void;
}

interface VoiceActions {
  joinVoice:        (channelId: string, channelName: string) => Promise<void>;
  leaveVoice:       () => void;
  toggleMute:       () => void;
  toggleDeafen:     () => void;
  toggleNS:         () => void;
  /**
   * SCREEN-PRIVATE: `allowUserIds` — приватный показ только этим участникам
   * (их userId). Пусто/не передано — публичный показ, как раньше.
   *
   * `sourceId` — выбранный экран или окно из окна запуска. Работает только в
   * десктоп-оболочке (в браузере источник спрашивает системный диалог); пусто —
   * оболочка возьмёт целый экран.
   */
  startScreenShare: (allowUserIds?: string[] | null, sourceId?: string | null) => Promise<void>;
  /** SCREEN-PRIVATE-LIVE: сменить состав допущенных, не прерывая показ. */
  updateScreenAllow: (allowUserIds: string[] | null) => Promise<void>;
  /**
   * Качество следующей демонстрации: разрешение и частота кадров. Значение
   * прижимается к тарифу (обычный аккаунт — 720p/30) и запоминается на
   * устройстве, поэтому окно запуска открывается на прошлом выборе.
   */
  setScreenShareQuality: (quality: ScreenShareQuality) => void;
  /** Передавать ли звук системы вместе с демонстрацией. */
  setScreenAudioEnabled: (enabled: boolean) => void;
  /** SCREEN-VIEWERS: сообщить, что вы открыли/закрыли просмотр трансляции. */
  setViewingScreen: (ownerSocketId: string | null) => void;
  stopScreenShare:  () => Promise<void>;
  /** FIX-CAM: включить/выключить камеру (720p или 1080p по подписке Premium). */
  toggleCamera:     () => Promise<void>;
  /** FIX-CAM-DEV: выбрать камеру (null — системная по умолчанию); если камера включена — применяется сразу. */
  setCameraDevice:      (deviceId: string | null) => Promise<void>;
  /** FIX-CAM-DEV: обновить список доступных камер. */
  refreshCameraDevices: () => Promise<void>;
  /** FIX-AUDIO-DEV: выбрать микрофон (null — системный); если вы в канале — применяется сразу. */
  setMicDevice:         (deviceId: string | null) => Promise<void>;
  /** FIX-AUDIO-DEV: выбрать устройство вывода звука (null — системное); применяется сразу. */
  setOutputDevice:      (deviceId: string | null) => Promise<void>;
  /** FIX-AUDIO-DEV: обновить список доступных микрофонов и устройств вывода. */
  refreshAudioDevices:  () => Promise<void>;
  setUserVolume:    (socketId: string, volume: number) => void;
  setNsEnabled:     (v: boolean) => void;
  setNsIntensity:   (v: number) => void;
  queryChannelUsers:(channelId: string) => void;
  setPttEnabled:    (v: boolean) => void;
  setPttKeys:       (keys: string[]) => void;
  setReplayEnabled: (v: boolean) => void;
  setReplayKeys:    (keys: string[]) => void;
  /** FIX-REPLAY: длительность буфера; применится при следующем входе в канал. */
  setReplaySeconds: (seconds: number) => void;
  /** FIX-REPLAY: сохранить последние ~30 секунд (звук + трансляция) в файл. */
  saveReplay:       () => Promise<boolean>;
  /** EQ: усиление одной полосы, дБ (−12…+12); применяется на ходу. */
  setEqBandGain:    (index: number, db: number) => void;
  /** EQ: применить пресет; «custom» игнорируется — он выставляется сам. */
  setEqPreset:      (preset: EqPresetId) => void;
  /** EQ: монитор своего голоса; включается только в голосовом канале. */
  setMonitorEnabled: (v: boolean) => void;
  /** EQ: громкость монитора, 0…1 (запоминается). */
  setMonitorVolume: (v: number) => void;
}

type VoiceCtx = VoiceState & VoiceActions;

const VoiceContext = createContext<VoiceCtx | null>(null);

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be inside VoiceProvider");
  return ctx;
}

/* ─── Constants ─── */

const DEFAULT_ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.nextcloud.com:443" },
  ],
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 2,
};

// Pixel dimensions for each selectable resolution. Discord works the same way —
// a higher resolution and frame rate is a paid perk.
const SCREEN_RES: Record<ScreenResolution, { width: number; height: number }> = {
  720:  { width: 1280, height: 720  },
  1080: { width: 1920, height: 1080 },
};

// FIX-CAM: разрешение камеры зависит от подписки — как и у демонстрации экрана:
// обычный аккаунт вещает 720p, Premium — 1080p.
function buildCameraConstraints(isPremium: boolean, deviceId?: string | null): MediaStreamConstraints {
  const res = SCREEN_RES[isPremium ? 1080 : 720];
  return {
    audio: false, // голос уже идёт отдельным микрофонным треком
    video: {
      // FIX-CAM-DEV: если пользователь выбрал конкретную камеру — берём именно её,
      // иначе фронтальную/системную по умолчанию.
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
      width:     { ideal: res.width },
      height:    { ideal: res.height },
      frameRate: { ideal: 30 },
    },
  };
}

// FIX-AUDIO-DEV: constraints for the raw microphone capture. RNNoise needs an
// unprocessed mono signal, so denoising/AGC stay off; a specific input device is
// pinned only when the user picked one (otherwise the system default is used).
// `strict` adds the exact channel/sample-rate hints that some microphones reject
// — join tries strict first and falls back to a looser request.
function buildMicConstraints(deviceId: string | null, strict: boolean): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  if (strict) {
    audio.channelCount = 1;
    audio.sampleRate = 48000;
  }
  return { audio };
}

// FIX-AUDIO-DEV: setSinkId ("play through this output device") is not yet in the
// TypeScript DOM lib, so we feature-detect and cast. An empty id means "system
// default". Failures are swallowed — the browser simply keeps the current sink.
type SinkTarget = { setSinkId?: (id: string) => Promise<void> };
function setElementSink(el: HTMLMediaElement | null | undefined, deviceId: string | null) {
  const s = el as (HTMLMediaElement & SinkTarget) | null | undefined;
  if (s && typeof s.setSinkId === "function") {
    try { void s.setSinkId(deviceId ?? "").catch(() => {}); } catch { /* ignore */ }
  }
}
function setContextSink(ctx: AudioContext | null | undefined, deviceId: string | null) {
  const c = ctx as (AudioContext & SinkTarget) | null | undefined;
  if (c && typeof c.setSinkId === "function") {
    try { void c.setSinkId(deviceId ?? "").catch(() => {}); } catch { /* ignore */ }
  }
}

// The default quality when the user has never chosen one: the safe baseline that
// every tier is allowed to use.
const DEFAULT_SCREEN_QUALITY: ScreenShareQuality = { resolution: 720, fps: 30 };

// Screen-share quality is user-selectable but gated by subscription tier.
// Premium subscribers may pick 720p/1080p at 30 or 60 fps; regular users are
// always pinned to 720p at 30 fps (the choices simply don't apply to them).
// This is the single place that enforces the tier rule, so the UI, the initial
// capture constraints and any live re-apply all agree.
function clampQualityToTier(q: ScreenShareQuality, isPremium: boolean): ScreenShareQuality {
  if (isPremium) return q;
  return { ...DEFAULT_SCREEN_QUALITY };
}

/**
 * Потолок битрейта видеодорожки показа.
 *
 * До этого ограничивалось только разрешение и частота кадров, а битрейт
 * оставался на усмотрение браузера. В полной сетке это опасно: дорожка
 * кодируется и уходит отдельно КАЖДОМУ зрителю, и на четверых 1080p·60
 * забивает исходящий канал целиком. Первым страдает не картинка, а голос —
 * он идёт по тому же каналу и рвётся раньше видео.
 *
 * Поэтому у показа есть общий бюджет на отдачу, который делится между
 * зрителями, но не опускается ниже порога, за которым смотреть уже незачем.
 */
const SCREEN_BASE_BITRATE: Record<string, number> = {
  "720-30": 1_500_000,
  "720-60": 2_500_000,
  "1080-30": 3_000_000,
  "1080-60": 5_000_000,
};
/* Общий бюджет отдачи демонстрации, который делится между зрителями. У
   подписчика он выше: при трёх-четырёх зрителях это разница между читаемым
   текстом на экране и кашей. В интерфейсе про это ничего не написано намеренно
   — это не настройка, а качество, которое просто лучше. */
const SCREEN_TOTAL_UPLINK = 6_000_000;
const SCREEN_TOTAL_UPLINK_PREMIUM = 9_000_000;
const SCREEN_MIN_BITRATE = 400_000;

/* FIX-REPLAY: длительность буфера повтора настраивается (Premium). Нижняя
   граница — прежние 30 секунд, верхняя — три минуты: дальше кольцевой буфер в
   памяти вкладки становится заметно тяжёлым, а смысл «мгновенного» повтора
   теряется. */
export const REPLAY_MIN_SECONDS = 30;
export const REPLAY_MAX_SECONDS = 180;

/* ── EQ: эквалайзер исходящего голоса (Premium) ────────────────────────────
   Тип, частота и добротность полосы заданы жёстко — форму АЧХ задают они, а на
   ходу меняется только усиление. Это принципиально: BiquadFilterNode.gain
   двигается без пересборки графа, поэтому движение ползунка не заставляет
   каждого пира переживать replaceTrack. */
export type EqBandSpec = { hz: number; type: BiquadFilterType; q: number; label: string };
export const EQ_BANDS: readonly EqBandSpec[] = [
  { hz: 80,   type: "lowshelf",  q: 0.7, label: "80 Гц"   },
  { hz: 250,  type: "peaking",   q: 0.9, label: "250 Гц"  },
  { hz: 1000, type: "peaking",   q: 1.1, label: "1 кГц"   },
  { hz: 3500, type: "peaking",   q: 1.0, label: "3.5 кГц" },
  { hz: 8000, type: "highshelf", q: 0.7, label: "8 кГц"   },
];
/* Дальше ±12 дБ голос уже не «настраивается», а ломается: полки начинают
   перегружать кодек, а провалы съедают разборчивость. */
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

/* Усиление микрофона.
 *
 * Диапазон несимметричный намеренно: тихий микрофон встречается куда чаще
 * слишком громкого, а ослаблять сигнал программно почти всегда неправильно —
 * это делается в системе. Поэтому вверх запас больше, чем вниз.
 *
 * Шаг в 1 дБ: полдецибела на слух не отличить, а ползунок становится нервным. */
export const MIC_GAIN_MIN_DB = -10;
export const MIC_GAIN_MAX_DB = 20;

function clampMicGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(MIC_GAIN_MIN_DB, Math.min(MIC_GAIN_MAX_DB, Math.round(db)));
}

/** Децибелы → множитель амплитуды. 0 дБ = 1, +6 дБ ≈ 2. */
function micGainToFactor(db: number): number {
  return Math.pow(10, clampMicGain(db) / 20);
}

function readMicGain(): number {
  if (typeof window === "undefined") return 0;
  const saved = localStorage.getItem("voice-mic-gain");
  if (saved === null) return 0;
  return clampMicGain(Number(saved));
}

export type EqPresetId = "flat" | "warm" | "radio" | "clarity" | "depth" | "custom";

/* Усиления в дБ по порядку полос: 80 / 250 / 1к / 3.5к / 8к. */
export const EQ_PRESETS: Record<Exclude<EqPresetId, "custom">, readonly number[]> = {
  flat:    [ 0,  0,  0,  0,  0],
  warm:    [ 4,  2,  0, -1, -3],
  radio:   [-8, -3,  5,  3, -6],
  clarity: [ 0, -1,  1,  5,  2],
  depth:   [ 6,  1, -1,  0, -2],
};

export const EQ_PRESET_LABELS: Record<EqPresetId, string> = {
  flat:    "Нейтрально",
  warm:    "Тепло",
  radio:   "Радио",
  clarity: "Чёткость",
  depth:   "Глубина",
  custom:  "Свои настройки",
};

/** Порядок кнопок пресетов в интерфейсе («custom» выставляется сам). */
export const EQ_PRESET_ORDER: readonly Exclude<EqPresetId, "custom">[] = ["flat", "warm", "radio", "clarity", "depth"];

function clampDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Math.round(db)));
}

function readEqGains(): number[] {
  const flat = EQ_PRESETS.flat.map(clampDb);
  if (typeof window === "undefined") return flat;
  try {
    const raw = JSON.parse(localStorage.getItem("voice-eq-gains") ?? "null");
    if (!Array.isArray(raw)) return flat;
    return EQ_BANDS.map((_, i) => clampDb(Number(raw[i])));
  } catch {
    return flat;
  }
}

/** Пресет, кривая которого совпадает с переданными полосами, иначе «свои настройки». */
function detectEqPreset(gains: readonly number[]): EqPresetId {
  for (const id of EQ_PRESET_ORDER) {
    if (EQ_PRESETS[id].every((db, i) => db === gains[i])) return id;
  }
  return "custom";
}

function readEqPreset(gains: readonly number[]): EqPresetId {
  // Кривая может совпасть с пресетом случайно — человек дошёл до неё
  // ползунками. Тогда в памяти лежит «custom», и подпись не подменяем.
  if (typeof window !== "undefined" && localStorage.getItem("voice-eq-preset") === "custom") return "custom";
  return detectEqPreset(gains);
}

function readMonitorVolume(): number {
  // 35 % — слышно себя, но собеседники всё равно громче: монитор нужен для
  // контроля тембра, а не для того, чтобы заглушать канал.
  if (typeof window === "undefined") return 0.35;
  // Именно getItem, а не Number(...) от него: Number(null) даёт 0, и новый
  // пользователь получил бы «громкость 0» вместо значения по умолчанию.
  const saved = localStorage.getItem("voice-eq-monitor-volume");
  if (saved === null) return 0.35;
  const raw = Number(saved);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return 0.35;
  return raw;
}

function persistEq(gains: readonly number[], preset: EqPresetId) {
  if (typeof window === "undefined") return;
  localStorage.setItem("voice-eq-gains", JSON.stringify(gains));
  localStorage.setItem("voice-eq-preset", preset);
}

/** Сколько зрителей поток выдерживает без деления бюджета. */
export const SCREEN_COMFORT_VIEWERS = 3;

// The user's last "share source audio" choice from the launch window, persisted
// so the picker reopens on it.
//
// FIX-SS-ECHO: defaults to OFF (no shared audio) — deliberately. The desktop
// shell can only capture the WHOLE system output mix: Electron/Chromium exposes
// no per-application capture (`setDisplayMediaRequestHandler` accepts audio only
// as 'loopback' | 'loopbackWithMute'). That mix contains the other participants'
// voices, which TZ.Connect itself is playing through the speakers, so sharing it
// feeds everyone's voice back to them as an echo. Off-by-default means a share
// never leaks the call audio unless the user knowingly opts in — and the launch
// window warns about it explicitly. It used to default to ON, so a plain "share
// my screen" produced the echo with no way to see why.

// ── WASAPI-SS: хелпер получения WASAPI-дорожки в renderer ────────────────────────────────
/**
 * Запускает WASAPI-захват звука ОС через нативный аддон изолированно от voice pipeline.
 * Исключает всё PID-дерево приложения, поэтому голоса участников не попадает
 * в screen-share audio.
 *
 * @returns MediaStreamTrack или null (если не-Windows, нет аддона, ошибка захвата).
 */
async function acquireWasapiAudioTrack(
  desktop: ReturnType<typeof getDesktopApi>,
): Promise<{ track: MediaStreamTrack; cleanup: () => void } | null> {
  if (
    !desktop ||
    !desktop.startWasapiCapture ||
    !desktop.onWasapiReady ||
    !desktop.onWasapiChunk ||
    !desktop.onWasapiError ||
    desktop.platform !== "win32"
  ) {
    return null;
  }

  // TypeScript не проносит narrowing в колбэк Promise.
  // После гарда выше все четыре метода гарантированно определены.
  const _wasapiStart  = desktop.startWasapiCapture!;
  const _wasapiReady  = desktop.onWasapiReady!;
  const _wasapiChunk  = desktop.onWasapiChunk!;
  const _wasapiError  = desktop.onWasapiError!;

  return new Promise((resolve) => {
    let audioCtx: AudioContext | null = null;
    let destNode: MediaStreamAudioDestinationNode | null = null;
    let workletNode: AudioWorkletNode | null = null;
    const unsubs: Array<() => void> = [];
    let settled = false;

    const timeout = setTimeout(() => settle(null), 3000);

    function settle(result: { track: MediaStreamTrack; cleanup: () => void } | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // Отписываемся от ready/error (chunk остаётся подписанным)
      unsubs.forEach(fn => fn());
      resolve(result);
    }

    const unsubReady = _wasapiReady(async (sampleRate: number, channels: number) => {
      try {
        audioCtx = new AudioContext({ sampleRate, latencyHint: "playback" });
        await audioCtx.audioWorklet.addModule("/worklets/wasapi-injector.js");
        workletNode = new AudioWorkletNode(audioCtx, "wasapi-injector", {
          numberOfOutputs: 1,
          outputChannelCount: [Math.min(2, channels)],
        });
        workletNode.port.postMessage({ type: "config", channels });
        destNode = audioCtx.createMediaStreamDestination();
        workletNode.connect(destNode);

        // Подписка на чанки записывается здесь, не в settle
        const unsubChunk = _wasapiChunk((data: Float32Array) => {
          if (workletNode) {
            // Transferable send (zero-copy)
            workletNode.port.postMessage({ type: "chunk", data }, [data.buffer]);
          }
        });
        unsubs.push(unsubChunk);

        const track = destNode.stream.getAudioTracks()[0] ?? null;
        if (!track) { settle(null); return; }

        settle({
          track,
          cleanup: () => {
            unsubChunk();
            workletNode?.disconnect();
            audioCtx?.close();
            desktop.stopWasapiCapture?.();
          },
        });
      } catch (err) {
        console.error("[wasapi-ss] AudioContext/worklet init failed:", err);
        settle(null);
      }
    });
    unsubs.push(unsubReady);

    const unsubErr = _wasapiError((msg: string) => {
      console.warn("[wasapi-ss] capture error:", msg);
      settle(null);
    });
    unsubs.push(unsubErr);

    // Запускаем захват; main сам использует process.pid как excludePid
    _wasapiStart();
  });
}

function readScreenAudioPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return JSON.parse(localStorage.getItem("voice-screen-audio") ?? "false") === true;
  } catch {
    return false;
  }
}

// Build the getDisplayMedia constraints for the chosen quality. We also request
// screen audio (tab/system/window sound) so a shared video or game is *heard*
// by everyone in the channel — not just seen. Browsers that don't support
// display audio (Firefox, Safari) simply return a stream with no audio track,
// which the rest of the pipeline handles gracefully. The resolution and frame
// rate come straight from the (already tier-clamped) quality.
function buildScreenConstraints(q: ScreenShareQuality): DisplayMediaStreamOptions {
  const { width, height } = SCREEN_RES[q.resolution];
  return {
    video: {
      width:     { ideal: width,  max: width  },
      height:    { ideal: height, max: height },
      frameRate: { ideal: q.fps,  max: q.fps  },
    } as MediaTrackConstraints,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl:  false,
    } as MediaTrackConstraints,
  };
}

/* Outgoing audio quality by subscription tier. Premium subscribers transmit at
   the full bitrate; regular users get exactly half, so their connection quality
   is 2× lower. The cap is applied per-peer on the local RTP sender. */
const PREMIUM_AUDIO_BITRATE = 128_000;
const REGULAR_AUDIO_BITRATE = PREMIUM_AUDIO_BITRATE / 2;

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Provider                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  /* ── Core state ── */
  const [isConnected,   setIsConnected]   = useState(false);
  const [voiceStatus,   setVoiceStatus]   = useState<VoiceStatus>("idle");
  const [connectionStage, setConnectionStage] = useState<VoiceConnectionStage>("idle");
  const [channelId,     setChannelId]     = useState<string | null>(null);
  const [channelName,   setChannelName]   = useState<string | null>(null);
  const [isMuted,       setIsMuted]       = useState(false);
  const [isDeafened,    setIsDeafened]    = useState(false);
  const [users,         setUsers]         = useState<VoiceUser[]>([]);
  /* SCREEN-PRIVATE: состав канала нужен вне рендера (при добавлении дорожек
     новому участнику), поэтому дублируем его в ref. */
  const usersRef = useRef<VoiceUser[]>([]);
  useEffect(() => { usersRef.current = users; }, [users]);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  /* ── Screen share ── */
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [screenSharerId,  setScreenSharerId]  = useState<string | null>(null);
  const [screenShareName, setScreenShareName] = useState("");
  const [screenStream,     setScreenStreamState] = useState<MediaStream | null>(null);
  // The current user's *own* shared stream, kept separate from `screenStream`
  // (which tracks whichever remote video arrived last). Without this, a remote
  // share arriving over `ontrack` would overwrite the stream shown for the local
  // share in the multi-share list.
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  // Every remote participant that is currently sharing, keyed by socketId. More
  // than one person can share at the same time (like Discord), so this is a map
  // rather than a single id — the viewer switches between them in the UI.
  const [remoteScreens, setRemoteScreens] = useState<Map<string, MediaStream>>(new Map());
  // Quality participates in rendering, so it must live in state rather than a
  // ref. Reading ref.current while building screenShares violates React's refs
  // rule and, more importantly, would not re-render when quality changes.
  const [remoteScreenQualities, setRemoteScreenQualities] = useState<Map<string, ScreenShareQuality>>(new Map());

  /* ── FIX-CAM: камера ── */
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  // Удалённые камеры, ключ — socketId (как и remoteScreens).
  const [remoteCameras, setRemoteCameras] = useState<Map<string, MediaStream>>(new Map());
  // FIX-CAM-DEV: выбранное устройство камеры — сохраняется между сессиями.
  const [cameraDeviceId, setCameraDeviceIdState] = useState<string | null>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("voice-camera-device");
    return null;
  });
  const [cameraDevices, setCameraDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const cameraDeviceIdRef = useRef<string | null>(cameraDeviceId);

  /* ── FIX-AUDIO-DEV: выбор микрофона и устройства вывода (наушники/динамики) ── */
  const [micDeviceId, setMicDeviceIdState] = useState<string | null>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("voice-mic-device");
    return null;
  });
  const [outputDeviceId, setOutputDeviceIdState] = useState<string | null>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("voice-output-device");
    return null;
  });
  const [inputDevices, setInputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [outputDevices, setOutputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const micDeviceIdRef = useRef<string | null>(micDeviceId);
  const outputDeviceIdRef = useRef<string | null>(outputDeviceId);

  /* ── Noise suppressor ── */
  const [nsEnabled, setNsEnabledState] = useState<boolean>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("voice-ns-enabled") !== "0";
    return true;
  });
  const [nsIntensity, setNsIntensityState] = useState<number>(() => {
    if (typeof window !== "undefined") {
      /* Значение сначала проверяется как строка: Number(null) даёт 0, и он
         проходил проверку диапазона — у нового пользователя шумоподавление
         оказывалось выкрученным в ноль вместо 0.6. */
      const raw = localStorage.getItem("voice-ns-intensity");
      const saved = raw === null ? NaN : Number(raw);
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
    }
    return 0.6;
  });
  const [nsStatus,  setNsStatus]  = useState<NSStatus>("idle");
  const nsEnabledRef   = useRef(nsEnabled);
  const nsIntensityRef = useRef(nsIntensity);

  /* ── EQ: эквалайзер исходящего голоса и монитор (Premium) ── */
  const [eqGains, setEqGainsState] = useState<number[]>(readEqGains);
  const [eqPreset, setEqPresetState] = useState<EqPresetId>(() => readEqPreset(readEqGains()));
  /* Монитор намеренно не запоминается между сессиями: без наушников он даёт
     эхо в канал, поэтому включаться должен осознанно и только на время
     нахождения в голосовом канале. Громкость запоминаем — она безопасна. */
  const [monitorEnabled, setMonitorEnabledState] = useState(false);
  const [monitorVolume, setMonitorVolumeState] = useState<number>(readMonitorVolume);
  /* Собрана ли цепочка полос прямо сейчас. Нужно интерфейсу: без этого
     «эквалайзер не работает» неотличимо от «вы вне канала» и от «браузер не дал
     собрать граф» — три разные причины с разными действиями. */
  const [eqActive, setEqActive] = useState(false);
  const [micGainDb, setMicGainDbState] = useState<number>(readMicGain);
  const eqGainsRef        = useRef<number[]>(eqGains);
  const monitorEnabledRef = useRef(false);
  const monitorVolumeRef  = useRef(monitorVolume);

  /* ── Screen-share quality (resolution + fps) ── */
  // The user's chosen streaming quality, persisted so it survives a reload. It
  // is always kept tier-clamped in state, so reading it is safe without
  // re-checking premium. Regular accounts are pinned to 720p/30.
  const [screenShareQuality, setScreenShareQualityState] = useState<ScreenShareQuality>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("voice-screen-quality");
        if (raw) {
          const p = JSON.parse(raw) as Partial<ScreenShareQuality>;
          const resolution: ScreenResolution = p.resolution === 1080 ? 1080 : 720;
          const fps: ScreenFps = p.fps === 60 ? 60 : 30;
          return { resolution, fps };
        }
      } catch { /* ignore malformed value */ }
    }
    return { ...DEFAULT_SCREEN_QUALITY };
  });
  const screenShareQualityRef = useRef(screenShareQuality);
  useEffect(() => { screenShareQualityRef.current = screenShareQuality; }, [screenShareQuality]);
  /* Звук системы: выбор живёт рядом с качеством, потому что задаётся в том же
     окне запуска. Само значение читается при старте показа из localStorage
     (readScreenAudioPref), здесь оно нужно интерфейсу. */
  const [screenAudioEnabled, setScreenAudioEnabledState] = useState<boolean>(readScreenAudioPref);
  const [screenShareStats, setScreenShareStats] = useState<ScreenShareStats | null>(null);

  /* ── Per-user volume ── */
  // Personal, listener-side volume for each remote participant (keyed by
  // socketId). It only changes what *this* client hears; it is never sent to
  // anyone else. The ref mirrors the state so `ontrack` can apply a volume that
  // was chosen before the audio element existed.
  const [userVolumes, setUserVolumes] = useState<Map<string, number>>(new Map());
  const userVolumesRef = useRef<Map<string, number>>(new Map());
  /* VOICE-VOLKEEP: персональная громкость живёт по userId, а не по socketId.
     socketId выдаётся заново каждый раз, когда человек вышел и зашёл, поэтому
     выставленное значение терялось уже на втором его входе в канал. Теперь
     выбор слушателя запоминается навсегда — один раз для каждого собеседника. */
  const savedVolumesRef = useRef<Map<string, number>>(readSavedUserVolumes());

  /** Громкость для участника: текущая для соединения, иначе запомненная, иначе 100%. */
  const volumeFor = useCallback((socketId: string): number => {
    const live = userVolumesRef.current.get(socketId);
    if (typeof live === "number") return live;
    const userId = usersRef.current.find(u => u.socketId === socketId)?.userId;
    const saved = userId ? savedVolumesRef.current.get(userId) : undefined;
    if (typeof saved !== "number") return 100;
    /* Запомненное значение сразу становится текущим для этого соединения,
       чтобы ползунок в списке участников показывал его, а не ровные 100%. */
    userVolumesRef.current.set(socketId, saved);
    setUserVolumes(prev => { const m = new Map(prev); m.set(socketId, saved); return m; });
    return saved;
  }, []);

  /* ── Channel users preview (before joining) ── */
  const [channelUsersMap, setChannelUsersMap] = useState<Map<string, VoiceUser[]>>(new Map());

  /* ── Connection quality monitoring ── */
  const [connectionQuality, setConnectionQuality] = useState<Map<string, ConnectionQuality>>(new Map());
  const [localPing, setLocalPing] = useState<number | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // FIX-LEAK: флаг монтирования — опрос статистики не должен вызывать setState после размонтирования.
  const isMountedRef = useRef(true);

  /* ── Push-to-Talk (рация) ── */
  const [pttEnabled, setPttEnabledState] = useState<boolean>(() => {
    // FIX-R13: default PTT to OFF. Defaulting to ON with a hidden Shift+Q bind
    // made the mic look broken for new users.
    if (typeof window !== "undefined") return localStorage.getItem("voice-ptt-enabled") === "1";
    return false;
  });
  const [pttKeys, setPttKeysState] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("voice-ptt-keys");
        if (saved) return JSON.parse(saved) as string[];
      } catch { /* ignore */ }
    }
    return ["Shift", "q"];
  });
  const [pttActive, setPttActive] = useState(false);
  const pttEnabledRef = useRef(pttEnabled);
  const pttKeysRef = useRef(pttKeys);
  const pttKeyDownRef = useRef(false);

  /* ── FIX-REPLAY: мгновенный повтор (только Premium; всё — локально на устройстве) ── */
  const [replayEnabled, setReplayEnabledState] = useState<boolean>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("voice-replay-enabled") !== "0";
    return true;
  });
  const [replayKeys, setReplayKeysState] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("voice-replay-keys");
        if (saved) return JSON.parse(saved) as string[];
      } catch { /* ignore */ }
    }
    return [];
  });
  /* Длительность буфера повтора, секунды. Настройка устройства: буфер живёт в
     памяти вкладки, на сервер не уходит. */
  const [replaySeconds, setReplaySecondsState] = useState<number>(() => {
    if (typeof window === "undefined") return REPLAY_MIN_SECONDS;
    const raw = Number(localStorage.getItem("voice-replay-seconds"));
    if (!Number.isFinite(raw)) return REPLAY_MIN_SECONDS;
    return Math.min(REPLAY_MAX_SECONDS, Math.max(REPLAY_MIN_SECONDS, Math.round(raw)));
  });
  const replaySecondsRef = useRef(replaySeconds);
  useEffect(() => { replaySecondsRef.current = replaySeconds; }, [replaySeconds]);
  const [replayReady, setReplayReady] = useState(false);
  const replayEnabledRef = useRef(replayEnabled);
  const replayKeysRef = useRef(replayKeys);
  const replayRecorderRef = useRef<ReplayRecorder | null>(null);
  const replayDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const replayMicSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const replayLocalScreenSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const replayScreenSrcRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const saveReplayRef = useRef<(() => Promise<boolean>) | null>(null);

  /* ── Refs ── */
  const socketRef           = useRef<Socket | null>(null);
  const rawStreamRef        = useRef<MediaStream | null>(null);
  const micGainRef          = useRef<number>(micGainDb);
  /** Узел усиления в цепочке микрофона: правится на ходу, без пересборки. */
  const micGainNodeRef      = useRef<GainNode | null>(null);
  /* Что подаётся на вход цепочки: выход шумодава или сырой микрофон. Нужен,
     чтобы собрать цепочку в середине разговора — когда человек только тронул
     ползунок усиления, а до этого цепочки не было вовсе. */
  const micChainInputRef    = useRef<MediaStream | null>(null);
  const localStreamRef      = useRef<MediaStream | null>(null);
  const screenStreamRef     = useRef<MediaStream | null>(null);
  /* SCREEN-PRIVATE: userId, которым видна наша трансляция (null — всем). Ref,
     потому что список читается при подключении нового пира, вне рендера. */
  const screenAllowRef      = useRef<Set<string> | null>(null);
  const [isScreenPrivate, setIsScreenPrivate] = useState(false);
  /* SCREEN-PRIVATE-LIVE: тот же список, что в screenAllowRef, но в состоянии —
     панель управления показом должна отрисовать текущие галочки. */
  const [screenAllowUserIds, setScreenAllowUserIds] = useState<string[] | null>(null);
  /* SCREEN-VIEWERS: состав зрителей по каждой трансляции (с сервера). */
  const [screenViewers, setScreenViewers] = useState<Map<string, { userId: string; userName: string }[]>>(new Map());
  /* Какую трансляцию мы сейчас смотрим — чтобы сняться со счётчика при закрытии. */
  const viewingScreenRef    = useRef<string | null>(null);

  /** SCREEN-PRIVATE: разрешена ли наша трансляция этому участнику канала. */
  const isScreenAllowedFor = useCallback((socketId: string): boolean => {
    const allow = screenAllowRef.current;
    if (!allow) return true; // публичный показ
    const target = usersRef.current.find(u => u.socketId === socketId);
    return !!target && allow.has(target.userId);
  }, []);
  // Single-flight guard for screen sharing: true from the moment the user asks
  // to share until the picker resolves or is dismissed. Together with
  // `screenStreamRef` it stops a burst of clicks from opening the picker (or
  // notifying the server) more than once. See `startScreenShare`.
  const screenShareRequestingRef = useRef(false);
  const peersRef            = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Sockets we are currently sending an offer to (perfect negotiation). Used to
  // detect and resolve a signaling glare when both peers offer at once.
  const makingOfferRef      = useRef<Set<string>>(new Set());
  // A screen share can now carry more than one track (video + audio), so each
  // peer keeps an array of the senders we added for it.
  const screenSendersRef    = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const remoteScreenRef     = useRef<Map<string, MediaStream>>(new Map());
  // FIX-CAM: зеркальные рефы для камеры. Отличать видео камеры от видео
  // демонстрации помогает сигнальное событие camera-started с id стрима:
  // в ontrack видео-дорожка со стримом из cameraStreamIdsRef — камера,
  // любая другая — демонстрация экрана (прежнее поведение).
  const cameraStreamRef     = useRef<MediaStream | null>(null);
  const cameraRequestingRef = useRef(false);
  const cameraSendersRef    = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const remoteCameraRef     = useRef<Map<string, MediaStream>>(new Map());
  const cameraStreamIdsRef  = useRef<Map<string, string>>(new Map());
  const audioCtxRef         = useRef<AudioContext | null>(null);
  const analyserRef         = useRef<AnalyserNode | null>(null);
  const speakingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const remoteAudiosRef     = useRef<Map<string, HTMLAudioElement>>(new Map());
  // ── Web Audio playback graph (per-user gain up to 200%) ──
  // Each remote voice track is routed through its own GainNode into a shared
  // master gain (used for deafen) and out to the speakers. A GainNode can
  // amplify past 1.0, which a plain <audio> element's `volume` (capped at 1.0)
  // cannot — this is what lets a listener boost someone to 200%.
  const playbackCtxRef      = useRef<AudioContext | null>(null);
  const masterGainRef       = useRef<GainNode | null>(null);
  const userGainRef         = useRef<Map<string, GainNode>>(new Map());
  const userSourceRef       = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  // Voice (mic) stream id per peer, so a later screen-audio track is never
  // mistaken for the mic and never clobbers the voice element.
  const micStreamIdRef      = useRef<Map<string, string>>(new Map());
  // Dedicated <audio> elements that play a remote screen share's sound. They
  // live here (not inside the share window) so audio keeps playing even when the
  // viewer minimises the window.
  const screenAudiosRef     = useRef<Map<string, HTMLAudioElement>>(new Map());
  const iceCandidateBufferRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const noiseSuppRef        = useRef<NoiseSuppressor | null>(null);
  /* EQ: узлы эквалайзера живут в контексте воспроизведения (playbackCtxRef).
     Так у монитора уже правильный вывод (setContextSink направляет destination
     этого контекста на выбранные наушники), не появляется третий AudioContext,
     а закрытие контекста при выходе из канала гарантированно снимает монитор. */
  const eqSourceRef         = useRef<MediaStreamAudioSourceNode | null>(null);
  const eqFiltersRef        = useRef<BiquadFilterNode[]>([]);
  const eqDestRef           = useRef<MediaStreamAudioDestinationNode | null>(null);
  const monitorGainRef      = useRef<GainNode | null>(null);
  // Monotonic token: a slower, older join attempt must never reconnect after
  // the user has already selected another voice channel.
  const joinAttemptRef      = useRef(0);
  const connectionSfxRef    = useRef<HTMLAudioElement | null>(null);
  const disconnectionSfxRef = useRef<HTMLAudioElement | null>(null);
  const screenShareSfxRef   = useRef<HTMLAudioElement | null>(null);
  const channelIdRef        = useRef<string | null>(null);
  const iceConfigRef        = useRef<RTCConfiguration>(DEFAULT_ICE);
  const isMutedRef          = useRef(isMuted);
  const isDeafenedRef       = useRef(isDeafened);
  // FIX-R10: remember whether the mic was muted before deafen, to restore it.
  const wasMutedBeforeDeafenRef = useRef(false);
  const isConnectedRef      = useRef(isConnected);
  const pttPulseTimerRef    = useRef<NodeJS.Timeout | null>(null);
  const isPremiumRef        = useRef(false);

  /* ── Fetch TURN/ICE config from API ── */
  useEffect(() => {
    fetch("/api/voice/turn").then(r => r.json()).then(data => {
      if (data?.iceServers) {
        // If TURN is configured, force relay-only to avoid NAT issues
        const hasTurn = data.iceServers.some((s: { urls: string | string[] }) =>
          (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u: string) => u.startsWith("turn"))
        );
        iceConfigRef.current = {
          iceServers: data.iceServers,
          iceTransportPolicy: hasTurn ? "relay" : "all",
          iceCandidatePoolSize: 2,
        };
      }
    }).catch(() => {});
  }, []);

  /* Keep channelIdRef in sync */
  useEffect(() => { channelIdRef.current = channelId; }, [channelId]);

  /* SCREEN-VIEWERS: объявлено ПОСЛЕ channelIdRef — правило
     react-hooks/immutability запрещает менять ref, который уже был захвачен
     хуком выше по файлу (иначе синхронизация channelIdRef перестаёт собираться). */
  /**
   * SCREEN-VIEWERS: сообщить серверу, что окно просмотра трансляции открыто
   * (или закрыто, если передан null). Сервер сверяет доступ и рассылает состав
   * зрителей ведущему и остальным зрителям.
   */
  const setViewingScreen = useCallback((ownerSocketId: string | null) => {
    const prev = viewingScreenRef.current;
    if (prev === ownerSocketId) return;
    if (prev) socketRef.current?.emit("screen-view-stop", { ownerSocketId: prev });
    viewingScreenRef.current = ownerSocketId;
    if (ownerSocketId) {
      // Берём канал из состояния, а не из channelIdRef: правило
      // react-hooks/immutability запрещает менять ref, захваченный хуком, а
      // channelIdRef переприсваивается при входе в канал.
      socketRef.current?.emit("screen-view-start", { channelId, ownerSocketId });
    }
  }, [channelId]);

  /* Keep mute/connection refs in sync (used by desktop-hotkey handlers) */
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);

  /* Keep premium status in sync so new peer connections pick the right bitrate.
     Also re-enforce the screen-share quality cap whenever the tier resolves or
     changes: a lapsed premium must fall back to 720p/30 immediately. */
  useEffect(() => {
    const premium = hasPremium(session?.user);
    isPremiumRef.current = premium;
    setScreenShareQualityState(prev => {
      const clamped = clampQualityToTier(prev, premium);
      if (clamped.resolution === prev.resolution && clamped.fps === prev.fps) return prev;
      screenShareQualityRef.current = clamped;
      if (typeof window !== "undefined") localStorage.setItem("voice-screen-quality", JSON.stringify(clamped));
      return clamped;
    });
  }, [session]);

  /* ── Выбор качества и звука для следующей демонстрации ──────────────────
   * До этого поменять качество можно было только в нативном окне запуска
   * десктоп-оболочки: в браузере значение бралось из localStorage, и менять его
   * было нечем — веб-версия навсегда оставалась на 720p/30. Оба
   * значения задаются в окне запуска показа и запоминаются на устройстве. */
  const setScreenShareQuality = useCallback((quality: ScreenShareQuality) => {
    // Прижимаем к тарифу здесь же: интерфейс блокирует premium-варианты, но
    // состояние не должно зависеть от того, что нарисовала кнопка.
    const clamped = clampQualityToTier(quality, isPremiumRef.current);
    screenShareQualityRef.current = clamped;
    setScreenShareQualityState(clamped);
    if (typeof window !== "undefined") {
      localStorage.setItem("voice-screen-quality", JSON.stringify(clamped));
    }
  }, []);

  const setScreenAudioEnabled = useCallback((enabled: boolean) => {
    setScreenAudioEnabledState(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem("voice-screen-audio", String(enabled));
    }
  }, []);

  /* Keep PTT refs in sync */
  useEffect(() => { pttEnabledRef.current = pttEnabled; }, [pttEnabled]);
  useEffect(() => { pttKeysRef.current = pttKeys; }, [pttKeys]);

  /* ── PTT actions ── */
  const setPttEnabled = useCallback((v: boolean) => {
    setPttEnabledState(v);
    localStorage.setItem("voice-ptt-enabled", v ? "1" : "0");
  }, []);

  const setPttKeys = useCallback((keys: string[]) => {
    setPttKeysState(keys);
    localStorage.setItem("voice-ptt-keys", JSON.stringify(keys));
  }, []);

  /* ── Sound effects ── */
  useEffect(() => {
    connectionSfxRef.current    = Object.assign(new Audio("/sounds/connection.mp3"),    { preload: "auto" as const });
    disconnectionSfxRef.current = Object.assign(new Audio("/sounds/disconnection.mp3"), { preload: "auto" as const });
    screenShareSfxRef.current   = Object.assign(new Audio("/sounds/screenshare.mp3"),   { preload: "auto" as const });
    // FIX-AUDIO-DEV: играем эффекты через выбранное устройство вывода.
    setElementSink(connectionSfxRef.current, outputDeviceIdRef.current);
    setElementSink(disconnectionSfxRef.current, outputDeviceIdRef.current);
    setElementSink(screenShareSfxRef.current, outputDeviceIdRef.current);
    return () => { connectionSfxRef.current = null; disconnectionSfxRef.current = null; screenShareSfxRef.current = null; };
  }, []);

  const playSound = useCallback((ref: React.RefObject<HTMLAudioElement | null>) => {
    if (!ref.current) return;
    // FIX-AUDIO-DEV: клон наследует src, но не sinkId — задаём устройство вывода заново.
    try { const c = ref.current.cloneNode() as HTMLAudioElement; c.volume = 0.5; setElementSink(c, outputDeviceIdRef.current); c.play().catch(() => {}); } catch { /* ignore */ }
  }, []);

  /* ── Screen video ── */
  const setScreenVideo = useCallback((stream: MediaStream | null) => {
    setScreenStreamState(stream);
  }, []);

  // Publish the live `remoteScreenRef` map into React state so the UI re-renders
  // whenever a remote share starts or stops. Cheap shallow copy of a tiny map.
  const syncRemoteScreens = useCallback(() => {
    setRemoteScreens(new Map(remoteScreenRef.current));
  }, []);

  // FIX-CAM: то же самое для удалённых камер.
  const syncRemoteCameras = useCallback(() => {
    setRemoteCameras(new Map(remoteCameraRef.current));
  }, []);

  /* ── Playback graph (Web Audio) ──
   * Lazily create the shared AudioContext + master GainNode used to play remote
   * voice. Returns null if Web Audio is unavailable, in which case callers fall
   * back to a plain <audio> element (volume capped at 100%). */
  const ensurePlaybackGraph = useCallback((): { ctx: AudioContext; master: GainNode } | null => {
    if (typeof window === "undefined" || !window.AudioContext) return null;
    if (!playbackCtxRef.current) {
      try {
        const ctx = new AudioContext();
        const master = ctx.createGain();
        master.gain.value = isDeafenedRef.current ? 0 : 1;
        master.connect(ctx.destination);
        // FIX-AUDIO-DEV: голос собеседников идёт через destination этого контекста —
        // направляем его на выбранное устройство вывода (Chromium 110+).
        setContextSink(ctx, outputDeviceIdRef.current);
        playbackCtxRef.current = ctx;
        masterGainRef.current = master;
      } catch {
        return null;
      }
    }
    // Autoplay policies can leave the context suspended until a gesture.
    if (playbackCtxRef.current.state === "suspended") playbackCtxRef.current.resume().catch(() => {});
    return { ctx: playbackCtxRef.current, master: masterGainRef.current! };
  }, []);

  /* ── EQ: эквалайзер исходящего голоса + монитор ──────────────────────────
   * Себя слышно только когда монитор включён И микрофон не выключен: иначе
   * mute выглядел бы сломанным — свой голос звучит, а до пиров не доходит.
   * Дорожка при mute глохнет сама (track.enabled), а узлы графа продолжают
   * работать, поэтому громкость монитора приходится гасить отдельно. */
  const applyMonitorGain = useCallback((mutedOverride?: boolean) => {
    const gain = monitorGainRef.current;
    if (!gain) return;
    const muted = mutedOverride ?? isMutedRef.current;
    gain.gain.value = monitorEnabledRef.current && !muted ? monitorVolumeRef.current : 0;
  }, []);

  /* Отслеживаем mute эффектом, а не вызовом в setMuted: микрофон выключается
     ещё из рации и из глушения наушников — они правят дорожки напрямую, и
     дублировать вызов в каждом месте значит где-то его забыть. Состояние
     передаём аргументом: isMutedRef синхронизируется отдельным эффектом, и
     полагаться на порядок их выполнения не нужно. */
  useEffect(() => { applyMonitorGain(isMuted); }, [isMuted, applyMonitorGain]);

  /** EQ: снять все узлы эквалайзера и монитора (утечка WebAudio недопустима). */
  const teardownEqChain = useCallback(() => {
    try { eqSourceRef.current?.disconnect(); } catch { /* ignore */ }
    eqFiltersRef.current.forEach(f => { try { f.disconnect(); } catch { /* ignore */ } });
    try { monitorGainRef.current?.disconnect(); } catch { /* ignore */ }
    try { micGainNodeRef.current?.disconnect(); } catch { /* ignore */ }
    // Дорожку исходящего стрима останавливаем сами: после смены микрофона её
    // никто уже не отдаёт пирам, а живой узел продолжал бы молоть звук.
    try { eqDestRef.current?.stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    eqSourceRef.current  = null;
    eqFiltersRef.current = [];
    eqDestRef.current    = null;
    monitorGainRef.current = null;
    micGainNodeRef.current = null;
    setEqActive(false);
  }, []);

  /**
   * EQ: собрать «источник → 5 полос → дорожка для пиров» плюс ветвь монитора.
   *
   * Возвращает стрим, который надо отдать пирам, или null — тогда цепочка
   * микрофона остаётся ровно такой, как без эквалайзера (нет подписки, нет
   * Web Audio или браузер отказался принять стрим).
   */
  const buildEqChain = useCallback((input: MediaStream): MediaStream | null => {
    teardownEqChain();
    /* Цепочка нужна в двух случаях: полосы эквалайзера (по подписке) и усиление
       микрофона (доступно всем). Ни того, ни другого — в графе не должно
       появиться ни одного лишнего узла: на 0 дБ без подписки путь микрофона
       остаётся ровно таким, каким был до этой правки. */
    const wantsEq = isPremiumRef.current;
    const wantsGain = micGainRef.current !== 0;
    if (!wantsEq && !wantsGain) return null;
    if (!input.getAudioTracks().length) return null;
    const graph = ensurePlaybackGraph();
    if (!graph) return null;
    try {
      const ctx = graph.ctx;
      const source = ctx.createMediaStreamSource(input);
      const filters = wantsEq ? EQ_BANDS.map((band, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.hz;
        filter.Q.value = band.q;
        filter.gain.value = clampDb(eqGainsRef.current[i] ?? 0);
        return filter;
      }) : [];
      // Полосы включены последовательно: каждая правит свой участок спектра.
      const shaped = filters.reduce<AudioNode>((prev, filter) => { prev.connect(filter); return filter; }, source);
      /* Усиление — последним звеном, после полос: иначе поднятый уровень пошёл
         бы в фильтры и на плюсовых полосах ловил перегруз. */
      const micGain = ctx.createGain();
      micGain.gain.value = micGainToFactor(micGainRef.current);
      shaped.connect(micGain);
      const last: AudioNode = micGain;
      const dest = ctx.createMediaStreamDestination();
      last.connect(dest);
      // Монитор — отдельная ветвь после полос: пиров она не касается, поэтому
      // громкость «в наушниках» не влияет на то, как слышат собеседники.
      const monitor = ctx.createGain();
      monitor.gain.value = 0;
      if (wantsEq) {
        last.connect(monitor);
        monitor.connect(ctx.destination);
      }
      eqSourceRef.current  = source;
      eqFiltersRef.current = filters;
      eqDestRef.current    = dest;
      monitorGainRef.current = monitor;
      micGainNodeRef.current = micGain;
      applyMonitorGain();
      /* Флаг «эквалайзер работает» — именно про полосы: цепочка теперь бывает
         собрана и ради одного усиления, и подпись «эквалайзер применяется» в
         таком случае врала бы. */
      setEqActive(wantsEq);
      return dest.stream;
    } catch (err) {
      // Firefox отказывает createMediaStreamSource при несовпадении частоты
      // дискретизации контекста и стрима — тогда просто остаёмся без полос,
      // передача при этом не страдает.
      console.warn("[Voice] эквалайзер не собрался:", err);
      teardownEqChain();
      return null;
    }
  }, [ensurePlaybackGraph, teardownEqChain, applyMonitorGain]);

  /* ── Peer cleanup ── */
  /**
   * Пересчитать потолок битрейта у всех отправителей показа.
   *
   * Вызывается не только при старте: состав зрителей меняется на ходу, и
   * бюджет надо делить заново. Без этого четвёртый вошедший просто отнимал
   * полосу у остальных, и качество проседало у всех разом.
   *
   * `degradationPreference` говорит браузеру, чем жертвовать при нехватке
   * полосы. Для текста и кода важнее чёткость — держим разрешение; для игры и
   * видео важнее плавность — держим частоту кадров. Выбор берём из частоты,
   * которую задал сам ведущий: 60 кадров выбирают ради движения.
   */
  const retuneScreenSenders = useCallback(() => {
    const q = clampQualityToTier(screenShareQualityRef.current, isPremiumRef.current);
    const peers = screenSendersRef.current.size;
    const base = SCREEN_BASE_BITRATE[`${q.resolution}-${q.fps}`] ?? SCREEN_BASE_BITRATE["720-30"];
    const perPeer = Math.max(
      SCREEN_MIN_BITRATE,
      Math.min(base, Math.round((isPremiumRef.current ? SCREEN_TOTAL_UPLINK_PREMIUM : SCREEN_TOTAL_UPLINK) / Math.max(1, peers))),
    );
    for (const senders of screenSendersRef.current.values()) {
      for (const sender of senders) {
        if (sender.track?.kind !== "video") continue;
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = perPeer;
        /* Поле новое, в типах браузера может отсутствовать — но игнорировать
           его нельзя: без подсказки браузер режет разрешение и текст мылится. */
        (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
          q.fps >= 60 ? "maintain-framerate" : "maintain-resolution";
        sender.setParameters(params).catch(() => { /* пир уже отвалился */ });
      }
    }
  }, []);

  const cleanupPeer = useCallback((socketId: string) => {
    peersRef.current.get(socketId)?.close();
    peersRef.current.delete(socketId);
    makingOfferRef.current.delete(socketId);
    iceCandidateBufferRef.current.delete(socketId); // FIX-R8: drop buffered ICE candidates
    const audio = remoteAudiosRef.current.get(socketId);
    if (audio) { audio.pause(); audio.srcObject = null; remoteAudiosRef.current.delete(socketId); }
    // Tear down this peer's slice of the playback graph.
    try { userSourceRef.current.get(socketId)?.disconnect(); } catch { /* ignore */ }
    try { userGainRef.current.get(socketId)?.disconnect(); } catch { /* ignore */ }
    userSourceRef.current.delete(socketId);
    userGainRef.current.delete(socketId);
    micStreamIdRef.current.delete(socketId);
    // Stop any screen-share audio playing from this peer.
    const scrAudio = screenAudiosRef.current.get(socketId);
    if (scrAudio) { scrAudio.pause(); scrAudio.srcObject = null; screenAudiosRef.current.delete(socketId); }
    // FIX-REPLAY: отключить ветку буфера повтора этого пира.
    try { replayScreenSrcRef.current.get(socketId)?.disconnect(); } catch { /* ignore */ }
    replayScreenSrcRef.current.delete(socketId);
    screenSendersRef.current.delete(socketId);
    /* Зрителей стало меньше — оставшимся можно отдать освободившуюся полосу. */
    retuneScreenSenders();
    // FIX-CAM: убрать камеру ушедшего участника.
    cameraSendersRef.current.delete(socketId);
    cameraStreamIdsRef.current.delete(socketId);
    if (remoteCameraRef.current.has(socketId)) {
      remoteCameraRef.current.delete(socketId);
      syncRemoteCameras();
    }
    if (remoteScreenRef.current.has(socketId)) {
      remoteScreenRef.current.delete(socketId);
      setRemoteScreenQualities(prev => {
        if (!prev.has(socketId)) return prev;
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
      syncRemoteScreens();
      setScreenSharerId(p => p === socketId ? null : p);
      setScreenShareName("");
      setScreenVideo(null);
    }
  }, [setScreenVideo, syncRemoteScreens, syncRemoteCameras, retuneScreenSenders]);

  /* ── Attach a remote participant's microphone ──
   * Sinks the track to a muted <audio> element (so the browser keeps pulling
   * media — a Web Audio + WebRTC quirk) and routes the same stream through a
   * per-user GainNode so the listener can boost it up to 200%. */
  const attachRemoteVoice = useCallback((socketId: string, stream: MediaStream, track: MediaStreamTrack) => {
    let audio = remoteAudiosRef.current.get(socketId);
    if (!audio) {
      audio = Object.assign(new Audio(), { autoplay: true });
      // FIX-AUDIO-DEV: направляем на выбранное устройство вывода (используется, когда
      // граф Web Audio недоступен и звук идёт напрямую из <audio>-элемента).
      setElementSink(audio, outputDeviceIdRef.current);
      remoteAudiosRef.current.set(socketId, audio);
    }
    audio.srcObject = stream;

    const vol = volumeFor(socketId) / 100; // 0..2
    const graph = ensurePlaybackGraph();
    if (graph) {
      try { userSourceRef.current.get(socketId)?.disconnect(); } catch { /* ignore */ }
      try { userGainRef.current.get(socketId)?.disconnect(); } catch { /* ignore */ }
      try {
        const source = graph.ctx.createMediaStreamSource(stream);
        const gain = graph.ctx.createGain();
        gain.gain.value = vol;
        source.connect(gain);
        gain.connect(graph.master);
        // FIX-REPLAY: голос собеседника (после перс. громкости) — и в буфер повтора.
        if (replayDestRef.current) { try { gain.connect(replayDestRef.current); } catch { /* ignore */ } }
        userSourceRef.current.set(socketId, source);
        userGainRef.current.set(socketId, gain);
        // The element merely pumps the track; the gain branch makes the sound.
        audio.muted = true;
        audio.volume = 1;
      } catch {
        audio.muted = isDeafenedRef.current;
        audio.volume = Math.min(1, vol);
      }
    } else {
      audio.muted = isDeafenedRef.current;
      audio.volume = Math.min(1, vol);
    }

    const tryPlay = () => {
      playbackCtxRef.current?.resume().catch(() => {});
      audio?.play().catch((e) => {
        console.warn("[Voice] audio.play() failed:", e.name, "- retrying on interaction");
        const retry = () => {
          audio?.play().catch(() => {});
          playbackCtxRef.current?.resume().catch(() => {});
          document.removeEventListener("click", retry);
        };
        document.addEventListener("click", retry, { once: true });
      });
    };
    tryPlay();
    track.onunmute = tryPlay;
  }, [ensurePlaybackGraph]);

  /* ── Attach a remote screen share's audio ──
   * Played through its own <audio> element that lives outside the share window,
   * so the sound continues even when the viewer minimises the window. */
  const attachScreenAudio = useCallback((socketId: string, stream: MediaStream, track: MediaStreamTrack) => {
    let audio = screenAudiosRef.current.get(socketId);
    if (!audio) {
      audio = Object.assign(new Audio(), { autoplay: true });
      // FIX-AUDIO-DEV: звук трансляции играет прямо из этого элемента — задаём вывод.
      setElementSink(audio, outputDeviceIdRef.current);
      screenAudiosRef.current.set(socketId, audio);
    }
    audio.srcObject = stream;
    audio.muted = isDeafenedRef.current; // deafen silences shared sound too
    audio.volume = 1;

    // FIX-REPLAY: звук трансляции — в буфер повтора (в обход deafen-заглушки элемента).
    if (replayDestRef.current && playbackCtxRef.current) {
      try {
        replayScreenSrcRef.current.get(socketId)?.disconnect();
        const replaySrc = playbackCtxRef.current.createMediaStreamSource(stream);
        replaySrc.connect(replayDestRef.current);
        replayScreenSrcRef.current.set(socketId, replaySrc);
      } catch { /* ignore */ }
    }

    const tryPlay = () => {
      // FIX-SS-AUDIO: общий AudioContext воспроизведения мог остаться
      // "suspended" из-за автоплей-политики — тогда звук демонстрации молча не
      // играет даже при живой аудиодорожке. Пробуждаем его перед проигрыванием.
      playbackCtxRef.current?.resume().catch(() => {});
      audio?.play().catch(() => {
        const retry = () => { audio?.play().catch(() => {}); document.removeEventListener("click", retry); };
        document.addEventListener("click", retry, { once: true });
      });
    };
    tryPlay();
    track.onunmute = tryPlay;
  }, []);

  /* ── Create peer connection ── */
  const createPeerConnection = useCallback((remoteSocketId: string, isInitiator: boolean) => {
    const existing = peersRef.current.get(remoteSocketId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(iceConfigRef.current);
    peersRef.current.set(remoteSocketId, pc);

    // Send an offer to this peer, flagging that we're mid-negotiation so an
    // incoming offer that races ours can be detected as a glare (see the
    // "voice-offer" handler). Always used instead of a bare emit.
    const sendOffer = async () => {
      makingOfferRef.current.add(remoteSocketId);
      try {
        const offer = await patchedOffer(pc);
        socketRef.current?.emit("voice-offer", { to: remoteSocketId, offer });
      } catch {
        cleanupPeer(remoteSocketId);
      } finally {
        makingOfferRef.current.delete(remoteSocketId);
      }
    };

    localStreamRef.current?.getTracks().forEach(t => {
      const sender = pc.addTrack(t, localStreamRef.current!);
      if (t.kind === "audio") {
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        // Premium subscribers transmit at full bitrate; regular users at half,
        // making their outgoing connection quality 2× lower.
        params.encodings[0].maxBitrate = isPremiumRef.current ? PREMIUM_AUDIO_BITRATE : REGULAR_AUDIO_BITRATE;
        sender.setParameters(params).catch(() => {});
      }
    });

    if (screenStreamRef.current && isScreenAllowedFor(remoteSocketId)) {
      // Send the whole screen share (video + any captured audio) to the new peer.
      // SCREEN-PRIVATE: приватная трансляция физически не отправляется тем, кого
      // нет в списке — не просто скрыта в интерфейсе.
      const senders = screenStreamRef.current.getTracks().map(t =>
        pc.addTrack(t, screenStreamRef.current!)
      );
      screenSendersRef.current.set(remoteSocketId, senders);
      /* Зрителей стало больше — общий бюджет отдачи делится заново. */
      retuneScreenSenders();
    }

    // FIX-CAM: если наша камера уже включена — новый участник тоже должен её видеть.
    if (cameraStreamRef.current) {
      const camSenders = cameraStreamRef.current.getTracks().map(t =>
        pc.addTrack(t, cameraStreamRef.current!)
      );
      cameraSendersRef.current.set(remoteSocketId, camSenders);
    }

    pc.ontrack = ({ track, streams: [stream] }) => {
      if (track.kind === "audio") {
        const knownMic = micStreamIdRef.current.get(remoteSocketId);
        // FIX-V5: дорожка, приехавшая в одном стриме с видео, — всегда звук
        // демонстрации, независимо от порядка прибытия. Раньше «первая пришедшая»
        // аудиодорожка считалась микрофоном; при гонке порядка треков микрофон
        // и звук экрана путались местами и голос мог играть по двум путям сразу.
        const isScreenAudio =
          stream.getVideoTracks().length > 0 ||
          remoteScreenRef.current.get(remoteSocketId)?.id === stream.id;
        const isMic = !isScreenAudio && (!knownMic || stream.id === knownMic);

        if (isMic) {
          if (!knownMic) micStreamIdRef.current.set(remoteSocketId, stream.id);
          attachRemoteVoice(remoteSocketId, stream, track);
        } else {
          attachScreenAudio(remoteSocketId, stream, track);
        }
      } else if (track.kind === "video") {
        // FIX-CAM: видео со стримом, объявленным в camera-started, — это камера
        // участника, а не демонстрация экрана. Ведём её отдельным путём.
        if (cameraStreamIdsRef.current.get(remoteSocketId) === stream.id) {
          remoteCameraRef.current.set(remoteSocketId, stream);
          syncRemoteCameras();
          track.onended = () => {
            if (remoteCameraRef.current.get(remoteSocketId)?.id === stream.id) {
              remoteCameraRef.current.delete(remoteSocketId);
              syncRemoteCameras();
            }
          };
          return;
        }
        // FIX-V5b: если аудио этого стрима успело ошибочно зарегистрироваться
        // как микрофон (гонка порядка дорожек) — снимаем регистрацию и гасим
        // голосовой путь, чтобы звук не играл по двум путям одновременно.
        if (micStreamIdRef.current.get(remoteSocketId) === stream.id) {
          micStreamIdRef.current.delete(remoteSocketId);
          const a = remoteAudiosRef.current.get(remoteSocketId);
          if (a) { a.pause(); a.srcObject = null; remoteAudiosRef.current.delete(remoteSocketId); }
          try { userSourceRef.current.get(remoteSocketId)?.disconnect(); } catch { /* ignore */ }
          try { userGainRef.current.get(remoteSocketId)?.disconnect(); } catch { /* ignore */ }
          userSourceRef.current.delete(remoteSocketId);
          userGainRef.current.delete(remoteSocketId);
        }
        remoteScreenRef.current.set(remoteSocketId, stream);
        syncRemoteScreens();
        setScreenSharerId(remoteSocketId);
        setScreenVideo(stream);
        // The screen's audio track may ride on this same stream — make sure it
        // is playing even if it arrived (or was classified) before the video.
        if (stream.getAudioTracks().length) {
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack && stream.id !== micStreamIdRef.current.get(remoteSocketId)) {
            attachScreenAudio(remoteSocketId, stream, audioTrack);
          }
        }
        track.onended = () => {
          remoteScreenRef.current.delete(remoteSocketId);
          setRemoteScreenQualities(prev => {
            if (!prev.has(remoteSocketId)) return prev;
            const next = new Map(prev);
            next.delete(remoteSocketId);
            return next;
          });
          syncRemoteScreens();
          const scr = screenAudiosRef.current.get(remoteSocketId);
          if (scr) { scr.pause(); scr.srcObject = null; screenAudiosRef.current.delete(remoteSocketId); }
          setScreenSharerId(p => p === remoteSocketId ? null : p);
          setScreenVideo(null);
        };
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socketRef.current?.emit("ice-candidate", { to: remoteSocketId, candidate: candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        setConnectionStage(prev => prev === "media" ? "connected" : prev);
        // Connection established — ensure audio is playing
        playbackCtxRef.current?.resume().catch(() => {});
        const audio = remoteAudiosRef.current.get(remoteSocketId);
        if (audio && audio.paused) audio.play().catch(() => {});
        const scr = screenAudiosRef.current.get(remoteSocketId);
        if (scr && scr.paused) scr.play().catch(() => {});
      }
      if (state === "failed") {
        console.warn("[Voice] ICE failed, restarting...");
        pc.restartIce();
        void sendOffer();
      }
      if (state === "disconnected") {
        // Give 5s for reconnect before cleanup
        setTimeout(() => {
          if (pc.connectionState === "disconnected") {
            pc.restartIce();
            void sendOffer();
          }
        }, 5000);
      }
    };

    if (isInitiator) {
      void sendOffer();
    }

    return pc;
  }, [cleanupPeer, setScreenVideo, attachRemoteVoice, attachScreenAudio, syncRemoteScreens, syncRemoteCameras]);

  /* ── Переспрос соединения после добавления ИСХОДЯЩЕЙ дорожки ──
   *
   * Отвечающая сторона не может добавить m-строку в answer. Когда в канал
   * входит новый участник, оффер отправляет он, а мы отвечаем — и наша
   * демонстрация с камерой в этот answer не попадают, хотя дорожки в соединение
   * уже добавлены (см. createPeerConnection). Уехать они могут только с нашим
   * собственным оффером. Ровно поэтому «зашёл в голосовой канал, а человек уже
   * транслирует — трансляции не видно»: дорожка есть, m-строки для неё нет.
   *
   * Ждём стабильного состояния, а не отправляем оффер сразу: в момент входа
   * оффер участника ещё в пути, и немедленный встречный оффер дал бы коллизию.
   * Разбор коллизий в обработчике voice-offer есть, но лишний повод для него
   * создавать незачем. Попытки прекращаются, если соединение закрылось или было
   * пересоздано — тогда дорожки добавит уже новое createPeerConnection. */
  const renegotiateOutbound = useCallback((remoteSocketId: string) => {
    const created = peersRef.current.get(remoteSocketId);
    if (!created) return;
    let attempts = 0;
    const attempt = async () => {
      const pc = peersRef.current.get(remoteSocketId);
      if (!pc || pc !== created || pc.signalingState === "closed") return;
      if (pc.signalingState !== "stable" || makingOfferRef.current.has(remoteSocketId)) {
        // ~6 секунд ожидания: дольше и переговоры уже не спасти.
        if (attempts++ < 24) window.setTimeout(() => { void attempt(); }, 250);
        return;
      }
      makingOfferRef.current.add(remoteSocketId);
      try {
        const offer = await patchedOffer(pc);
        socketRef.current?.emit("voice-offer", { to: remoteSocketId, offer });
      } catch {
        /* Состояние успело измениться — повторять нечего. */
      } finally {
        makingOfferRef.current.delete(remoteSocketId);
      }
    };
    window.setTimeout(() => { void attempt(); }, 250);
  }, []);

  /* ── Speaking detection ── */
  const startSpeakingDetection = useCallback(() => {
    const src = rawStreamRef.current;
    if (!src) return;
    const ctx = new AudioContext();
    // FIX-V1: this context is created long after the user's click (behind a
    // chain of awaits), so autoplay policies may start it "suspended". A
    // suspended context feeds the analyser permanent zeroes — the local user
    // never counts as speaking, "speaking" is never emitted, and peers never
    // see the speaking indicator flash. Same root cause as the explicit
    // resume() in NoiseSuppressor._build.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    ctx.createMediaStreamSource(src).connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let refreshTicks = 0;
    speakingIntervalRef.current = setInterval(() => {
      // The context can also be (re-)suspended later, e.g. by aggressive
      // power-saving; resume() is a cheap no-op while running.
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      setLocalSpeaking(prev => {
        // FIX-R11: hysteresis (enter 18 / exit 12) so the indicator does not
        // flicker when the level hovers around a single threshold.
        // Never advertise "speaking" while muted: the analyser listens to the
        // raw mic track, which stays live even when transmission is disabled.
        const speaking = !isMutedRef.current && (prev ? avg > 12 : avg > 18);
        // FIX-V2: "speaking" used to be emitted only on state CHANGES. The
        // first transition often fires before the server finishes the async
        // join-voice permission check, and the server silently drops events
        // from sockets not yet registered in the voice room — peers then
        // never learned the user was talking until the next pause/resume.
        // Reconnects lost the state the same way. Re-send the current state
        // every second so any dropped transition self-heals.
        refreshTicks++;
        if (prev !== speaking || refreshTicks >= 10) {
          refreshTicks = 0;
          socketRef.current?.emit("speaking", { channelId: channelIdRef.current, speaking });
        }
        return speaking;
      });
    }, 100);
  }, []);

  /* ── FIX-AUDIO-DEV: attach the RNNoise pipeline to a raw mic stream ──
   * Extracted from joinVoice so both the initial join and a live microphone
   * switch build the exact same pipeline: native processing feeds peers a safe
   * track immediately, then the WASM worklet's processed track replaces it on
   * every peer once ready. `shouldAbort` lets the caller cancel if the user
   * left or re-joined (join passes the joinAttempt guard; a live switch passes
   * a "still connected" check). */
  const attachNoiseSuppressor = useCallback((rawStream: MediaStream, shouldAbort: () => boolean) => {
    setNsStatus("loading");
    const ns = new NoiseSuppressor();
    ns.onStatus(s => {
      setNsStatus(s);
      // Safety net: if the RNNoise worklet can't run on this platform, the
      // mic would otherwise stay completely unfiltered (we disabled the
      // browser's suppression above). Re-enable it on the raw track so the
      // user is never left worse off than before.
      if (s === "error" || s === "unsupported") {
        const raw = rawStreamRef.current;
        const fallbackEnabled = nsEnabledRef.current;
        raw?.getAudioTracks().forEach(t => {
          t.applyConstraints({
            echoCancellation: true,
            noiseSuppression: fallbackEnabled,
            autoGainControl: fallbackEnabled,
          }).catch(err => console.warn("[Voice] native noise suppression fallback failed:", err));
        });
        // FIX-R4: if the worklet died after we already started transmitting,
        // peers would keep receiving the dead node's (often silent) output.
        // Reroute every affected audio sender back to the live raw mic track.
        const rawTrack = raw?.getAudioTracks()[0];
        if (rawTrack && localStreamRef.current && localStreamRef.current !== raw) {
          rawTrack.enabled = !isMutedRef.current;
          const deadTracks = new Set(localStreamRef.current.getAudioTracks());
          peersRef.current.forEach(pc => {
            pc.getSenders().forEach(sender => {
              if (sender.track && deadTracks.has(sender.track)) {
                void sender.replaceTrack(rawTrack).catch(() => {});
              }
            });
          });
          localStreamRef.current = raw;
          // EQ: пиры снова слушают сырой микрофон, дорожка эквалайзера больше
          // никуда не идёт — снимаем её узлы вместе с монитором.
          teardownEqChain();
        }
      }
    });
    /* Подписки на VAD здесь больше нет: NoiseSuppressor этот обратный вызов
       никогда не вызывает (в lib/noiseSuppressor поле _onVad только
       присваивается), и ни один компонент значение не читал. Если понадобится
       индикатор уровня микрофона — заводить под него отдельный маленький
       контекст: значение меняется десятки раз в секунду, и в общем контексте
       оно перерисовывало бы весь экран «Связи». */
    ns.setIntensity(nsIntensityRef.current);
    noiseSuppRef.current = ns;
    const capturedRawStream = rawStream;
    const rawTrack = capturedRawStream.getAudioTracks()[0];

    /* Подмена микрофонной дорожки у всех пиров. Вынесено в замыкание, потому
       что подменять её теперь надо в двух местах: когда готов RNNoise и когда
       эквалайзер встаёт после нативного шумодава. Отбор отправителей прежний —
       звук демонстрации не трогаем.
       Exact identity is normal. The audio/non-screen fallback also covers
       Electron versions that wrap MediaStreamTrack objects. */
    const replaceMicSenders = (track: MediaStreamTrack) => {
      const replacements: Promise<void>[] = [];
      const screenSenders = new Set(Array.from(screenSendersRef.current.values()).flat());
      peersRef.current.forEach(pc => {
        pc.getSenders().forEach(sender => {
          if (sender.track?.kind === "audio" &&
              !screenSenders.has(sender) &&
              (sender.track === rawTrack || !screenStreamRef.current?.getTracks().includes(sender.track))) {
            replacements.push(sender.replaceTrack(track));
          }
        });
      });
      return Promise.allSettled(replacements);
    };

    // RNNoise no longer blocks entering the channel. Chromium's native
    // processing provides a safe, audible track immediately; when the WASM
    // worklet becomes ready we replace only that microphone track on every
    // existing peer. New peers automatically receive localStreamRef's latest
    // track. Screen-share audio senders are never touched.
    void ns.init(capturedRawStream).then(async processedStream => {
      if (shouldAbort() || noiseSuppRef.current !== ns) {
        ns.destroy();
        return;
      }
      ns.setBypass(!nsEnabledRef.current);

      if (ns.status === "ready") {
        // EQ: полосы стоят ПОСЛЕ шумодава и до дорожки, уходящей пирам, —
        // эквалайзер правит уже очищенный сигнал, а не подсовывает шум RNNoise.
        micChainInputRef.current = processedStream;
        const eqStream = buildEqChain(processedStream);
        const outStream = eqStream ?? processedStream;
        const processedTrack = outStream.getAudioTracks()[0];
        if (!processedTrack) { teardownEqChain(); return; }
        processedTrack.enabled = !isMutedRef.current;
        await replaceMicSenders(processedTrack);
        if (!shouldAbort() && rawStreamRef.current === capturedRawStream) {
          localStreamRef.current = outStream;
        } else {
          // Пока шли подмены, микрофон сменили или человек вышел — цепочка
          // эквалайзера осталась без потребителя.
          teardownEqChain();
        }
      } else {
        const fallbackEnabled = nsEnabledRef.current;
        await Promise.all(capturedRawStream.getAudioTracks().map(track => track.applyConstraints({
          echoCancellation: true,
          noiseSuppression: fallbackEnabled,
          autoGainControl: fallbackEnabled,
        }).catch(err => console.warn("[Voice] could not configure native fallback:", err))));
        if (shouldAbort() || rawStreamRef.current !== capturedRawStream) return;
        // EQ: полосы нужны и на нативном шумодаве — цепочка та же, чистит
        // сигнал только браузер вместо RNNoise. Здесь дорожку у пиров надо
        // подменить самим: без эквалайзера они уже слушают сырой микрофон.
        micChainInputRef.current = capturedRawStream;
        const eqStream = buildEqChain(capturedRawStream);
        const eqTrack = eqStream?.getAudioTracks()[0];
        if (!eqStream || !eqTrack) {
          localStreamRef.current = capturedRawStream;
          return;
        }
        eqTrack.enabled = !isMutedRef.current;
        await replaceMicSenders(eqTrack);
        if (!shouldAbort() && rawStreamRef.current === capturedRawStream) localStreamRef.current = eqStream;
        else teardownEqChain();
      }
    }).catch(err => {
      console.warn("[Voice] background RNNoise init failed:", err);
      if (noiseSuppRef.current === ns) setNsStatus("error");
    });
  }, [buildEqChain, teardownEqChain]);

  /* ── Усиление микрофона ──
   *
   * Значение хранится в дБ и живёт в localStorage: настройка про устройство, а
   * не про аккаунт — с другого компьютера микрофон другой, и тащить туда чужое
   * усиление незачем.
   *
   * Применяется на ходу. Если цепочка микрофона уже собрана (эквалайзер по
   * подписке или усиление, выставленное ранее), достаточно тронуть один узел.
   * Если цепочки нет — а без подписки на 0 дБ её и не бывает — собираем её тут
   * же и подменяем дорожку у собеседников, чтобы ползунок работал сразу, а не
   * «после следующего входа в канал».
   */
  const setMicGain = useCallback((db: number) => {
    const value = clampMicGain(db);
    micGainRef.current = value;
    setMicGainDbState(value);
    if (typeof window !== "undefined") localStorage.setItem("voice-mic-gain", String(value));

    const node = micGainNodeRef.current;
    if (node) {
      /* Плавно, а не рывком: мгновенная смена коэффициента слышна щелчком, а
         ползунок двигают непрерывно. */
      const ctx = playbackCtxRef.current;
      const factor = micGainToFactor(value);
      if (ctx) node.gain.setTargetAtTime(factor, ctx.currentTime, 0.02);
      else node.gain.value = factor;
      return;
    }

    // Цепочки нет: собирать её ради 0 дБ бессмысленно — это тот же сигнал.
    if (value === 0) return;
    const input = micChainInputRef.current;
    if (!input || !isConnectedRef.current) return;
    const stream = buildEqChain(input);
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) return;
    track.enabled = !isMutedRef.current;
    const screenSenders = new Set(Array.from(screenSendersRef.current.values()).flat());
    const replacements: Promise<void>[] = [];
    peersRef.current.forEach(pc => {
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind === "audio" && !screenSenders.has(sender)) {
          replacements.push(sender.replaceTrack(track));
        }
      });
    });
    void Promise.allSettled(replacements).then(() => {
      /* Пока шли подмены, микрофон могли сменить или человек мог выйти — тогда
         цепочка осталась бы без потребителя. */
      if (micChainInputRef.current === input && isConnectedRef.current) localStreamRef.current = stream;
      else teardownEqChain();
    });
  }, [buildEqChain, teardownEqChain]);

  /* ── Noise suppressor controls ── */
  // `nsEnabled` toggles RNNoise on/off; `nsIntensity` (0..1) tunes how hard the
  // VAD gate ducks non-speech. Both persist so the choice survives a reload.
  const setNsEnabled = useCallback((v: boolean) => {
    setNsEnabledState(v);
    nsEnabledRef.current = v;
    if (typeof window !== "undefined") localStorage.setItem("voice-ns-enabled", v ? "1" : "0");
    const ns = noiseSuppRef.current;
    // RNNoise must receive an unmodified microphone signal. Native suppression
    // and AGC are enabled only by the error/unsupported fallback below.
    const nativeFallback = v && !!ns && (ns.status === "error" || ns.status === "unsupported");
    rawStreamRef.current?.getAudioTracks().forEach(t => {
      t.applyConstraints({
        echoCancellation: true,
        noiseSuppression: nativeFallback,
        autoGainControl: nativeFallback,
      }).catch(err => console.warn("[Voice] could not toggle native noise suppression:", err));
    });
    if (ns && ns.status !== "error" && ns.status !== "unsupported") {
      ns.setBypass(!v);
    }
  }, []);

  const setNsIntensity = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setNsIntensityState(clamped);
    nsIntensityRef.current = clamped;
    if (typeof window !== "undefined") localStorage.setItem("voice-ns-intensity", String(clamped));
    noiseSuppRef.current?.setIntensity(clamped);
  }, []);

  const toggleNS = useCallback(() => {
    setNsEnabled(!nsEnabledRef.current);
  }, [setNsEnabled]);

  /* ── EQ: управление эквалайзером и монитором ─────────────────────────────
   * Усиление правим у живых узлов: пересборка дорожки заставила бы каждого
   * пира пережить replaceTrack на каждое движение ползунка, а звук — щёлкнуть.
   * Если человек в канале без подписки, узлов просто нет — значения копятся в
   * памяти и применятся при следующем входе уже с Premium. */
  const setEqBandGain = useCallback((index: number, db: number) => {
    if (index < 0 || index >= EQ_BANDS.length) return;
    const value = clampDb(db);
    const next = [...eqGainsRef.current];
    next[index] = value;
    eqGainsRef.current = next;
    setEqGainsState(next);
    const filter = eqFiltersRef.current[index];
    if (filter) filter.gain.value = value;
    // Ползунки трогали руками — это уже «свои настройки», а не пресет.
    setEqPresetState("custom");
    persistEq(next, "custom");
  }, []);

  const setEqPreset = useCallback((preset: EqPresetId) => {
    // «Свои настройки» — не выбор, а следствие правки полос вручную.
    if (preset === "custom") return;
    const next = EQ_PRESETS[preset].map(clampDb);
    eqGainsRef.current = next;
    setEqGainsState(next);
    setEqPresetState(preset);
    eqFiltersRef.current.forEach((filter, i) => { filter.gain.value = next[i] ?? 0; });
    persistEq(next, preset);
  }, []);

  const setMonitorEnabled = useCallback((v: boolean) => {
    // Монитор имеет смысл только в канале и только по подписке. Включить его
    // «заранее» нельзя: узлов вне канала нет, а флаг остался бы включённым.
    const next = v && isConnectedRef.current && isPremiumRef.current;
    monitorEnabledRef.current = next;
    setMonitorEnabledState(next);
    applyMonitorGain();
  }, [applyMonitorGain]);

  const setMonitorVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    monitorVolumeRef.current = clamped;
    setMonitorVolumeState(clamped);
    if (typeof window !== "undefined") localStorage.setItem("voice-eq-monitor-volume", String(clamped));
    applyMonitorGain();
  }, [applyMonitorGain]);

  /* ── Push-to-Talk keybind handler ── */
  // Helper: check if the held modifier/keys match the configured PTT bind
  const keysMatchPtt = useCallback((e: KeyboardEvent): boolean => {
    const bind = pttKeysRef.current;
    if (bind.length === 0) return false;
    // Collect currently held modifier keys + e.key as the active combo
    const activeKeys: string[] = [];
    if (e.ctrlKey) activeKeys.push("Control");
    if (e.altKey) activeKeys.push("Alt");
    if (e.shiftKey) activeKeys.push("Shift");
    if (e.metaKey) activeKeys.push("Meta");
    // Add the non-modifier key itself (e.key), but skip modifier repeats
    const nk = e.key.toLowerCase();
    if (nk !== "control" && nk !== "alt" && nk !== "shift" && nk !== "meta") {
      activeKeys.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    }
    // Sort both arrays for comparison (order doesn't matter)
    const bindSorted = [...bind].map(k => k.toLowerCase()).sort();
    const activeSorted = [...activeKeys].sort();
    if (bindSorted.length !== activeSorted.length) return false;
    return bindSorted.every((k, i) => k === activeSorted[i]);
  }, []);

  useEffect(() => {
    // FIX-R3: depend on state (not the ref) so toggling PTT applies live,
    // without leaving and re-joining the channel.
    if (!isConnected || !pttEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (pttKeyDownRef.current) return;
      // Ignore when user is typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = (e.target as HTMLElement)?.contentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || editable === "true" || editable === "plaintext-only") return;
      if (!keysMatchPtt(e)) return;
      pttKeyDownRef.current = true;
      setPttActive(true);
      const raw = rawStreamRef.current;
      const local = localStreamRef.current;
      if (raw) raw.getAudioTracks().forEach(t => { t.enabled = true; });
      if (local) local.getAudioTracks().forEach(t => { t.enabled = true; });
      setIsMuted(false);
      socketRef.current?.emit("toggle-mute", { channelId: channelIdRef.current, muted: false });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!pttKeyDownRef.current) return;
      // Check if the released key is part of the PTT bind
      const bind = pttKeysRef.current;
      const releasedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const bindLower = bind.map(k => k.toLowerCase());
      if (!bindLower.includes(releasedKey)
        && !(e.key === "Control" && bindLower.includes("control"))
        && !(e.key === "Alt" && bindLower.includes("alt"))
        && !(e.key === "Shift" && bindLower.includes("shift"))
        && !(e.key === "Meta" && bindLower.includes("meta"))) return;
      pttKeyDownRef.current = false;
      setPttActive(false);
      const raw = rawStreamRef.current;
      const local = localStreamRef.current;
      if (raw) raw.getAudioTracks().forEach(t => { t.enabled = false; });
      if (local) local.getAudioTracks().forEach(t => { t.enabled = false; });
      setIsMuted(true);
      socketRef.current?.emit("toggle-mute", { channelId: channelIdRef.current, muted: true });
    };

    // `keyup` only fires while the window has focus. If the user releases the
    // PTT key after Alt+Tab, minimising, or opening devtools, the mic would
    // stay open. Force it shut whenever the window loses focus or is hidden.
    const forcePttRelease = () => {
      if (!pttKeyDownRef.current) return;
      pttKeyDownRef.current = false;
      setPttActive(false);
      const raw = rawStreamRef.current;
      const local = localStreamRef.current;
      if (raw) raw.getAudioTracks().forEach(t => { t.enabled = false; });
      if (local) local.getAudioTracks().forEach(t => { t.enabled = false; });
      setIsMuted(true);
      socketRef.current?.emit("toggle-mute", { channelId: channelIdRef.current, muted: true });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", forcePttRelease);
    document.addEventListener("visibilitychange", forcePttRelease);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", forcePttRelease);
      document.removeEventListener("visibilitychange", forcePttRelease);
    };
  }, [isConnected, pttEnabled, keysMatchPtt]);

  /* FIX-CAMSHARE: во время демонстрации экрана соединение почти всегда занято
     переговорами (signalingState не равен "stable"), а прежний код в этом случае
     просто пропускал отправку offer: дорожка добавлялась локально, но до других
     участников не доезжала. Со стороны это выглядело так, будто камеру и показ
     нельзя включить одновременно. Теперь offer уходит сразу, если можно, иначе —
     при первом возврате соединения в стабильное состояние. */
  const offerWhenStable = useCallback((peerId: string, pc: RTCPeerConnection) => {
    const send = async () => {
      try {
        const offer = await patchedOffer(pc);
        socketRef.current?.emit("voice-offer", { to: peerId, offer });
      } catch { /* ignore */ }
    };
    if (pc.signalingState === "stable") { void send(); return; }
    const onChange = () => {
      if (pc.signalingState !== "stable") return;
      pc.removeEventListener("signalingstatechange", onChange);
      void send();
    };
    pc.addEventListener("signalingstatechange", onChange);
  }, []);

  /* ── FIX-CAM: выключить камеру ── */
  const stopCamera = useCallback(async () => {
    if (!cameraStreamRef.current) return;
    for (const [id, pc] of peersRef.current) {
      const senders = cameraSendersRef.current.get(id) ?? [];
      for (const sender of senders) {
        try { pc.removeTrack(sender); } catch { /* ignore */ }
      }
      if (pc.signalingState === "stable") {
        try {
          const offer = await patchedOffer(pc);
          socketRef.current?.emit("voice-offer", { to: id, offer });
        } catch { /* ignore */ }
      }
    }
    cameraSendersRef.current.clear();
    cameraStreamRef.current.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    socketRef.current?.emit("camera-stopped", { channelId: channelIdRef.current });
    setIsCameraOn(false);
    setLocalCameraStream(null);
  }, []);

  /* ── FIX-CAM: включить камеру ── */
  const startCamera = useCallback(async () => {
    if (!isConnectedRef.current || !navigator.mediaDevices?.getUserMedia) {
      setError("Камера не поддерживается в этом браузере.");
      return;
    }
    // Та же защита от двойных кликов, что и у демонстрации экрана.
    if (cameraStreamRef.current || cameraRequestingRef.current) return;
    cameraRequestingRef.current = true;
    try {
      // Качество по подписке: Premium — 1080p, обычный аккаунт — 720p.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          buildCameraConstraints(isPremiumRef.current, cameraDeviceIdRef.current),
        );
      } catch {
        // FIX-CAM-DEV: выбранная камера могла быть отключена — пробуем камеру по умолчанию.
        if (cameraDeviceIdRef.current) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(buildCameraConstraints(isPremiumRef.current, null));
          } catch {
            setError("Не удалось получить доступ к камере. Проверьте разрешения.");
            return;
          }
        } else {
          setError("Не удалось получить доступ к камере. Проверьте разрешения.");
          return;
        }
      }
      // Пока шёл запрос, пользователь мог выйти из канала — освобождаем стрим.
      if (cameraStreamRef.current || !isConnectedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      cameraStreamRef.current = stream;

      for (const [id, pc] of peersRef.current) {
        const senders = stream.getTracks().map(t => pc.addTrack(t, stream));
        cameraSendersRef.current.set(id, senders);
        offerWhenStable(id, pc); // FIX-CAMSHARE
      }
      // Сообщаем id стрима, чтобы получатели отличили камеру от демонстрации.
      socketRef.current?.emit("camera-started", { channelId: channelIdRef.current, streamId: stream.id });
      setIsCameraOn(true);
      setLocalCameraStream(stream);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.onended = () => { void stopCamera(); };
    } finally {
      cameraRequestingRef.current = false;
    }
  }, [stopCamera, offerWhenStable]);

  /* ── FIX-CAM: тумблер камеры ── */
  const toggleCamera = useCallback(async () => {
    if (cameraStreamRef.current) await stopCamera();
    else await startCamera();
  }, [startCamera, stopCamera]);

  /* ── FIX-CAM-DEV: обновить список доступных камер ── */
  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter(d => d.kind === "videoinput");
      setCameraDevices(cams.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Камера ${i + 1}` })));
    } catch { /* ignore */ }
  }, []);

  /* ── FIX-CAM-DEV: выбрать камеру; если она уже включена — перезапускаем на новом устройстве ── */
  const setCameraDevice = useCallback(async (deviceId: string | null) => {
    cameraDeviceIdRef.current = deviceId;
    setCameraDeviceIdState(deviceId);
    if (typeof window !== "undefined") {
      if (deviceId) localStorage.setItem("voice-camera-device", deviceId);
      else localStorage.removeItem("voice-camera-device");
    }
    if (cameraStreamRef.current) {
      await stopCamera();
      await startCamera();
    }
  }, [startCamera, stopCamera]);

  /* ── FIX-AUDIO-DEV: обновить списки микрофонов и устройств вывода ── */
  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(
        all.filter(d => d.kind === "audioinput")
           .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Микрофон ${i + 1}` })),
      );
      setOutputDevices(
        all.filter(d => d.kind === "audiooutput")
           .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Устройство вывода ${i + 1}` })),
      );
    } catch { /* ignore */ }
  }, []);

  /* ── FIX-AUDIO-DEV: направить всё воспроизведение на выбранное устройство вывода ──
   * Голос собеседников идёт через destination playback-контекста (setSinkId на
   * AudioContext, Chromium 110+); звук трансляции и эффекты — через свои
   * <audio>-элементы. Применяем ко всем сразу; неподдерживаемые вызовы молча
   * игнорируются (setElementSink/setContextSink делают feature-detect). */
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const applyOutputSink = useCallback((deviceId: string | null) => {
    setContextSink(playbackCtxRef.current, deviceId);
    remoteAudiosRef.current.forEach(el => setElementSink(el, deviceId));
    screenAudiosRef.current.forEach(el => setElementSink(el, deviceId));
    setElementSink(connectionSfxRef.current, deviceId);
    setElementSink(disconnectionSfxRef.current, deviceId);
    setElementSink(screenShareSfxRef.current, deviceId);
    setUiSoundsSink(deviceId); // FIX-SFX: звуки действий — на то же устройство вывода
  }, []);
  /* ── FIX-DEFAULTDEV: при первом запуске подбираем устройства по умолчанию ──────
   * localStorage хранит выбор пользователя. Если его нет — берём первое устройство
   * (браузер/ОС выдают default первым), а не оставляем null. Это решает проблему
   * десктоп-оболочки, где null = «системное по умолчанию» работает в браузере,
   * но Electron требует явного deviceId чтобы MediaDevices его зафиксировал. */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    const detect = async () => {
      try {
        // Запрашиваем пермишен на аудио (без пермишена labels = "", id = ""|"default")
        // Тихо — не показываем диалог если пользователь уже откло нил.
        try {
          const test = await navigator.mediaDevices.getUserMedia({ audio: true });
          test.getTracks().forEach(t => t.stop());
        } catch { /* нет пермишена — enumerateDevices вернёт анонимные устройства */ }
        const devices = await navigator.mediaDevices.enumerateDevices();

        const inputs  = devices.filter(d => d.kind === "audioinput");
        const outputs = devices.filter(d => d.kind === "audiooutput");

        setInputDevices(inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Микрофон ${i + 1}` })));
        setOutputDevices(outputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Динамики ${i + 1}` })));

        // Только если пользователь ещё не выбирал вручную (нет сохранённого) —
        // ставим «default» или первое реальное устройство.
        const savedMic = localStorage.getItem("voice-mic-device");
        const savedOut = localStorage.getItem("voice-output-device");

        if (!savedMic && inputs.length > 0) {
          const def = inputs.find(d => d.deviceId === "default") ?? inputs[0];
          micDeviceIdRef.current = def.deviceId;
          setMicDeviceIdState(def.deviceId);
          // Не пишем в localStorage — это авто, а не явный выбор пользователя.
        }
        if (!savedOut && outputs.length > 0) {
          const def = outputs.find(d => d.deviceId === "default") ?? outputs[0];
          outputDeviceIdRef.current = def.deviceId;
          setOutputDeviceIdState(def.deviceId);
          applyOutputSink(def.deviceId);
        }
      } catch { /* ignore */ }
    };
    void detect();

    // Следим за подключением/отключением устройств
    const handleDeviceChange = () => void detect();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyOutputSink]);


  const setOutputDevice = useCallback(async (deviceId: string | null) => {
    outputDeviceIdRef.current = deviceId;
    setOutputDeviceIdState(deviceId);
    if (typeof window !== "undefined") {
      if (deviceId) localStorage.setItem("voice-output-device", deviceId);
      else localStorage.removeItem("voice-output-device");
    }
    applyOutputSink(deviceId);
  }, [applyOutputSink]);

  /* ── FIX-AUDIO-DEV: пересобрать микрофонный конвейер на новом устройстве ──
   * Живая замена без выхода из канала: захватываем поток с выбранного
   * микрофона, сразу отдаём его пирам (сырым, чтобы речь не прерывалась),
   * перезапускаем определение речи и RNNoise, затем гасим старые ресурсы. */
  const restartMicPipeline = useCallback(async () => {
    if (!isConnectedRef.current || !navigator.mediaDevices?.getUserMedia) return;
    const micId = micDeviceIdRef.current;
    let newRaw: MediaStream | null = null;
    try {
      try { newRaw = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId, true)); }
      catch { newRaw = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId, false)); }
    } catch {
      // Selected device unavailable: fall back to the system default rather than
      // dropping the mic entirely.
      if (!micId) return;
      try { newRaw = await navigator.mediaDevices.getUserMedia(buildMicConstraints(null, false)); }
      catch { return; }
    }
    if (!isConnectedRef.current) { newRaw.getTracks().forEach(t => t.stop()); return; }

    const newTrack = newRaw.getAudioTracks()[0];
    if (!newTrack) { newRaw.getTracks().forEach(t => t.stop()); return; }
    newTrack.enabled = !isMutedRef.current;

    // Immediately route the new (raw) mic to peers so speech isn't interrupted
    // while RNNoise re-initialises. Screen-share audio senders are left alone.
    const screenSenders = new Set(Array.from(screenSendersRef.current.values()).flat());
    peersRef.current.forEach(pc => {
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind === "audio" && !screenSenders.has(sender)) {
          void sender.replaceTrack(newTrack).catch(() => {});
        }
      });
    });

    // Tear down the previous pipeline (old suppressor, speaking detector, stream).
    const oldRaw = rawStreamRef.current;
    const oldNs = noiseSuppRef.current;
    noiseSuppRef.current = null;
    if (speakingIntervalRef.current) { clearInterval(speakingIntervalRef.current); speakingIntervalRef.current = null; }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    // EQ: цепочка висела на прежнем микрофоне — снимаем её сразу, иначе до
    // готовности нового шумодава монитор играл бы звук мёртвого устройства.
    teardownEqChain();

    rawStreamRef.current = newRaw;
    localStreamRef.current = newRaw;

    startSpeakingDetection();
    attachNoiseSuppressor(newRaw, () => !isConnectedRef.current);

    oldNs?.destroy();
    if (oldRaw && oldRaw !== newRaw) oldRaw.getTracks().forEach(t => t.stop());
  }, [startSpeakingDetection, attachNoiseSuppressor, teardownEqChain]);

  const setMicDevice = useCallback(async (deviceId: string | null) => {
    micDeviceIdRef.current = deviceId;
    setMicDeviceIdState(deviceId);
    if (typeof window !== "undefined") {
      if (deviceId) localStorage.setItem("voice-mic-device", deviceId);
      else localStorage.removeItem("voice-mic-device");
    }
    if (isConnectedRef.current) await restartMicPipeline();
  }, [restartMicPipeline]);

  /* ── Stop screen share ── */
  const stopScreenShare = useCallback(async () => {
    if (!screenStreamRef.current) return;
    /* SCREEN-PRIVATE: показ окончен — список разрешённых больше не действует. */
    screenAllowRef.current = null;
    setIsScreenPrivate(false);
    setScreenAllowUserIds(null);
    for (const [id, pc] of peersRef.current) {
      const senders = screenSendersRef.current.get(id) ?? [];
      for (const sender of senders) {
        try { pc.removeTrack(sender); } catch { /* ignore */ }
      }
      if (pc.signalingState === "stable") {
        try {
          const offer = await patchedOffer(pc);
          socketRef.current?.emit("voice-offer", { to: id, offer });
        } catch { /* ignore */ }
      }
    }
    screenSendersRef.current.clear();
    screenStreamRef.current.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    socketRef.current?.emit("screen-share-stopped", { channelId: channelIdRef.current });
    setIsSharingScreen(false);
    setLocalScreenStream(null);
    setScreenVideo(null);
    // FIX-SFX: звук остановки демонстрации — локально, только для нажавшего
    // (сюда попадают и кнопка «Остановить», и нативная кнопка браузера/ОС).
    playUiSound("screenShareStop");
  }, [setScreenVideo]);

  /* ── Start screen share ── */
  const startScreenShare = useCallback(async (allowUserIds?: string[] | null, sourceId?: string | null) => {
    /* SCREEN-PRIVATE: фиксируем список до открытия системного диалога выбора
       экрана — дальше он читается при добавлении треков и при подключении
       новых участников. */
    const allowSet = Array.isArray(allowUserIds) && allowUserIds.length > 0 ? new Set(allowUserIds) : null;
    if (!isConnected || !navigator.mediaDevices?.getDisplayMedia) {
      setError("Демонстрация экрана не поддерживается в этом браузере.");
      return;
    }
    // Single-flight guard. A share is "in progress" from the moment the user
    // clicks until the picker resolves (a stream arrives) or is dismissed. Both
    // the in-flight flag and the live stream are checked so that:
    //   • rapid double/triple-clicks can never open a second picker window, and
    //   • no duplicate "screen-share-started" ever reaches the server.
    // Using refs (not state) makes the guard synchronous — a burst of clicks in
    // the same tick is rejected before React re-renders. The flag stays set for
    // the whole flow (picker + negotiation) and is cleared in `finally`.
    if (screenStreamRef.current || screenShareRequestingRef.current) return;
    screenShareRequestingRef.current = true;
    try {
      // Качество выбрано в окне запуска и лежит в состоянии; прижимаем к тарифу
      // ещё раз — на случай устаревшего значения из localStorage.
      const quality = clampQualityToTier(screenShareQualityRef.current, isPremiumRef.current);

      /* Оболочке сообщаем готовый выбор: источник, качество, звук и тариф.
         Своего окна с вопросами у неё больше нет — она просто отдаёт выбранное
         в ответ на запрос медиа (см. apps/desktop/src/main/screenShare.ts).
         Ответа ждать нечего, поэтому и таймаутов здесь тоже больше нет. */
      const desktop = getDesktopApi();
      // FIX-SS-ECHO: системный (loopback) звук — это ВЕСЬ звук ПК, включая голоса
      // собеседников, которые проигрывает сам TZ.Connect: у зрителей они
      // возвращаются эхом. Поэтому звук теперь ВЫКЛЮЧЕН по умолчанию и включается
      // вручную в окне запуска (с явным предупреждением) — см. readScreenAudioPref.
      const audioPref = readScreenAudioPref();
      // Источник из окна запуска. Есть он только в оболочке: перечислить окна
      // ОС браузеру нечем, там источник спрашивает системный диалог.
      const chosenSource = typeof sourceId === "string" && sourceId ? sourceId : null;
      const shellPicksSource = !!(chosenSource && desktop?.getScreenSources);
      if (desktop?.prepareScreenShare) {
        await desktop.prepareScreenShare({
          isPremium: isPremiumRef.current,
          resolution: quality.resolution,
          fps: quality.fps,
          audio: audioPref,
          sourceId: chosenSource,
        });
      }

      const constraints = buildScreenConstraints(quality);
      let stream: MediaStream;
      try {
        // WASAPI-SS: на Windows в оболочке звук захватывает нативный WASAPI-адаптер
        // (PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE) — Chromium-loopback
        // НЕ используем, иначе весь системный микс включая голоса участников TZ.Connect
        // попал бы обратно в стрим.
        const isWasapiDesktop = !!(desktop?.startWasapiCapture && desktop?.platform === "win32");
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: constraints.video,
          audio: isWasapiDesktop ? false : audioPref,
        });
      } catch (err) {
        const name = (err as { name?: string } | null)?.name ?? "";
        if (shellPicksSource) {
          /* Источник выбран в приложении, никакого диалога дальше нет — значит
             отказ это настоящий отказ, а не «человек передумал». Чаще всего
             выбранное окно успели закрыть. */
          setError("Выбранное окно или экран больше недоступны — выберите источник заново.");
        } else if (name !== "NotAllowedError" && name !== "AbortError") {
          /* Закрытый системный диалог — не ошибка. Но раньше молча пропадало и
             всё остальное: нет прав на запись экрана, источник занят — кнопка не
             давала ни показа, ни объяснения. Теперь причина видна. */
          setError(`Не удалось начать демонстрацию${name ? ` (${name})` : ""}. Проверьте разрешение на запись экрана в системе.`);
        }
        return;
      }

      // A share may have started elsewhere, or the user may have left the
      // channel, while the picker was open — release the fresh stream and bail.
      if (screenStreamRef.current || !isConnectedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      screenStreamRef.current = stream;

      // WASAPI-SS: пробуем получить WASAPI audio track (только Windows-оболочка).
      // Голосовой pipeline (микрофон) не затрагиваем.
      // Если нативный захват недоступен (не-Windows, нет аддона, ошибка Windows API),
      // просто продолжаем с видео без звука.
      let wasapiCleanup: (() => void) | null = null;
      if (isWasapiDesktop && audioPref) {
        try {
          const wasapiResult = await acquireWasapiAudioTrack(desktop);
          if (wasapiResult) {
            // Добавляем WASAPI audio track в stream и в screenStreamRef
            stream.addTrack(wasapiResult.track);
            wasapiCleanup = wasapiResult.cleanup;
            console.log("[wasapi-ss] WASAPI audio track acquired and added to screen stream");
          } else {
            console.warn("[wasapi-ss] WASAPI capture unavailable — screen-share without audio");
          }
        } catch (wasapiErr) {
          console.error("[wasapi-ss] acquireWasapiAudioTrack failed:", wasapiErr);
        }
      }

      /* Звук мог не приехать: браузер не умеет отдавать звук экрана (Firefox,
         Safari), а в оболочке loopback есть только на Windows. Отдельно ничего
         снимать не нужно — просто дорожки может не быть. */

      // Enforce the chosen resolution/fps on the live track. getDisplayMedia's
      // `max` is advisory and some capture backends ignore it, so we downscale
      // explicitly to exactly what the user selected (and their tier allows).
      const videoTrack = stream.getVideoTracks()[0];
      const res = SCREEN_RES[quality.resolution];
      try {
        await videoTrack.applyConstraints({
          width:     { max: res.width },
          height:    { max: res.height },
          frameRate: { max: quality.fps },
        });
      } catch { /* best-effort cap */ }

      /* Подсказка браузеру, что именно на экране. Без неё кодировщик считает
         картинку обычным видео и при движении размывает мелкие детали — текст
         и код становятся нечитаемыми. 60 кадров выбирают ради движения (игра,
         видео), 30 — ради статичного содержимого. */
      videoTrack.contentHint = quality.fps >= 60 ? "motion" : "detail";

      // Video + (для целых экранов, по желанию) системный звук.
      screenAllowRef.current = allowSet;
      setIsScreenPrivate(!!allowSet);
      setScreenAllowUserIds(allowSet ? Array.from(allowSet) : null);

      const shareTracks = stream.getTracks();
      for (const [id, pc] of peersRef.current) {
        // SCREEN-PRIVATE: постороннему участнику дорожки не добавляем вовсе.
        if (!isScreenAllowedFor(id)) continue;
        const senders = shareTracks.map(t => pc.addTrack(t, stream));
        screenSendersRef.current.set(id, senders);
        offerWhenStable(id, pc); // FIX-CAMSHARE
      }
      retuneScreenSenders();
      socketRef.current?.emit("screen-share-started", { channelId: channelIdRef.current, quality, allowUserIds: allowSet ? Array.from(allowSet) : null });
      setIsSharingScreen(true);
      setLocalScreenStream(stream);
      setScreenVideo(stream);
      playSound(screenShareSfxRef);
      videoTrack.onended = () => {
        wasapiCleanup?.();
        stopScreenShare();
      };
    } finally {
      screenShareRequestingRef.current = false;
    }
  }, [isConnected, setScreenVideo, stopScreenShare, playSound, retuneScreenSenders, offerWhenStable]);

  /* ── Смена состава допущенных на живом показе ──
     SCREEN-PRIVATE-LIVE: ведущий открывает панель правым щелчком по своему окну
     демонстрации. Показ не перезапускается: тем, кто получил доступ, дорожки
     добавляются, у кого отобрали — снимаются, и только затронутым пирам уходит
     новый offer. Список параллельно уходит на сервер, чтобы он объявил (или
     отозвал) трансляцию у соответствующих участников. */
  const updateScreenAllow = useCallback(async (allowUserIds: string[] | null) => {
    const stream = screenStreamRef.current;
    if (!stream) return;

    const allowSet = Array.isArray(allowUserIds) && allowUserIds.length > 0 ? new Set(allowUserIds) : null;
    screenAllowRef.current = allowSet;
    setIsScreenPrivate(!!allowSet);
    setScreenAllowUserIds(allowSet ? Array.from(allowSet) : null);

    const shareTracks = stream.getTracks();
    for (const [id, pc] of peersRef.current) {
      const senders = screenSendersRef.current.get(id) ?? [];
      const hadTracks = senders.length > 0;
      const allowed = isScreenAllowedFor(id);
      if (allowed === hadTracks) continue; // ничего не меняется — не тревожим пира

      if (allowed) {
        screenSendersRef.current.set(id, shareTracks.map((t) => pc.addTrack(t, stream)));
        retuneScreenSenders();
      } else {
        for (const sender of senders) {
          try { pc.removeTrack(sender); } catch { /* ignore */ }
        }
        screenSendersRef.current.delete(id);
      }

      if (pc.signalingState === "stable") {
        try {
          const offer = await patchedOffer(pc);
          socketRef.current?.emit("voice-offer", { to: id, offer });
        } catch { /* ignore */ }
      }
    }

    socketRef.current?.emit("screen-share-allow-update", {
      channelId: channelIdRef.current,
      allowUserIds: allowSet ? Array.from(allowSet) : null,
    });
  }, [isScreenAllowedFor, retuneScreenSenders]);

  /* ── Leave voice ── */
  /* Причину выхода печатаем всегда: жалобы вида «меня выкинуло из голосового»
     иначе неотличимы друг от друга — обрыв связи, замена сессии, уход со
     страницы и нажатие кнопки выглядят для человека одинаково. По этой строке
     в консоли видно, какая именно ветка сработала.

     `reason` приходит и из обработчиков вида onClick={leaveVoice} — туда React
     передаёт событие мыши, поэтому берём только строки. */
  const leaveVoice = useCallback((reason?: unknown) => {
    const why = typeof reason === "string" ? reason : "кнопка выхода";
    console.info(`[voice] выход из канала: ${why}`);
    joinAttemptRef.current += 1;
    const disconnectedChannelId = channelIdRef.current;
    setConnectionStage("disconnecting");
    // FIX-V1: опираемся на ref, а не на состояние isSharingScreen: захваченный экран
    // мог остаться жить при рассинхроне состояния — тогда при следующем входе в канал
    // createPeerConnection разошлёт его дорожки новым пирам («призрачная» демонстрация).
    if (screenStreamRef.current) {
      try { screenStreamRef.current.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
      screenStreamRef.current = null;
      screenSendersRef.current.clear();
      socketRef.current?.emit("screen-share-stopped", { channelId: channelIdRef.current });
    }
    // FIX-CAM: камера не должна оставаться захваченной после выхода из канала.
    if (cameraStreamRef.current) {
      try { cameraStreamRef.current.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
      cameraStreamRef.current = null;
      cameraSendersRef.current.clear();
      socketRef.current?.emit("camera-stopped", { channelId: channelIdRef.current });
    }
    setIsCameraOn(false);
    setLocalCameraStream(null);
    remoteCameraRef.current.clear();
    cameraStreamIdsRef.current.clear();
    syncRemoteCameras();
    playSound(disconnectionSfxRef);

    const leavingSocket = socketRef.current;
    if (leavingSocket?.connected && disconnectedChannelId) {
      // Wait until the server has removed this participant before closing the
      // transport. Fire-and-forget raced disconnect() and left stale presence.
      let closed = false;
      const closeSocket = () => {
        if (closed) return;
        closed = true;
        leavingSocket.disconnect();
      };
      leavingSocket.timeout(1200).emit(
        "leave-voice",
        { channelId: disconnectedChannelId },
        () => closeSocket(),
      );
      window.setTimeout(closeSocket, 1300);
    } else {
      leavingSocket?.disconnect();
    }
    socketRef.current = null;

    rawStreamRef.current?.getTracks().forEach(t => t.stop());
    rawStreamRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    noiseSuppRef.current?.destroy();
    noiseSuppRef.current = null;
    setNsStatus("idle");

    // EQ: узлы эквалайзера и монитора снимаются до закрытия контекста
    // воспроизведения — иначе монитор пережил бы выход из канала.
    teardownEqChain();

    peersRef.current.forEach((_, id) => cleanupPeer(id));
    peersRef.current.clear();
    iceCandidateBufferRef.current.clear(); // FIX-R8

    // Tear down the Web Audio playback graph.
    try { masterGainRef.current?.disconnect(); } catch { /* ignore */ }
    userGainRef.current.clear();
    userSourceRef.current.clear();
    micStreamIdRef.current.clear();
    screenAudiosRef.current.forEach(a => { a.pause(); a.srcObject = null; });
    screenAudiosRef.current.clear();
    playbackCtxRef.current?.close().catch(() => {});
    playbackCtxRef.current = null;
    masterGainRef.current = null;

    if (speakingIntervalRef.current) { clearInterval(speakingIntervalRef.current); speakingIntervalRef.current = null; }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;

    setIsConnected(false);
    setVoiceStatus("idle");
    setUsers([]);
    setSpeakingUsers(new Set());
    setLocalSpeaking(false);
    setIsMuted(false);
    setPttActive(false);
    pttKeyDownRef.current = false;
    setIsDeafened(false);
    isDeafenedRef.current = false;
    setIsSharingScreen(false);
    setScreenSharerId(null);
    setScreenShareName("");
    setScreenVideo(null);
    setLocalScreenStream(null);
    remoteScreenRef.current.clear();
    setRemoteScreens(new Map());
    setRemoteScreenQualities(new Map());
    /* Сбрасываем только привязку к socketId; запомненные значения по userId остаются. */
    userVolumesRef.current.clear();
    setUserVolumes(new Map());
    // Keep the channel selected for one short paint so the user sees the final
    // "Отключение" stage. A new join changes channelIdRef and safely cancels
    // this delayed visual reset; all media/network resources are already gone.
    window.setTimeout(() => {
      if (channelIdRef.current !== disconnectedChannelId || socketRef.current) return;
      channelIdRef.current = null;
      setChannelId(null);
      setChannelName(null);
      setConnectionStage("idle");
    }, 220);
  }, [cleanupPeer, playSound, setScreenVideo, teardownEqChain]);

  // Mirror the latest leaveVoice into a ref so the unmount-only cleanup effect
  // can call it without capturing a stale closure from the first render.
  const leaveVoiceRef = useRef(leaveVoice);
  useEffect(() => { leaveVoiceRef.current = leaveVoice; }, [leaveVoice]);

  // FIX-V3: проверка «кнопка активна, а демонстрации нет». Раз в 2 секунды сверяем
  // состояние кнопки с реальным стримом: если видеодорожка уже не live или стрима
  // нет вовсе — сбрасываем состояние и уведомляем канал, чтобы кнопка не «висела» активной.
  useEffect(() => {
    if (!isSharingScreen) return;
    const check = setInterval(() => {
      const s = screenStreamRef.current;
      const live = !!s && s.getVideoTracks().some(t => t.readyState === "live");
      if (live) return;
      if (s) { try { s.getTracks().forEach(t => t.stop()); } catch { /* ignore */ } }
      screenStreamRef.current = null;
      screenSendersRef.current.clear();
      socketRef.current?.emit("screen-share-stopped", { channelId: channelIdRef.current });
      setIsSharingScreen(false);
      setLocalScreenStream(null);
      setScreenVideo(null);
    }, 2000);
    return () => clearInterval(check);
  }, [isSharingScreen, setScreenVideo]);

  /* ── Join voice ── */
  const joinVoice = useCallback(async (chId: string, chName: string) => {
    if (!session?.user) return;

    // Guard against double-click: if already connecting/connected to this channel, skip
    if (channelIdRef.current === chId && (isConnected || socketRef.current)) return;

    // Switching must also cancel a session that is still connecting. Checking
    // only `isConnected` allowed the old async join to finish later and left
    // stale presence in the previous channel.
    if (channelIdRef.current && channelIdRef.current !== chId) {
      leaveVoice("переход в другой голосовой канал");
      await new Promise(r => setTimeout(r, 50));
    }
    const joinAttempt = ++joinAttemptRef.current;

    // FIX-V2: страховка от «призрачной» демонстрации: если от прошлой сессии остался
    // захваченный экран — глушим его до подключения. Демонстрация начинается
    // только явным нажатием кнопки уже внутри канала.
    if (screenStreamRef.current) {
      try { screenStreamRef.current.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
      screenStreamRef.current = null;
      screenSendersRef.current.clear();
    }
    setIsSharingScreen(false);
    setLocalScreenStream(null);

    setError(null);
    setVoiceStatus("connecting");
    setConnectionStage("microphone");
    channelIdRef.current = chId;
    setChannelId(chId);
    setChannelName(chName);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Голосовой канал требует защищённого соединения (HTTPS).");
      setVoiceStatus("error");
      setConnectionStage("error");
      return;
    }

    let rawStream: MediaStream | null = null;

    try {
      // FIX-AUDIO-DEV: honour the user's chosen microphone (falls back to the
      // system default if that device is gone). RNNoise still receives an
      // unprocessed mono signal; native denoising is reserved for the fallback.
      const micId = micDeviceIdRef.current;
      try {
        rawStream = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId, true));
      } catch {
        // Fallback for mics that reject the exact channel/sample-rate above.
        try {
          rawStream = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId, false));
        } catch (e) {
          // A stale saved device (unplugged headset) must not block joining —
          // retry once on the system default before giving up.
          if (micId) rawStream = await navigator.mediaDevices.getUserMedia(buildMicConstraints(null, false));
          else throw e;
        }
      }
      if (joinAttempt !== joinAttemptRef.current) {
        rawStream.getTracks().forEach(t => t.stop());
        return;
      }
      rawStreamRef.current = rawStream;
      // The raw Chromium-processed microphone is immediately usable. RNNoise
      // is attached in the background below and replaces this track without
      // forcing the user to wait before joining.
      localStreamRef.current = rawStream;
      setConnectionStage("optimizing-audio");

      // FIX-AUDIO-DEV: RNNoise wiring now lives in a shared helper so a live
      // microphone switch rebuilds the identical pipeline.
      attachNoiseSuppressor(rawStream, () => joinAttempt !== joinAttemptRef.current);

      setConnectionStage("server");

      // FIX-R1: distinguish the initial connection from auto-reconnect attempts.
      let everConnected = false;
      // FIX-GR2: после авто-реконнекта не проигрываем себе звук подключения —
      // пользователь никуда не выходил, соединение просто восстановилось.
      let lastConnectWasReconnect = false;

      const socket = io({
        path: "/api/socketio",
        transports: ["websocket", "polling"],
        timeout: 10000,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        // Register every acknowledgement/signalling handler first. On a fast
        // local server auto-connect could otherwise emit before the handlers
        // below exist, leaving the UI stuck at the wrong stage.
        autoConnect: false,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        // FIX-R2: both the initial connection and reconnects are handled here.
        // Previously a reconnect emitted join-voice twice (from here and from
        // the "reconnect" handler), duplicating members and join sounds.
        const isReconnect = everConnected;
        everConnected = true;
        lastConnectWasReconnect = isReconnect;
        if (isReconnect) {
          // A reconnect hands us a brand-new socket.id, so every previous peer
          // is dead. Tear them down; fresh ones are negotiated after re-join.
          peersRef.current.forEach((_, id) => cleanupPeer(id));
          setUsers([]);
          setSpeakingUsers(new Set());
        }
        const userName = session.user.name || "Пользователь";
        setConnectionStage("channel");
        socket.emit("join-voice", { channelId: chId, userId: session.user.id, userName });
        // FIX-R7: re-announce a still-live screen share after a reconnect,
        // otherwise other members never learn about it.
        if (isReconnect && screenStreamRef.current?.getVideoTracks().some(t => t.readyState === "live")) {
          socket.emit("screen-share-started", { channelId: chId, quality: screenShareQualityRef.current });
        }
        // FIX-CAM: после реконнекта заново анонсируем живую камеру.
        if (isReconnect && cameraStreamRef.current?.getVideoTracks().some(t => t.readyState === "live")) {
          socket.emit("camera-started", { channelId: chId, streamId: cameraStreamRef.current.id });
        }
      });

      // Unlike socket "connect", this acknowledgement means the permission
      // check passed and the server has actually inserted us into the room.
      socket.on("voice-joined", ({ userCount }: { channelId: string; userCount: number }) => {
        const userName = session.user.name || "Пользователь";
        setIsConnected(true);
        setVoiceStatus("connected");
        setConnectionStage(userCount > 1 ? "media" : "connected");
        // FIX-GR2: звук — только при первом входе, не при восстановлении связи.
        if (!lastConnectWasReconnect) playSound(connectionSfxRef);

        if (pttEnabledRef.current) {
          rawStream?.getAudioTracks().forEach(t => { t.enabled = false; });
          localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
          setIsMuted(true);
          socket.emit("toggle-mute", { channelId: chId, muted: true });
        }

        const self: VoiceUser = { socketId: socket.id!, userId: session.user.id, userName, muted: pttEnabledRef.current };
        setUsers(prev => [...prev.filter(u => u.socketId !== socket.id), self]);
        if (userCount > 1) {
          window.setTimeout(() => setConnectionStage(prev => prev === "media" ? "connected" : prev), 2500);
        }
      });

      socket.on("disconnect", (reason) => {
        console.warn("[Voice] Socket disconnected:", reason);
        if (reason === "io server disconnect" || reason === "io client disconnect") {
          // Intentional disconnect
          return;
        }
        // Unexpected disconnect — show reconnecting
        setVoiceStatus("reconnecting");
        setConnectionStage("reconnecting");
      });

      socket.io.on("reconnect", () => {
        // FIX-R2: peer teardown and re-join are handled by the "connect"
        // handler (it also fires on reconnect) — only update the status here.
        setVoiceStatus("connected");
      });

      socket.io.on("reconnect_failed", () => {
        console.error("[Voice] Reconnect failed");
        // FIX-R1: all attempts exhausted — fully tear the session down
        // (mic, peers, audio graphs). Previously the mic stayed captured.
        leaveVoice("исчерпаны попытки переподключения к серверу");
        setVoiceStatus("error");
        setError("Потеряно соединение с сервером. Переподключитесь.");
      });

      // The same account joined this channel from another session; the server
      // keeps only the newest one, so tear this (older) session down.
      socket.on("voice-session-replaced", () => {
        leaveVoice("та же учётная запись вошла в канал из другой вкладки или устройства");
        setError("Вы подключились к этому каналу из другой сессии.");
      });

      // The server refused the join: this user is not a member of the channel's
      // group. Without handling it the UI would sit in "connecting" forever.
      socket.on("voice-join-denied", () => {
        leaveVoice("сервер отказал в доступе к каналу");
        setError("Нет доступа к этому голосовому каналу.");
      });

      // FIX-R9: auto-leave when the channel is deleted. Registered on the
      // current socket at every (re)connection — the old standalone effect
      // could bind to an already-dead socket and miss the event.
      const onChannelDeleted = ({ channelId: deletedId }: { channelId: string }) => {
        if (channelIdRef.current === deletedId) leaveVoiceRef.current?.("канал удалён");
      };
      socket.on("channel-deleted", onChannelDeleted);
      socket.on("voice-channel-deleted", onChannelDeleted);

      socket.on("voice-users", (existing: VoiceUser[]) => {
        if (existing.length > 0) setConnectionStage("media");
        // Merge existing users with self
        setUsers(prev => {
          const selfUser = prev.find(u => u.socketId === socket.id);
          const merged = selfUser ? [...existing.filter(u => u.socketId !== socket.id), selfUser] : existing;
          return merged;
        });
        existing.forEach(u => createPeerConnection(u.socketId, true));
      });

      socket.on("user-joined", (user: VoiceUser & { reconnected?: boolean }) => {
        setUsers(p => [...p.filter(u => u.socketId !== user.socketId), user]);
        createPeerConnection(user.socketId, false);
        /* Дорожки показа и камеры добавлены в соединение выше, но офферим здесь
           не мы — без своего оффера они никуда не уедут. */
        if (screenStreamRef.current || cameraStreamRef.current) {
          renegotiateOutbound(user.socketId);
        }
        /* Повторного «screen-share-started» здесь больше нет.

           Раньше ведущий заново объявлял показ на каждого входящего — и делал
           это БЕЗ списка допущенных. Сервер на таком объявлении перезаписывал
           состояние показа с allow = null: приватная трансляция становилась
           публичной, о ней узнавал весь канал, а последующая правка состава
           сравнивалась с пустым списком. Картинка при этом не утекала (её
           отправку гейтит isScreenAllowedFor), но сам факт закрытого показа —
           утекал, причём от любого входящего.

           Теперь о идущих показах вошедшему рассказывает сервер: у него есть и
           качество, и список допущенных (server.ts, обработчик join-voice). */
        // FIX-CAM: камеру сервер не отслеживает — id её стрима объявляем сами.
        if (cameraStreamRef.current?.getVideoTracks().some(track => track.readyState === "live")) {
          socket.emit("camera-started", { channelId: chId, streamId: cameraStreamRef.current.id });
        }
        // FIX-GR1: reconnected = тихое возвращение после обрыва — без звука.
        if (!user.reconnected) playSound(connectionSfxRef);
      });

      // FIX-GR2: человек пропал из-за обрыва и не вернулся за grace-окно —
      // сервер шлёт отложенный звук отключения (присутствие было снято сразу,
      // тихим user-left, чтобы не было «иллюзии присутствия»).
      /* FIX-USER-DND: модератор перенёс нас в другой голосовой канал. */
      socket.on("voice:force-join", ({ channelId: targetId, channelName: targetName }: { channelId: string; channelName: string }) => {
        if (targetId === chId) return; // уже здесь
        void joinVoiceRef.current(targetId, targetName);
      });

      socket.on("voice-user-dropped", () => {
        playSound(disconnectionSfxRef);
      });

      socket.on("user-left", ({ socketId, silent }: { socketId: string; silent?: boolean }) => {
        setUsers(p => p.filter(u => u.socketId !== socketId));
        cleanupPeer(socketId);
        setSpeakingUsers(p => { const n = new Set(p); n.delete(socketId); return n; });
        // FIX-GR1: silent = запись заменена при тихом реконнекте — без звука.
        if (!silent) playSound(disconnectionSfxRef);
      });

      socket.on("voice-offer", async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
        let pc = peersRef.current.get(from);
        if (!pc) pc = createPeerConnection(from, false);

        // Perfect negotiation: exactly one side is "polite", chosen
        // deterministically by comparing socket ids. When both peers send an
        // offer at the same time (glare), the polite side rolls back and
        // accepts the remote offer while the impolite side ignores it — so the
        // connection converges instead of getting stuck in an invalid state.
        const polite = (socket.id ?? "") > from;
        const collision = makingOfferRef.current.has(from) || pc.signalingState !== "stable";

        if (collision && !polite) {
          // The impolite side ignores the incoming offer — its own will win.
          return;
        }
        if (collision && pc.signalingState !== "stable") {
          await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
        }
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Flush buffered ICE candidates
        const buffered = iceCandidateBufferRef.current.get(from) ?? [];
        iceCandidateBufferRef.current.delete(from);
        for (const c of buffered) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        const answer = await patchedAnswer(pc);
        socket.emit("voice-answer", { to: from, answer });
      });

      socket.on("voice-answer", async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
        const pc = peersRef.current.get(from);
        // Only apply an answer we're actually waiting for. A late/duplicate
        // answer (e.g. after a glare rollback) would otherwise throw on a
        // connection that's no longer in "have-local-offer".
        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          // Flush buffered ICE candidates
          const buffered = iceCandidateBufferRef.current.get(from) ?? [];
          iceCandidateBufferRef.current.delete(from);
          for (const c of buffered) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
      });

      socket.on("ice-candidate", async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
        const pc = peersRef.current.get(from);
        if (!pc || !pc.remoteDescription) {
          // Buffer both candidates that arrived before the pc existed and those
          // that arrived before the offer/answer set the remote description.
          // They are flushed in the voice-offer / voice-answer handlers.
          const buf = iceCandidateBufferRef.current.get(from) ?? [];
          buf.push(candidate);
          iceCandidateBufferRef.current.set(from, buf);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      });

      socket.on("user-muted", ({ socketId, muted }: { socketId: string; muted: boolean }) =>
        setUsers(p => p.map(u => u.socketId === socketId ? { ...u, muted } : u))
      );
      socket.on("user-speaking", ({ socketId, speaking }: { socketId: string; speaking: boolean }) =>
        setSpeakingUsers(p => {
          // FIX-V2: periodic keepalive re-sends may repeat the same state —
          // return the previous Set to avoid a needless re-render every second.
          if (p.has(socketId) === speaking) return p;
          const n = new Set(p);
          if (speaking) n.add(socketId); else n.delete(socketId);
          return n;
        })
      );

      socket.on("screen-share-started", ({ socketId: id, quality }: { socketId: string; quality?: Partial<ScreenShareQuality> }) => {
        setRemoteScreenQualities(prev => {
          const next = new Map(prev);
          next.set(id, {
            resolution: quality?.resolution === 1080 ? 1080 : 720,
            fps: quality?.fps === 60 ? 60 : 30,
          });
          return next;
        });
        setScreenSharerId(id);
        const stream = remoteScreenRef.current.get(id);
        if (stream) setScreenVideo(stream);
        syncRemoteScreens();
        // FIX-SFX: звук старта демонстрации у ЗРИТЕЛЕЙ убран — звуки действий
        // играют только у пользователя, который нажал кнопку (см. startScreenShare).
      });
      // SCREEN-VIEWERS: актуальный состав зрителей приходит от сервера.
      socket.on("screen-viewers", ({ ownerSocketId, viewers }: { ownerSocketId: string; viewers: { userId: string; userName: string }[] }) => {
        setScreenViewers(prev => {
          const next = new Map(prev);
          if (!viewers?.length) next.delete(ownerSocketId);
          else next.set(ownerSocketId, viewers);
          return next;
        });
      });

      socket.on("screen-share-stopped", ({ socketId: id }: { socketId: string }) => {
        remoteScreenRef.current.delete(id);
        // SCREEN-VIEWERS: трансляции больше нет — её счётчик зрителей не нужен.
        setScreenViewers(prev => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        if (viewingScreenRef.current === id) viewingScreenRef.current = null;
        setRemoteScreenQualities(prev => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        syncRemoteScreens();
        setScreenSharerId(p => p === id ? null : p);
        setScreenShareName("");
        setScreenVideo(null);
      });

      // FIX-CAM: участник включил камеру. Запоминаем id его стрима; если видео
      // успело приехать раньше события и было ошибочно принято за демонстрацию
      // экрана — перекладываем его в камеры и откатываем состояние демонстрации.
      socket.on("camera-started", ({ socketId: id, streamId }: { socketId: string; streamId?: string }) => {
        if (!streamId) return;
        cameraStreamIdsRef.current.set(id, streamId);
        const misplaced = remoteScreenRef.current.get(id);
        if (misplaced && misplaced.id === streamId) {
          remoteScreenRef.current.delete(id);
          setRemoteScreenQualities(prev => {
            if (!prev.has(id)) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
          syncRemoteScreens();
          setScreenSharerId(p => p === id ? null : p);
          setScreenVideo(null);
          remoteCameraRef.current.set(id, misplaced);
          syncRemoteCameras();
        }
      });
      socket.on("camera-stopped", ({ socketId: id }: { socketId: string }) => {
        cameraStreamIdsRef.current.delete(id);
        if (remoteCameraRef.current.has(id)) {
          remoteCameraRef.current.delete(id);
          syncRemoteCameras();
        }
      });

      socket.on("voice-channel-users", ({ channelId: cId, users: cUsers }: { channelId: string; users: VoiceUser[] }) => {
        setChannelUsersMap(prev => { const m = new Map(prev); m.set(cId, cUsers); return m; });
      });

      socket.on("connect_error", (err) => {
        console.error("[Voice] Connection error:", err.message);
        // FIX-R1: during auto-reconnect this fires on EVERY failed attempt.
        // Do not tear the session down — wait for reconnect/reconnect_failed.
        if (everConnected) {
          setVoiceStatus("reconnecting");
          return;
        }
        // Initial connection failed — full cleanup (FIX-R6): the speaking
        // detector, stream refs and the selected channel used to leak here.
        rawStream?.getTracks().forEach(t => t.stop());
        rawStreamRef.current = null;
        localStreamRef.current = null;
        // FIX-AUDIO-DEV: the suppressor is now owned by attachNoiseSuppressor via
        // noiseSuppRef, so tear it down through the ref instead of a local var.
        noiseSuppRef.current?.destroy();
        noiseSuppRef.current = null;
        setNsStatus("idle");
        teardownEqChain(); // EQ: цепочка могла успеть собраться до отказа сервера
        if (speakingIntervalRef.current) { clearInterval(speakingIntervalRef.current); speakingIntervalRef.current = null; }
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        analyserRef.current = null;
        socketRef.current?.disconnect();
        socketRef.current = null;
        setVoiceStatus("error");
        setConnectionStage("error");
        setError("Не удалось подключиться к серверу.");
        setIsConnected(false);
        setChannelId(null);
        setChannelName(null);
      });

      socket.connect();
      startSpeakingDetection();
    } catch (err) {
      rawStream?.getTracks().forEach(t => t.stop());
      rawStreamRef.current = null;
      localStreamRef.current = null;
      noiseSuppRef.current?.destroy();
      noiseSuppRef.current = null;
      setNsStatus("idle");
      teardownEqChain(); // EQ: не оставляем узлы после неудавшегося входа
      // FIX-R5: stop the speaking detector and do not leave the channel
      // looking "selected" after a failed join.
      if (speakingIntervalRef.current) { clearInterval(speakingIntervalRef.current); speakingIntervalRef.current = null; }
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
      setChannelId(null);
      setChannelName(null);
      setVoiceStatus("error");
      setConnectionStage("error");

      if (err instanceof DOMException) {
        const msgs: Record<string, string> = {
          NotAllowedError:       "Доступ к микрофону запрещён. Разрешите в настройках браузера.",
          PermissionDeniedError: "Доступ к микрофону запрещён.",
          NotFoundError:         "Микрофон не найден.",
          NotReadableError:      "Микрофон занят другим приложением.",
        };
        setError(msgs[err.name] ?? `Ошибка микрофона: ${(err as DOMException).message}`);
      } else {
        setError("Не удалось подключиться. Попробуйте обновить страницу.");
      }
    }
  }, [session, isConnected, leaveVoice, createPeerConnection, renegotiateOutbound, cleanupPeer, startSpeakingDetection, attachNoiseSuppressor, teardownEqChain, playSound, setScreenVideo, syncRemoteScreens]);

  /* FIX-FORCE-JOIN: joinVoice вызывается из сокет-обработчика, который находится внутри тела joinVoice.
     Мутация ref.current преднамеренно запрещена React Compiler — отключаем правило локально. */
  const joinVoiceRef = useRef(joinVoice);
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { joinVoiceRef.current = joinVoice; }, [joinVoice]);

  /* ── Mute / Deafen ── */
  // Force the microphone into a concrete muted/unmuted state and notify peers.
  // Shared by the mute button, push-to-talk, and desktop global hotkeys.
  const setMuted = useCallback((muted: boolean) => {
    if (!rawStreamRef.current) return;
    rawStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !muted; });
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !muted; });
    setIsMuted(muted);
    socketRef.current?.emit("toggle-mute", { channelId: channelIdRef.current, muted });
  }, []);

  // FIX-SFX: подавление звука микрофона, когда toggleMute вызывается ИЗНУТРИ
  // toggleDeafen (иначе при (раз)глушении наушников играли бы два звука разом).
  const suppressMicSfxRef = useRef(false);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    setMuted(next);
    // FIX-SFX: локальный звук только для нажавшего. Push-to-talk сюда не
    // попадает (он работает через setMuted напрямую), поэтому удержание PTT
    // не «пикает» на каждое нажатие.
    if (!suppressMicSfxRef.current) playUiSound(next ? "micOff" : "micOn");
  }, [setMuted]);

  // Momentary "transmit" pulse for the desktop global push-to-talk hotkey.
  // `globalShortcut` can only observe key *presses* (not releases), so we open
  // the mic and re-mute shortly after; a held key that auto-repeats keeps
  // resetting the timer, approximating hold-to-talk.
  const pushToTalkPulse = useCallback(() => {
    setMuted(false);
    if (pttPulseTimerRef.current) clearTimeout(pttPulseTimerRef.current);
    pttPulseTimerRef.current = setTimeout(() => setMuted(true), 400);
  }, [setMuted]);

  const toggleDeafen = useCallback(() => {
    const next = !isDeafened;
    setIsDeafened(next);
    isDeafenedRef.current = next;
    // Voice is played through the master gain node — muting it here silences
    // everyone at once without disturbing each listener's per-user volume.
    if (masterGainRef.current) masterGainRef.current.gain.value = next ? 0 : 1;
    // Any voice element that fell back to plain playback (no Web Audio) and all
    // screen-share audio elements are muted directly.
    remoteAudiosRef.current.forEach((a, id) => { if (!userGainRef.current.has(id)) a.muted = next; });
    screenAudiosRef.current.forEach(a => { a.muted = next; });
    suppressMicSfxRef.current = true; // FIX-SFX: не дублировать звук микрофона
    try {
      if (next) {
        // FIX-R10: remember the mic state so un-deafen can restore it.
        wasMutedBeforeDeafenRef.current = isMuted;
        if (!isMuted) toggleMute();
      } else if (!wasMutedBeforeDeafenRef.current && isMuted) {
        // FIX-R10: un-deafen restores the mic if it was live before deafen.
        toggleMute();
      }
    } finally {
      suppressMicSfxRef.current = false;
    }
    // FIX-SFX: локальный звук (наушники) — только для нажавшего.
    playUiSound(next ? "deafenOn" : "deafenOff");
  }, [isDeafened, isMuted, toggleMute]);

  /* ── Per-user volume ── */
  // Personal, listener-side volume for a remote participant, 0–200%. 0 fully
  // mutes them for this listener only; 100 is normal; up to 200 boosts them
  // (only achievable via the Web Audio gain node — an <audio> element caps at
  // 100%).
  const setUserVolume = useCallback((socketId: string, volume: number) => {
    const clamped = Math.max(0, Math.min(200, volume));
    userVolumesRef.current.set(socketId, clamped);
    /* VOICE-VOLKEEP: запоминаем за человеком, а не за его текущим соединением. */
    const userId = usersRef.current.find(u => u.socketId === socketId)?.userId;
    if (userId) {
      savedVolumesRef.current.set(userId, clamped);
      writeSavedUserVolumes(savedVolumesRef.current);
    }
    setUserVolumes(prev => { const m = new Map(prev); m.set(socketId, clamped); return m; });
    const gain = userGainRef.current.get(socketId);
    if (gain) {
      gain.gain.value = clamped / 100;
    } else {
      // Fallback path (no Web Audio): element volume can only go up to 100%.
      const audio = remoteAudiosRef.current.get(socketId);
      if (audio) audio.volume = Math.min(1, clamped / 100);
    }
  }, []);

  /* ── Query channel users (before joining) ── */
  const queryChannelUsers = useCallback((chId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("get-voice-channel-users", { channelId: chId });
    }
  }, []);

  /* ── Connection quality stats polling ── */
  useEffect(() => {
    if (!isConnected) {
      if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null; }
      setConnectionQuality(prev => (prev.size === 0 ? prev : new Map()));
      setLocalPing(null);
      setScreenShareStats(null);
      return;
    }

    const pollStats = async () => {
      const qualityMap = new Map<string, ConnectionQuality>();
      let videoFramesSent = 0;
      let videoFramesDropped = 0;

      for (const [socketId, pc] of peersRef.current.entries()) {
        if (pc.connectionState !== "connected") {
          qualityMap.set(socketId, "unknown");
          continue;
        }
        try {
          const stats = await pc.getStats();
          let rtt: number | null = null;
          let packetsLost = 0;
          let packetsReceived = 0;

          stats.forEach(report => {
            if (report.type === "candidate-pair" && report.state === "succeeded") {
              rtt = report.currentRoundTripTime != null ? report.currentRoundTripTime * 1000 : null;
            }
            if (report.type === "inbound-rtp" && report.kind === "audio") {
              packetsLost = report.packetsLost ?? 0;
              packetsReceived = report.packetsReceived ?? 0;
            }
            // Only the sender sees these outgoing video metrics. Browsers use
            // slightly different names, so combine the standard counters with
            // encoder-drop counters when available.
            if (screenStreamRef.current && report.type === "outbound-rtp" && report.kind === "video") {
              const sent = Number(report.framesSent ?? report.framesEncoded ?? 0);
              const encoded = Number(report.framesEncoded ?? sent);
              const dropped = Number(report.framesDropped ?? report.framesDroppedByEncoder ?? Math.max(0, encoded - sent));
              videoFramesSent += Number.isFinite(sent) ? sent : 0;
              videoFramesDropped += Number.isFinite(dropped) ? dropped : 0;
            }
          });

          const lossRate = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;

          let quality: ConnectionQuality = "good";
          if (rtt === null) quality = "unknown";
          else if (rtt > 400 || lossRate > 0.1) quality = "poor";
          else if (rtt > 150 || lossRate > 0.03) quality = "medium";

          qualityMap.set(socketId, quality);
        } catch {
          qualityMap.set(socketId, "unknown");
        }
      }

      // FIX-PERF: не вызываем setState после размонтирования компонента —
      // опрос асинхронный, компонент мог исчезнуть пока ждали getStats().
      if (!isMountedRef.current) return;
      /* Опрос идёт каждые 3 секунды и раньше всегда клал в состояние НОВУЮ
         карту — даже когда качество у всех прежнее. Значение контекста от
         этого пересобиралось, и весь экран «Связи» (включая ленту сообщений)
         перерисовывался каждые три секунды всё время, пока человек в голосовом
         канале. Обновляем только при настоящем изменении. */
      setConnectionQuality(prev => {
        if (prev.size === qualityMap.size) {
          let same = true;
          for (const [key, value] of qualityMap) {
            if (prev.get(key) !== value) { same = false; break; }
          }
          if (same) return prev;
        }
        return qualityMap;
      });
      // `localPing` is this user's own client → server → client RTT. WebRTC
      // candidate-pair RTT belongs to a particular remote participant and the
      // previous minimum-of-peers value looked like a shared/room ping.
      const sock = socketRef.current;
      if (sock?.connected) {
        const t0 = performance.now();
        let expired = false;
        const timer = setTimeout(() => { expired = true; }, 2000);
        sock.emit("voice-ping", () => {
          if (expired) return;
          clearTimeout(timer);
          // FIX-PERF: повторная проверка — обратный вызов сокета тоже асинхронный.
          if (!isMountedRef.current) return;
          const ping = Math.round(performance.now() - t0);
          /* Пинг всё время немного пляшет, а показывается округлённым числом.
             Обновляем, только когда разница заметна глазу: иначе каждые три
             секунды перерисовывался бы весь экран ради «43 вместо 41». */
          setLocalPing(prev => (prev !== null && Math.abs(prev - ping) < 5 ? prev : ping));
        });
      }
      if (screenStreamRef.current) {
        const total = videoFramesSent + videoFramesDropped;
        const droppedFrames = Math.max(0, Math.round(videoFramesDropped));
        const lossPercent = total > 0 ? Math.min(100, Math.round((videoFramesDropped / total) * 1000) / 10) : 0;
        // Новый объект каждые три секунды — это перерисовка на ровном месте,
        // даже когда числа те же самые.
        setScreenShareStats(prev =>
          prev && prev.droppedFrames === droppedFrames && prev.lossPercent === lossPercent
            ? prev
            : { droppedFrames, lossPercent },
        );
      } else {
        setScreenShareStats(null);
      }
    };

    pollStats();
    statsIntervalRef.current = setInterval(pollStats, 3000);
    return () => { if (statsIntervalRef.current) clearInterval(statsIntervalRef.current); };
  }, [isConnected]);

  // FIX-R9: the auto-disconnect handler for deleted channels moved into
  // joinVoice, where it is registered on the live socket at every connection.

  /* ── Desktop global hotkeys (Electron shell only) ── */
  // The desktop shell registers system-wide accelerators for "toggle mute" and
  // "push-to-talk" and forwards them over IPC. In a plain browser
  // `getDesktopApi()` is null and this effect is a no-op.
  useEffect(() => {
    const api = getDesktopApi();
    if (!api) return;
    const offToggleMute = api.onToggleMute(() => {
      if (!isConnectedRef.current) return;
      setMuted(!isMutedRef.current);
    });
    const offPushToTalk = api.onPushToTalk(() => {
      if (!isConnectedRef.current) return;
      pushToTalkPulse();
    });
    // FIX-REPLAY: глобальный бинд «сохранить повтор» из десктоп-оболочки
    // (работает, даже когда окно свёрнуто). Нет в старых сборках — опционально.
    const offSaveReplay = api.onSaveReplay?.(() => {
      if (!isConnectedRef.current || !replayEnabledRef.current) return;
      void saveReplayRef.current?.();
    });
    return () => { offToggleMute(); offPushToTalk(); offSaveReplay?.(); };
  }, [setMuted, pushToTalkPulse]);

  /* ── FIX-REPLAY: мгновенный повтор (Premium) ──
   * Кольцевой буфер последних ~30 секунд: свой микрофон, голоса собеседников и
   * звук/видео активной трансляции. Всё пишется MediaRecorder'ом и хранится
   * только на устройстве пользователя; сервер и сеть не участвуют вообще,
   * поэтому дополнительная нагрузка на сервер — нулевая. */
  const setReplayEnabled = useCallback((v: boolean) => {
    setReplayEnabledState(v);
    localStorage.setItem("voice-replay-enabled", v ? "1" : "0");
  }, []);

  const setReplayKeys = useCallback((keys: string[]) => {
    setReplayKeysState(keys);
    localStorage.setItem("voice-replay-keys", JSON.stringify(keys));
  }, []);

  const setReplaySeconds = useCallback((seconds: number) => {
    const clamped = Math.min(REPLAY_MAX_SECONDS, Math.max(REPLAY_MIN_SECONDS, Math.round(seconds)));
    setReplaySecondsState(clamped);
    if (typeof window !== "undefined") localStorage.setItem("voice-replay-seconds", String(clamped));
  }, []);

  useEffect(() => { replayEnabledRef.current = replayEnabled; }, [replayEnabled]);
  useEffect(() => { replayKeysRef.current = replayKeys; }, [replayKeys]);

  /* EQ: монитор гасим при любом выходе из канала, а не только по кнопке
     «Выйти»: сюда же попадают обрыв связи и неудавшийся вход. Иначе тумблер
     остался бы включённым, и следующий вход начался бы с эха в наушники. */
  useEffect(() => {
    if (!isConnected) setMonitorEnabled(false);
  }, [isConnected, setMonitorEnabled]);

  // Премиум-флаг отдельным примитивом: объект session меняет идентичность при
  // рефетче, а перезапуск буфера (с потерей накопленных секунд) должен
  // происходить только при смысловых изменениях.
  const replayPremium = hasPremium(session?.user);

  useEffect(() => {
    // Полный демонтаж буфера и аудио-ветвей повтора.
    const teardown = () => {
      replayRecorderRef.current?.stop();
      replayRecorderRef.current = null;
      try { replayMicSourceRef.current?.disconnect(); } catch { /* ignore */ }
      replayMicSourceRef.current = null;
      try { replayLocalScreenSourceRef.current?.disconnect(); } catch { /* ignore */ }
      replayLocalScreenSourceRef.current = null;
      replayScreenSrcRef.current.forEach(s => { try { s.disconnect(); } catch { /* ignore */ } });
      replayScreenSrcRef.current.clear();
      replayDestRef.current = null;
      setReplayReady(false);
    };

    if (!isConnected || !replayEnabled || !replayPremium || !ReplayRecorder.isSupported()) {
      teardown();
      return;
    }
    const graph = ensurePlaybackGraph();
    if (!graph) { teardown(); return; }

    try {
      // Сводная аудиошина повтора: свой микрофон + собеседники + звук трансляций.
      const dest = graph.ctx.createMediaStreamDestination();
      replayDestRef.current = dest;

      // Свой микрофон — только в буфер (не в колонки, иначе будет слышно себя).
      // При mute трек выключен, и в записи корректно остаётся тишина.
      if (localStreamRef.current?.getAudioTracks().length) {
        const mic = graph.ctx.createMediaStreamSource(localStreamRef.current);
        mic.connect(dest);
        replayMicSourceRef.current = mic;
      }

      // Голоса, подключившиеся до старта буфера (после перс. громкости).
      userGainRef.current.forEach(g => { try { g.connect(dest); } catch { /* ignore */ } });

      // Звук уже играющих чужих трансляций.
      screenAudiosRef.current.forEach((audio, sid) => {
        const s = audio.srcObject as MediaStream | null;
        if (!s || !s.getAudioTracks().length) return;
        try {
          const src = graph.ctx.createMediaStreamSource(s);
          src.connect(dest);
          replayScreenSrcRef.current.set(sid, src);
        } catch { /* ignore */ }
      });

      // Звук собственной трансляции (свои колонки его не играют, а в записи он нужен).
      if (screenStreamRef.current?.getAudioTracks().length) {
        try {
          const src = graph.ctx.createMediaStreamSource(screenStreamRef.current);
          src.connect(dest);
          replayLocalScreenSourceRef.current = src;
        } catch { /* ignore */ }
      }

      // Видео активной трансляции: приоритет своей, затем первая чужая.
      const videoStream = isSharingScreen && localScreenStream
        ? localScreenStream
        : (remoteScreens.values().next().value ?? null);
      const tracks: MediaStreamTrack[] = [...dest.stream.getAudioTracks()];
      const videoTrack = videoStream?.getVideoTracks()[0];
      if (videoTrack) tracks.push(videoTrack);

      const rec = new ReplayRecorder(new MediaStream(tracks), replaySecondsRef.current * 1000);
      rec.start();
      replayRecorderRef.current = rec;
      setReplayReady(true);
    } catch {
      teardown();
    }
    return teardown;
    // nsStatus в зависимостях: после подмены сырого микрофона обработанным
    // (RNNoise) нужно перецепить источник на актуальный localStreamRef.
  }, [isConnected, replayEnabled, replayPremium, isSharingScreen, localScreenStream, remoteScreens, nsStatus, ensurePlaybackGraph]);

  /* FIX-REPLAY: сохранить последние ~30 секунд в файл. На десктопе файл пишется
     в настроенную папку через оболочку; в браузере — обычная загрузка файла. */
  const saveReplay = useCallback(async (): Promise<boolean> => {
    const rec = replayRecorderRef.current;
    if (!rec || !isPremiumRef.current) return false;
    const blob = await rec.save();
    if (!blob || !blob.size) return false;
    const ext = "webm";
    const api = getDesktopApi();
    if (api?.saveReplayFile) {
      try {
        const buf = await blob.arrayBuffer();
        const savedPath = await api.saveReplayFile(buf, ext);
        return savedPath != null;
      } catch {
        return false;
      }
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `trioz-replay-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch {
      return false;
    }
  }, []);
  useEffect(() => { saveReplayRef.current = saveReplay; }, [saveReplay]);

  /* FIX-REPLAY: браузерный бинд «сохранить повтор» (пока окно в фокусе). */
  useEffect(() => {
    if (!isConnected || !replayEnabled || !replayPremium) return;
    const handler = (e: KeyboardEvent) => {
      const bind = replayKeysRef.current;
      if (!bind.length) return;
      // Тот же формат комбинации, что у рации: модификаторы + основная клавиша.
      const active: string[] = [];
      if (e.ctrlKey) active.push("Control");
      if (e.altKey) active.push("Alt");
      if (e.shiftKey) active.push("Shift");
      if (e.metaKey) active.push("Meta");
      const nk = e.key.toLowerCase();
      if (nk !== "control" && nk !== "alt" && nk !== "shift" && nk !== "meta") {
        active.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      }
      const norm = (arr: string[]) => arr.map(k => k.toLowerCase()).sort();
      const bindSorted = norm(bind);
      const activeSorted = norm(active);
      if (bindSorted.length !== activeSorted.length) return;
      if (!bindSorted.every((k, i) => k === activeSorted[i])) return;
      // Не срабатывать, пока пользователь печатает в поле ввода.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      void saveReplayRef.current?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isConnected, replayEnabled, replayPremium]);

  /* ── Cleanup on unmount ── */
  // Reads through refs, not the captured `isConnected`/`leaveVoice` (which would
  // be frozen at their first-render values), so it actually leaves the channel.
  useEffect(() => () => {
    if (isConnectedRef.current) {
      /* Если эта строка появилась при обычном переходе по разделам — значит
         перезагрузилось всё приложение (жёсткая навигация), и чинить надо
         именно её: сам голос тут ни при чём. */
      leaveVoiceRef.current?.("размонтирован VoiceProvider — перезагрузка страницы или уход с сайта");
    }
    if (pttPulseTimerRef.current) clearTimeout(pttPulseTimerRef.current);
    // FIX-LEAK: гарантируем остановку интервала опроса статистики при размонтировании,
    // даже если эффект [isConnected] не успел отработать cleanup.
    if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null; }
    // FIX-LEAK: гарантируем остановку детектора речи при размонтировании.
    if (speakingIntervalRef.current) { clearInterval(speakingIntervalRef.current); speakingIntervalRef.current = null; }
    // FIX-LEAK: снимаем флаг монтирования — асинхронные setState-вызовы опроса статистики проигнорируются.
    isMountedRef.current = false;
  }, []);

  /* ── Update screen share name when users change ── */
  useEffect(() => {
    if (screenSharerId && !isSharingScreen) {
      const u = users.find(u => u.socketId === screenSharerId);
      setScreenShareName(u?.userName ?? "Участник");
    }
  }, [screenSharerId, users, isSharingScreen]);

  const activeScreenName = isSharingScreen
    ? `${session?.user?.name ?? "Вы"} (Вы)`
    : screenShareName || "Участник";

  // The set of socket ids that are actively sharing a screen (remote sharers
  // plus this client if it is sharing). Participant lists use it to badge each
  // sharer, no matter how many are sharing at once.
  // FIX-PERF: мемоизируем — пересборка только при смене зависимостей, а не на каждый ре-рендер.
  const screenSharerIds = useMemo(() => {
    const ids = new Set<string>(remoteScreens.keys());
    if (isSharingScreen && session?.user?.id) {
      const ownSocketId = users.find(u => u.userId === session.user!.id)?.socketId;
      if (ownSocketId) ids.add(ownSocketId);
    }
    return ids;
  }, [remoteScreens, isSharingScreen, users, session]);

  // Every share currently on screen, own share first, then remotes in join
  // order. This is the single source of truth the share window renders from.
  // FIX-PERF: мемоизируем — пересборка только при смене зависимостей, а не на каждый ре-рендер.
  const screenShares = useMemo<ScreenShare[]>(() => {
    const shares: ScreenShare[] = [];
    if (isSharingScreen && localScreenStream) {
      shares.push({
        socketId: "local",
        userName: `${session?.user?.name ?? "Вы"} (Вы)`,
        stream:   localScreenStream,
        isLocal:  true,
        quality:  screenShareQuality,
      });
    }
    for (const [sid, stream] of remoteScreens) {
      const u = users.find(x => x.socketId === sid);
      shares.push({
        socketId: sid,
        userName: u?.userName ?? "Участник",
        stream,
        isLocal:  false,
        quality:  remoteScreenQualities.get(sid) ?? DEFAULT_SCREEN_QUALITY,
      });
    }
    return shares;
  }, [isSharingScreen, localScreenStream, remoteScreens, remoteScreenQualities, users, session, screenShareQuality]);

  // FIX-CAM: список активных камер — своя первой, затем удалённые в порядке появления.
  // FIX-PERF: мемоизируем — пересборка только при смене зависимостей, а не на каждый ре-рендер.
  const cameraShares = useMemo<CameraShare[]>(() => {
    const shares: CameraShare[] = [];
    if (isCameraOn && localCameraStream) {
      shares.push({
        socketId: "local",
        userName: `${session?.user?.name ?? "Вы"} (Вы)`,
        stream:   localCameraStream,
        isLocal:  true,
      });
    }
    for (const [sid, stream] of remoteCameras) {
      const u = users.find(x => x.socketId === sid);
      shares.push({
        socketId: sid,
        userName: u?.userName ?? "Участник",
        stream,
        isLocal:  false,
      });
    }
    return shares;
  }, [isCameraOn, localCameraStream, remoteCameras, users, session]);

  // FIX-PERF: мемоизируем — пересборка только при смене зависимостей, а не на каждый ре-рендер.
  const cameraUserIds = useMemo(() => {
    const ids = new Set<string>(remoteCameras.keys());
    if (isCameraOn && session?.user?.id) {
      const ownSocketId = users.find(u => u.userId === session.user!.id)?.socketId;
      if (ownSocketId) ids.add(ownSocketId);
    }
    return ids;
  }, [remoteCameras, isCameraOn, users, session]);

  const value: VoiceCtx = {
    isConnected, voiceStatus, connectionStage, channelId, channelName, isMuted, isDeafened,
    users, speakingUsers, localSpeaking, error,
    micGainDb, setMicGain,
    isSharingScreen, screenSharerId, screenSharerIds, screenShareName: activeScreenName,
    screenStream, screenShares,
    isScreenPrivate, screenAllowUserIds, screenViewers, setViewingScreen, // SCREEN-PRIVATE / SCREEN-VIEWERS
    nsEnabled, nsIntensity, nsStatus,
    screenShareQuality, screenAudioEnabled, screenShareStats, isPremium: hasPremium(session?.user),
    userVolumes, channelUsersMap,
    connectionQuality, localPing,
    pttEnabled, pttKeys, pttActive,
    replayEnabled, replayKeys, replaySeconds, replayReady, // FIX-REPLAY
    eqGains, eqPreset, monitorEnabled, monitorVolume, eqActive, // EQ
    joinVoice, leaveVoice, toggleMute, toggleDeafen, toggleNS,
    isCameraOn, cameraShares, cameraUserIds, // FIX-CAM
    cameraDeviceId, cameraDevices, setCameraDevice, refreshCameraDevices, // FIX-CAM-DEV
    micDeviceId, outputDeviceId, inputDevices, outputDevices, // FIX-AUDIO-DEV
    setMicDevice, setOutputDevice, refreshAudioDevices, // FIX-AUDIO-DEV
    startScreenShare, stopScreenShare, updateScreenAllow, toggleCamera, setUserVolume, setNsEnabled, setNsIntensity,
    setScreenShareQuality, setScreenAudioEnabled,
    queryChannelUsers, setPttEnabled, setPttKeys,
    setReplayEnabled, setReplayKeys, setReplaySeconds, saveReplay, // FIX-REPLAY
    setEqBandGain, setEqPreset, setMonitorEnabled, setMonitorVolume, // EQ
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
