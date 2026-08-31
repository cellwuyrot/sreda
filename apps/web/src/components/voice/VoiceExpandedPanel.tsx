"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { useVoice, type ConnectionQuality } from "@/contexts/VoiceContext";
import ScreenSharePrivacyModal from "./ScreenSharePrivacyModal"; // SCREEN-PRIVATE
import { motion, AnimatePresence } from "framer-motion";

function QualityIcon({ quality }: { quality: ConnectionQuality }) {
  const colors: Record<ConnectionQuality, string> = {
    good: "#22c55e",
    medium: "#eab308",
    poor: "#ef4444",
    unknown: "#6b7280",
  };
  const bars = quality === "good" ? 4 : quality === "medium" ? 3 : quality === "poor" ? 1 : 0;
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-label={quality}>
      {[0, 1, 2, 3].map(i => (
        <rect
          key={i}
          x={1 + i * 4}
          y={12 - (i + 1) * 3}
          width={3}
          height={(i + 1) * 3}
          rx={0.5}
          fill={i < bars ? colors[quality] : "#4b5563"}
        />
      ))}
    </svg>
  );
}

/* ── Uniform round control button ──────────────────────────────────────────
 * Every control shares the same round shape and size so the bar reads as a
 * single consistent set. The microphone button opts into `large` so it stands
 * out as the primary action. `tone` only recolours the button; it never
 * changes its size or shape. */
function ControlButton({
  onClick, title, tone = "neutral", large = false, disabled = false, children,
}: {
  onClick: () => void;
  title: string;
  tone?: "neutral" | "danger" | "active";
  large?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "danger"
      ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
      : tone === "active"
        ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
        : "bg-neutral-200 dark:bg-white/10 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-white/15";
  const sizeCls = large ? "w-14 h-14" : "w-11 h-11";
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      // FIX-LAYOUT: flex-shrink-0 — круглые кнопки никогда не сплющиваются в узком окне.
      className={`flex flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${sizeCls} ${toneCls}`}
    >
      {children}
    </button>
  );
}

/* ── FIX-STAGE: единица медиасетки — экран или камера участника (как плитки в Discord) ── */
type StageMedia = {
  key: string;
  kind: "screen" | "camera";
  name: string;
  stream: MediaStream;
  isLocal: boolean;
};

/* Максимум одновременных потоков на сцене. Больше — сцена превращается в
   простыню мелких окошек, где ничего толком не видно; четыре укладываются
   в аккуратную сетку 2×2 и остаются читаемыми. */
const MAX_STAGE_STREAMS = 4;

interface VoiceExpandedPanelProps {
  onClose: () => void;
  /** Встроить в колонку контента вместо всплывающего окна поверх чата. */
  docked?: boolean;
}

export default function VoiceExpandedPanel({ onClose, docked = false }: VoiceExpandedPanelProps) {
  const voice = useVoice();
  const { data: session } = useSession();
  // The participant whose personal-volume menu is open, anchored at the cursor
  // where it was summoned. Personal volume is stored per-listener in
  // `voice.userVolumes`, so each user tunes everyone else independently — it
  // never affects what other people hear.
  const [volumeMenu, setVolumeMenu] = useState<{ socketId: string; name: string; x: number; y: number } | null>(null);
  // Moderation context menu for kick/ban in voice channel
  const [modMenu, setModMenu] = useState<{
    userId: string; socketId: string; name: string; x: number; y: number;
    canKick: boolean; canBan: boolean; groupId: string;
  } | null>(null);

  /* ── FIX-REPLAY: кнопка «сохранить мгновенный повтор» (только Premium).
     Хуки обязаны стоять ДО раннего return ниже (rules-of-hooks). */
  const [replayState, setReplayState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const replayResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (replayResetRef.current) clearTimeout(replayResetRef.current); }, []);
  const handleSaveReplay = async () => {
    if (replayState === "busy") return;
    setReplayState("busy");
    const ok = await voice.saveReplay();
    setReplayState(ok ? "ok" : "err");
    if (replayResetRef.current) clearTimeout(replayResetRef.current);
    replayResetRef.current = setTimeout(() => setReplayState("idle"), 2000);
  };

  /* ── FIX-STAGE: сцена вмещает НЕСКОЛЬКО потоков одновременно (до
     MAX_STAGE_STREAMS), а не один «в фокусе», как раньше. Порядок массива —
     порядок добавления: он же используется, чтобы решить, какой поток
     вытеснить, когда пытаются добавить пятый (см. addStageKey).
     Хуки обязаны стоять ДО раннего return ниже (rules-of-hooks). */
  const [stageKeys, setStageKeys] = useState<string[]>([]);
  /* Камера включается через getUserMedia — это одна-три секунды на разогрев
     устройства. Без явного ожидания кнопка выглядит нерабочей, человек жмёт
     ещё раз, а повторный вызов глушится защитой в VoiceContext молча. */
  const [cameraBusy, setCameraBusy] = useState(false);
  /* Короткое пояснение о том, что произошло со сценой: какой поток вытеснили.
     Без него пятый добавленный поток молча выбрасывает чей-то чужой. */
  const [stageNotice, setStageNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  /* Показанная и уже закрытая ошибка. Полоска гаснет сама через несколько
     секунд и закрывается крестиком: `voice.error` живёт до следующей ошибки, и
     без этого сообщение о неудачной камере висело бы до конца созвона. */
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const voiceError = voice.error;
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(() => setDismissedError(voiceError), 8000);
    return () => clearTimeout(t);
  }, [voiceError]);
  /* SCREEN-PRIVATE: перед стартом показа спрашиваем, кому он виден. */
  const [sharePrivacyOpen, setSharePrivacyOpen] = useState(false);
  const mediaKeys = [
    ...voice.screenShares.map(s => `screen:${s.socketId}`),
    ...voice.cameraShares.map(c => `cam:${c.socketId}`),
  ].join(",");
  useEffect(() => {
    /* Держим выбор в согласии с реальностью и всегда НЕПУСТЫМ, пока есть хоть
       один поток.

       Раньше пустой выбор означал «показать первый попавшийся», но эта
       автоподстановка не считалась выбранной: клик по такому потоку не делал
       ничего, а клик по участнику добавлял ровно то, что и так показано, —
       на экране не менялось ничего, и переключение выглядело сломанным.
       Теперь первый поток именно ВЫБИРАЕТСЯ, и дальше все клики работают
       одинаково. */
    const alive = mediaKeys ? mediaKeys.split(",") : [];
    setStageKeys(prev => {
      const kept = prev.filter(k => alive.includes(k));
      if (kept.length > 0) return kept.length === prev.length ? prev : kept;
      return alive.length > 0 ? [alive[0]] : [];
    });
  }, [mediaKeys]);

  if (!voice.isConnected && voice.voiceStatus === "idle") return null;

  const myId = session?.user?.id;

  /* ── FIX-STAGE: плитки медиапотоков: сначала экраны, затем все включённые камеры.
     Несколько камер видны одновременно — каждая своей плиткой. */
  const mediaTiles: StageMedia[] = [
    ...voice.screenShares.map((s): StageMedia => ({
      key: `screen:${s.socketId}`,
      kind: "screen",
      name: s.isLocal ? "Вы" : s.userName,
      stream: s.stream,
      isLocal: s.isLocal,
    })),
    ...voice.cameraShares.map((c): StageMedia => ({
      key: `cam:${c.socketId}`,
      kind: "camera",
      name: c.userName,
      stream: c.stream,
      isLocal: c.isLocal,
    })),
  ];

  const notify = (text: string) => {
    setStageNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setStageNotice(null), 2600);
  };

  const nameOfKey = (key: string) => {
    const t = mediaTiles.find(x => x.key === key);
    if (!t) return "поток";
    return t.kind === "screen" ? `экран — ${t.name}` : `камера — ${t.name}`;
  };

  /* Смотреть только это: сцена заменяется одним потоком.
     Это главный жест — обычный клик. Раньше клик всегда «добавлял», и чтобы
     сменить один поток на другой, требовалось два действия: добавить новый и
     убрать старый. */
  const focusStageKey = (key: string) => setStageKeys([key]);

  /* Добавить к тому, что уже на сцене (Ctrl/Cmd + клик или кнопка «плюс»).
     Пятый поток вытесняет самый ранний — и мы говорим, какой именно, чтобы
     чужая пропавшая трансляция не выглядела сбоем. */
  const addStageKey = (key: string) => {
    setStageKeys(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      const next = [...prev, key];
      if (next.length <= MAX_STAGE_STREAMS) return next;
      const dropped = next[0];
      notify(`Больше ${MAX_STAGE_STREAMS} потоков сцена не вмещает — убрали ${nameOfKey(dropped)}`);
      return next.slice(next.length - MAX_STAGE_STREAMS);
    });
  };

  /* Убрать со сцены. Последний поток убрать нельзя: пустая сцена при живой
     трансляции — это не «чисто», а «сломалось». */
  const removeStageKey = (key: string) => {
    setStageKeys(prev => (prev.length <= 1 ? prev : prev.filter(k => k !== key)));
  };

  /** Обычный клик — смотреть только это; с Ctrl/Cmd — добавить к сцене. */
  const pickStream = (key: string, additive: boolean) => {
    if (additive) addStageKey(key);
    else focusStageKey(key);
  };

  const effectiveStageTiles = stageKeys
    .map(k => mediaTiles.find(t => t.key === k))
    .filter((t): t is StageMedia => t != null);

  const micSize = 22;
  const iconSize = 18;

  return (
    /* Два режима одной комнаты.
       Встроенный (docked) — комната занимает колонку контента целиком, как
       любой другой канал. Так и должно быть: голосовой канал равноправен
       текстовому, а не всплывает поверх него окошком. Раньше он открывался
       только модалкой `fixed inset-0` с карточкой `max-w-3xl` — половина
       экрана, а за ней размытая переписка, которой всё равно не
       воспользоваться.
       Модальный режим оставлен для входа не из списка каналов (мини-виджет). */
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={docked
        ? "flex h-full w-full min-h-0"
        : "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"}
      onClick={(e) => { if (!docked && e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 12 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        /* GROUP-SKIN: tz-group-voice — крючок для фона голосовых каналов. */
        className={docked
          ? "tz-group-voice bg-white dark:bg-neutral-900 w-full h-full min-h-0 flex flex-col overflow-hidden"
          : `tz-group-voice bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-white/10 w-full ${mediaTiles.length > 0 ? "max-w-3xl" : "max-w-xl"} overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — собранная строка: индикатор статуса, название канала,
            число участников и пинг в одну строку без лишней высоты. */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
              voice.voiceStatus === "connected" ? "bg-green-400 animate-pulse" :
              voice.voiceStatus === "connecting" ? "bg-yellow-400 animate-pulse" :
              voice.voiceStatus === "reconnecting" ? "bg-orange-400 animate-pulse" :
              "bg-red-400"
            }`} />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                {voice.channelName || "Голосовой канал"}
              </h3>
              <span className="text-xs text-neutral-500">
                {voice.voiceStatus === "connecting" && "Подключение..."}
                {voice.voiceStatus === "reconnecting" && "Переподключение..."}
                {voice.voiceStatus === "error" && <span className="text-red-400">{voice.error || "Ошибка соединения"}</span>}
                {voice.voiceStatus === "connected" && (
                  <>
                    {voice.users.length} {voice.users.length === 1 ? "участник" : voice.users.length < 5 ? "участника" : "участников"}
                    {voice.localPing !== null && (
                      <span className={`ml-2 ${voice.localPing < 150 ? "text-green-400" : voice.localPing < 400 ? "text-yellow-400" : "text-red-400"}`}>
                        {Math.round(voice.localPing)} мс
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 flex-shrink-0 hover:bg-neutral-100 dark:hover:bg-white/10 rounded-lg transition-colors text-neutral-500 hover:text-neutral-700 dark:hover:text-white"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Ошибки устройств (камера, микрофон, доступ) писались в voice.error,
            а показывались только при voiceStatus === "error" — то есть при
            сбое соединения. Отказ камеры статус не меняет, и сообщение
            «Проверьте разрешения» не видел никто: человек жал кнопку и
            получал абсолютную тишину. */}
        {voice.error && voice.error !== dismissedError && voice.voiceStatus !== "error" && (
          <div className="px-5 py-2 flex-shrink-0 border-b border-red-500/20 bg-red-500/[0.07] flex items-center gap-3">
            <span className="flex-1 text-xs text-red-500 dark:text-red-400">{voice.error}</span>
            <button
              type="button"
              onClick={() => setDismissedError(voice.error)}
              className="flex-shrink-0 text-red-400/70 hover:text-red-400 transition-colors"
              aria-label="Скрыть сообщение"
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* FIX-LAYOUT: основная область — сцена слева, участники справа.
            На lg и уже колонка участников прячется, и список выезжает под
            сцену (flex-col), как было раньше на маленьких экранах. */}
        <div className={`flex flex-col lg:flex-row flex-1 min-h-0 ${docked ? "" : "max-h-[80vh]"}`}>
          {/* Сцена: выбранные потоки (до 4) на тёмной подложке. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col px-4 pt-3 pb-2">
            <div className="flex-1 min-h-[220px] rounded-xl bg-neutral-950 border border-neutral-200/10 dark:border-white/10 p-2">
              <StageArea
                tiles={effectiveStageTiles}
                canRemove={stageKeys.length > 1}
                onRemove={removeStageKey}
              />
            </div>

            {/* Полоса всех доступных потоков. Без неё до второй дорожки одного
                человека было не добраться: в колонке участников у него одна
                плитка, и она вела только на экран, а камера оставалась
                недостижимой. */}
            {mediaTiles.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pt-2 pb-0.5">
                {mediaTiles.map(t => {
                  const onStage = stageKeys.includes(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={(e) => pickStream(t.key, e.ctrlKey || e.metaKey)}
                      title={onStage ? "На сцене · Ctrl+клик — убрать" : "Смотреть только это · Ctrl+клик — добавить"}
                      className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ${
                        onStage
                          ? "border-violet-400 dark:border-cyan-400 bg-violet-50 dark:bg-cyan-400/10 text-violet-600 dark:text-cyan-300"
                          : "border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-white/25"
                      }`}
                    >
                      {t.kind === "screen" ? "Экран — " : "Камера — "}{t.name}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="px-1 pt-2 text-[10px] text-neutral-400 dark:text-neutral-500">
              Клик — смотреть только это · Ctrl+клик — добавить к сцене (до {MAX_STAGE_STREAMS})
            </p>
            {stageNotice && (
              <p className="px-1 pt-1 text-[10px] text-amber-500 dark:text-amber-400">{stageNotice}</p>
            )}
          </div>

          {/* Участники — на широких экранах фиксированная колонка справа со
              своей прокруткой, на узких — блок под сценой (см. классы выше). */}
          <div className="lg:w-64 flex-shrink-0 lg:border-l border-neutral-200 dark:border-white/10 flex flex-col min-h-0">
            <p className="px-3 pt-3 pb-1 text-[10px] text-neutral-400 dark:text-neutral-500 flex-shrink-0">
              Клик — смотреть только этого · Ctrl+клик — добавить · ПКМ — громкость
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                {voice.users.map(u => {
                  const isSpeaking = voice.speakingUsers.has(u.socketId);
                  const isScreenSharing = voice.screenSharerIds.has(u.socketId);
                  const hasCamera = voice.cameraUserIds.has(u.socketId); // FIX-CAM
                  const isSelf = myId != null && u.userId === myId;
                  const isMenuOpen = volumeMenu?.socketId === u.socketId;
                  const volume = voice.userVolumes.get(u.socketId) ?? 100;

                  const openMenu = (e: React.MouseEvent) => {
                    if (isSelf) return;
                    e.preventDefault();
                    const cx = e.clientX, cy = e.clientY;
                    setVolumeMenu({ socketId: u.socketId, name: u.userName, x: cx, y: cy });
                    // Fetch moderation permissions for this channel participant
                    if (voice.channelId && u.userId) {
                      fetch(`/api/voice/moderation-info?channelId=${encodeURIComponent(voice.channelId)}&targetUserId=${encodeURIComponent(u.userId)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                          if (data && (data.canKick || data.canBan)) {
                            setModMenu({ userId: u.userId, socketId: u.socketId, name: u.userName, x: cx, y: cy, canKick: data.canKick, canBan: data.canBan, groupId: data.groupId });
                          }
                        })
                        .catch(() => null);
                    }
                  };

                  /* Свои потоки хранятся под ключом "local", поэтому для себя ищем по isLocal. */
                  const mine = (t: StageMedia) => (isSelf ? t.isLocal : t.key.endsWith(`:${u.socketId}`));
                  const cameraTile = mediaTiles.find(t => t.kind === "camera" && mine(t)) ?? null;
                  const screenTile = mediaTiles.find(t => t.kind === "screen" && mine(t)) ?? null;
                  const primaryStageKey = screenTile?.key ?? cameraTile?.key ?? null;

                  return (
                    <ParticipantTile
                      key={u.socketId}
                      name={u.userName}
                      avatar={u.avatar ?? null}
                      isSelf={isSelf}
                      isSpeaking={isSpeaking}
                      isScreenSharing={isScreenSharing}
                      isMuted={u.muted}
                      volume={volume}
                      cameraTile={cameraTile}
                      isMenuOpen={isMenuOpen}
                      isOnStage={primaryStageKey != null && stageKeys.includes(primaryStageKey)}
                      quality={voice.connectionQuality.get(u.socketId) ?? "unknown"}
                      onClick={(e) => { if (primaryStageKey) pickStream(primaryStageKey, e.ctrlKey || e.metaKey); }}
                      onContextMenu={openMenu}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Controls — one uniform set of round buttons; the mic is the large,
            primary control, everything else shares the same smaller size. */}
        {/* FIX-LAYOUT: flex-wrap — при нехватке места кнопки аккуратно переносятся,
            а не съезжают и не вылезают за край панели. */}
        <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-4 border-t border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/50 flex-shrink-0">
          {/* Microphone (larger than the rest) */}
          <ControlButton
            onClick={voice.toggleMute}
            tone={voice.isMuted ? "danger" : "neutral"}
            large
            title={voice.isMuted ? "Вкл. микрофон" : "Выкл. микрофон"}
          >
            {voice.isMuted ? (
              <svg width={micSize} height={micSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.56-.06.84" />
                <line x1="12" y1="19" x2="12" y2="23" />
              </svg>
            ) : (
              <svg width={micSize} height={micSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </ControlButton>

          {/* Deafen */}
          <ControlButton
            onClick={voice.toggleDeafen}
            tone={voice.isDeafened ? "danger" : "neutral"}
            title={voice.isDeafened ? "Вкл. звук" : "Выкл. звук"}
          >
            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              {voice.isDeafened && <line x1="2" y1="2" x2="22" y2="22" />}
            </svg>
          </ControlButton>

          {/* Noise suppressor */}
          <ControlButton
            onClick={voice.toggleNS}
            tone={voice.nsEnabled ? "active" : "neutral"}
            title={voice.nsEnabled ? "Выкл. шумодав" : "Вкл. шумодав"}
          >
            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M2 12h3l2-7 4 18 3-11 2 4h6" />
            </svg>
          </ControlButton>

          {/* Screen share — several people may share at once, so this is never
              blocked just because someone else is already sharing. */}
          <ControlButton
            onClick={() => (voice.isSharingScreen ? voice.stopScreenShare() : setSharePrivacyOpen(true))}
            tone={voice.isSharingScreen ? "active" : "neutral"}
            title={voice.isSharingScreen ? "Стоп демонстрация" : "Демонстрация экрана"}
          >
            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </ControlButton>

          {/* FIX-CAM: камера — 720p, а с Premium 1080p */}
          {/* FIX-CAM: включение камеры — это getUserMedia, одна-три секунды на
              разогрев устройства. Без состояния ожидания кнопка выглядела
              нерабочей: человек жал повторно, а второй вызов глушился защитой
              в VoiceContext молча. Вне канала кнопка теперь заблокирована и
              объясняет причину, а не возвращается без единого слова. */}
          <ControlButton
            onClick={() => {
              if (cameraBusy) return;
              /* FIX-SHARECAM: случайное нажатие сразу показывало вас каналу. */
              if (!voice.isCameraOn && !window.confirm("Включить камеру? Вас увидят участники голосового канала.")) return;
              setCameraBusy(true);
              void voice.toggleCamera().finally(() => setCameraBusy(false));
            }}
            tone={voice.isCameraOn ? "active" : "neutral"}
            disabled={!voice.isConnected || cameraBusy}
            title={!voice.isConnected
              ? "Сначала подключитесь к голосовому каналу"
              : cameraBusy
                ? "Включаем камеру…"
                : voice.isCameraOn
                  ? "Выкл. камеру"
                  : `Вкл. камеру (${voice.isPremium ? "1080p" : "720p"})`}
          >
            <svg
              width={iconSize}
              height={iconSize}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className={cameraBusy ? "animate-pulse" : undefined}
            >
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
              {!voice.isCameraOn && !cameraBusy && <line x1="2" y1="3" x2="22" y2="21" />}
            </svg>
          </ControlButton>

          {/* FIX-REPLAY: сохранить последние 30 секунд (голос + трансляция) — только Premium */}
          {voice.isPremium && (
            <ControlButton
              onClick={() => { void handleSaveReplay(); }}
              tone={replayState === "ok" ? "active" : replayState === "err" ? "danger" : "neutral"}
              disabled={!voice.replayReady || replayState === "busy"}
              title={
                replayState === "ok"
                  ? "Повтор сохранён"
                  : replayState === "err"
                    ? "Не удалось сохранить повтор"
                    : voice.replayReady
                      ? "Сохранить повтор (последние 30 сек)"
                      : "Повтор недоступен (буфер выключен или не готов)"
              }
            >
              <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </ControlButton>
          )}

          {/* Leave */}
          <ControlButton
            onClick={() => { voice.leaveVoice(); onClose(); }}
            tone="danger"
            title="Выйти"
          >
            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M16 8l-8 8M8 8l8 8" />
            </svg>
          </ControlButton>
        </div>
      </motion.div>

      {/* Personal-volume context menu (opened by right-clicking a participant) */}
      <AnimatePresence>
        {volumeMenu && (
          <VolumeMenu
            key={volumeMenu.socketId}
            name={volumeMenu.name}
            x={volumeMenu.x}
            y={volumeMenu.y}
            volume={voice.userVolumes.get(volumeMenu.socketId) ?? 100}
            onChange={(v) => voice.setUserVolume(volumeMenu.socketId, v)}
            onClose={() => setVolumeMenu(null)}
          />
        )}
      </AnimatePresence>

      {/* Voice moderation actions (kick/ban) shown when moderator right-clicks */}
      <AnimatePresence>
        {modMenu && (
          <VoiceModerationMenu
            key={modMenu.socketId + "-mod"}
            name={modMenu.name}
            x={modMenu.x}
            y={modMenu.y + 100}
            canKick={modMenu.canKick}
            canBan={modMenu.canBan}
            onKick={async () => {
              setModMenu(null);
              // Find memberId via group members — lazy lookup via bans endpoint alternative
              const res = await fetch(`/api/groups/${modMenu.groupId}/members?userId=${encodeURIComponent(modMenu.userId)}`);
              if (!res.ok) return;
              const data = await res.json();
              const member = Array.isArray(data) ? data.find((m: { user: { id: string }; id: string }) => m.user?.id === modMenu.userId) : null;
              if (!member) return;
              await fetch(`/api/groups/${modMenu.groupId}/members/${member.id}`, { method: "DELETE" });
            }}
            onBan={async () => {
              setModMenu(null);
              await fetch(`/api/groups/${modMenu.groupId}/bans`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: modMenu.userId, reasonPreset: "CUSTOM", reason: "Нарушение в голосовом канале" }),
              });
            }}
            onClose={() => setModMenu(null)}
          />
        )}
      </AnimatePresence>

      {/* SCREEN-PRIVATE: выбор, кому видна демонстрация, перед её запуском. */}
      {sharePrivacyOpen && (
        <ScreenSharePrivacyModal
          withQuality
          onClose={() => setSharePrivacyOpen(false)}
          onStart={(allowUserIds, sourceId) => {
            setSharePrivacyOpen(false);
            void voice.startScreenShare(allowUserIds, sourceId);
          }}
        />
      )}
    </motion.div>
  );
}

/* ── Personal-volume menu ──────────────────────────────────────────────────
 * A small Discord-style popover anchored at the cursor. It edits this
 * listener's personal volume for one participant (0–200%); the change is local
 * to this client and never affects what anyone else hears. Dismisses on outside
 * click, Escape, or scroll. Rendered through a portal so it floats above the
 * voice panel regardless of overflow/stacking contexts. */
function VolumeMenu({
  name, x, y, volume, onChange, onClose,
}: {
  name: string;
  x: number;
  y: number;
  volume: number;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the viewport no matter where it was summoned.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth || 240;
    const h = el.offsetHeight || 96;
    const left = Math.min(x, window.innerWidth - w - 8);
    const top = Math.min(y, window.innerHeight - h - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Defer binding the outside-click listener so the summoning click/contextmenu
    // does not immediately close the freshly-opened menu.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12 }}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 10000 }}
      className="w-60 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-800 shadow-2xl p-3"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-neutral-900 dark:text-white truncate">{name}</span>
        <span className={`text-[11px] tabular-nums ${volume > 100 ? "text-amber-500 font-medium" : "text-neutral-500"}`}>{volume}%</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(volume === 0 ? 100 : 0)}
          className="p-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors flex-shrink-0"
          title={volume === 0 ? "Включить звук" : "Заглушить для себя"}
        >
          {volume === 0 ? (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="16" y1="9" x2="22" y2="15" />
              <line x1="22" y1="9" x2="16" y2="15" />
            </svg>
          ) : (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={volume}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-violet-500 dark:accent-cyan-400 cursor-pointer"
          aria-label={`Громкость: ${name}`}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-neutral-400">
        <span>0%</span>
        <button onClick={() => onChange(100)} className="hover:text-neutral-700 dark:hover:text-white transition-colors">Сброс</button>
        <span>200%</span>
      </div>
    </motion.div>,
    document.body,
  );
}

/* ── FIX-STAGE: раскладка сцены по числу выбранных потоков ─────────────────
 * Отдельная функция, а не разбросанные по JSX условия: раскладка — это чистое
 * решение «сколько блоков и как их расположить», не зависящее от остального
 * рендера. 1 — во всю сцену; 2 — рядом по горизонтали (в столбик на узкой
 * сцене); 3 — крупный сверху и два поменьше снизу; 4 — сетка 2×2. */
function stageLayoutClassName(count: number): string {
  switch (count) {
    case 0:
    case 1:
      return "grid grid-cols-1 grid-rows-1 h-full";
    case 2:
      return "grid grid-cols-1 sm:grid-cols-2 grid-rows-2 sm:grid-rows-1 gap-2 h-full";
    case 3:
      // Верхняя строка — один крупный блок на всю ширину (col-span-2),
      // нижняя — два блока поменьше. На узкой сцене все блоки идут в столбик.
      return "grid grid-cols-1 sm:grid-cols-2 grid-rows-3 sm:grid-rows-2 gap-2 h-full [&>*:first-child]:sm:col-span-2";
    default:
      return "grid grid-cols-1 sm:grid-cols-2 grid-rows-4 sm:grid-rows-2 gap-2 h-full";
  }
}

/* ── Сцена: до MAX_STAGE_STREAMS потоков одновременно ──────────────────────
 * Пустое состояние — аккуратная заглушка вместо чёрного провала. */
function StageArea({
  tiles, canRemove, onRemove,
}: {
  tiles: StageMedia[];
  /** Последний поток убрать нельзя — пустая сцена читается как поломка. */
  canRemove: boolean;
  onRemove: (key: string) => void;
}) {
  if (tiles.length === 0) {
    return (
      <div className="h-full min-h-[200px] flex flex-col items-center justify-center gap-2 text-neutral-500">
        <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="opacity-50">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <p className="text-xs">Никто не демонстрирует экран</p>
      </div>
    );
  }

  return (
    <div className={stageLayoutClassName(tiles.length)}>
      {tiles.map(tile => (
        <StageTile
          key={tile.key}
          tile={tile}
          onRemove={canRemove ? () => onRemove(tile.key) : undefined}
        />
      ))}
    </div>
  );
}

/* ── FIX-STAGE: плитка потока на сцене (экран или камера) в стиле Discord ──
 * Клик по крестику в углу убирает поток со сцены; клик по самой плитке
 * переключает то же самое (удобно, если навести не попал точно на крестик).
 * Собственная камера отображается зеркально (как привычно в видеочатах) и
 * всегда без звука — голос идёт отдельным микрофонным треком. Экраны
 * показываются object-contain (без обрезки контента), камеры — object-cover. */
/* Клик по самой картинке НИЧЕГО не убирает. Раньше вся плитка была кнопкой
   «убрать со сцены», и естественный жест «щёлкнуть по видео» выбрасывал поток,
   который человек только что открыл. Убрать можно крестиком в углу — действие
   разрушительное, значит требует прицельного нажатия. */
function StageTile({ tile, onRemove }: { tile: StageMedia; onRemove?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== tile.stream) el.srcObject = tile.stream;
    const tryPlay = () => el.play().catch(() => { /* autoplay может быть отложен браузером */ });
    tryPlay();
    // FIX-SS-WHITE: доигрываем по готовности метаданных — иначе при смене
    // раскладки (изменение числа плиток на сцене) StageTile перемонтируется
    // и на миг показывает пустой (белый) кадр.
    el.addEventListener("loadedmetadata", tryPlay);
    // Намеренно НЕ обнуляем srcObject в cleanup: поток остаётся живым, а
    // обнуление при перемонтировании и вызывало «белый экран» на кадр.
    return () => { el.removeEventListener("loadedmetadata", tryPlay); };
  }, [tile.stream]);

  return (
    <div className="group relative w-full h-full min-h-0 rounded-xl overflow-hidden bg-black border border-white/10">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full ${tile.kind === "screen" ? "object-contain" : "object-cover"} ${tile.isLocal && tile.kind === "camera" ? "scale-x-[-1]" : ""}`}
      />
      <span className="absolute bottom-1.5 left-1.5 max-w-[85%] flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 text-[10px] text-white">
        {tile.kind === "screen" ? (
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="flex-shrink-0">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        ) : (
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="flex-shrink-0">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
        )}
        <span className="truncate">{tile.kind === "screen" ? `Экран — ${tile.name}` : tile.name}</span>
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Убрать со сцены"
          className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ── Плитка участника в правой колонке ─────────────────────────────────────
 * Если камера включена — живое видео вместо аватара (как в галерее
 * видеозвонков); иначе — крупный инициал на тёмном фоне. Подсветка рамкой,
 * когда участник говорит (voice.speakingUsers) или выбран на сцену.
 * ПКМ открывает существующее меню персональной громкости — эта плитка лишь
 * заменяет старую строку списка, поведение сохранено полностью. */
function ParticipantTile({
  name, avatar, isSelf, isSpeaking, isScreenSharing, isMuted, volume, cameraTile,
  isMenuOpen, isOnStage, quality, onClick, onContextMenu,
}: {
  name: string;
  avatar: string | null;
  isSelf: boolean;
  isSpeaking: boolean;
  isScreenSharing: boolean;
  isMuted: boolean;
  volume: number;
  cameraTile: StageMedia | null;
  isMenuOpen: boolean;
  isOnStage: boolean;
  quality: ConnectionQuality;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !cameraTile) return;
    if (el.srcObject !== cameraTile.stream) el.srcObject = cameraTile.stream;
    const tryPlay = () => el.play().catch(() => { /* autoplay может быть отложен браузером */ });
    tryPlay();
    el.addEventListener("loadedmetadata", tryPlay);
    return () => { el.removeEventListener("loadedmetadata", tryPlay); };
  }, [cameraTile]);

  const clickable = cameraTile != null || isScreenSharing; // клик осмысленен, только если есть что вывести на сцену

  return (
    <div
      onClick={clickable ? onClick : undefined}
      onContextMenu={onContextMenu}
      title={clickable
        ? `Клик — смотреть только этого · Ctrl+клик — добавить к сцене${isSelf ? "" : " · ПКМ — громкость"}`
        : isSelf ? "Это вы" : "ПКМ — настроить громкость"}
      className={`group relative aspect-video sm:aspect-square rounded-xl overflow-hidden border text-left transition-all ${
        clickable ? "cursor-pointer" : "cursor-default"
      } ${
        isOnStage
          ? "border-violet-400 dark:border-cyan-400 ring-2 ring-violet-400/40 dark:ring-cyan-400/40"
          : isSpeaking
            ? "border-green-400/70 ring-1 ring-green-400/30"
            : "border-neutral-200 dark:border-white/10 hover:border-violet-300 dark:hover:border-cyan-500/60"
      } ${isMenuOpen ? "bg-neutral-100 dark:bg-white/5" : "bg-neutral-800"}`}
    >
      {cameraTile ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${cameraTile.isLocal ? "scale-x-[-1]" : ""}`}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-800 dark:bg-neutral-800">
          <div
            className={`w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-base font-bold transition-all ${
              isSpeaking
                ? "bg-green-500/20 ring-2 ring-green-400 text-green-400"
                : "bg-white/10 text-neutral-300"
            }`}
          >
            {/* Аватар участника. Плитка рисовала только первую букву имени —
                не потому, что так задумано, а потому что аватар не доезжал с
                сервера: в присутствии его просто не было. Теперь он приходит,
                а буква осталась запасным вариантом. */}
            {avatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              name.charAt(0).toUpperCase()
            )}
          </div>
        </div>
      )}

      {/* Значки состояния — верхний правый угол поверх плитки. */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
        <QualityIcon quality={quality} />
        {isScreenSharing && (
          <span className="text-blue-300 bg-black/50 rounded p-0.5" title="Демонстрация экрана">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </span>
        )}
        {isMuted && (
          <span className="text-red-300 bg-black/50 rounded p-0.5" title="Микрофон выключен">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.56-.06.84" />
            </svg>
          </span>
        )}
      </div>

      {/* Имя — внизу плитки поверх лёгкой подложки, как на сцене. */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <span className="block text-[11px] font-medium text-white truncate">
          {name}{isSelf ? " (Вы)" : ""}
        </span>
        {isSpeaking
          ? <span className="text-[9px] text-green-300">Говорит</span>
          : (!isSelf && volume !== 100) && <span className="text-[9px] text-neutral-300">Громкость {volume}%</span>}
      </div>
    </div>
  );
}

/* ── Voice moderation menu ─────────────────────────────────────────────────
 * Shown below the volume popover when the local user has kick/ban rights over
 * the target in this voice channel. Rendered through a portal. */
function VoiceModerationMenu({
  name, x, y, canKick, canBan, onKick, onBan, onClose,
}: {
  name: string;
  x: number;
  y: number;
  canKick: boolean;
  canBan: boolean;
  onKick: () => void;
  onBan: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 80;
    const left = Math.min(x, window.innerWidth - w - 8);
    const top  = Math.min(y, window.innerHeight - h - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey  = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12 }}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 10001 }}
      className="w-52 rounded-xl border border-white/10 bg-neutral-800 shadow-2xl overflow-hidden"
    >
      <div className="px-3 py-2 text-xs text-neutral-400 font-medium border-b border-white/10 truncate">
        Модерация: {name}
      </div>
      {canKick && (
        <button
          onClick={onKick}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-orange-400 hover:bg-orange-500/10 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
          </svg>
          Исключить из голосового
        </button>
      )}
      {canBan && (
        <button
          onClick={onBan}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M4.93 4.93l14.14 14.14" />
          </svg>
          Забанить из группы
        </button>
      )}
    </motion.div>,
    document.body,
  );
}
