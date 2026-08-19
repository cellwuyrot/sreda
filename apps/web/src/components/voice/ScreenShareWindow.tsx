"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useVoice, SCREEN_COMFORT_VIEWERS, type ScreenShare } from "@/contexts/VoiceContext";
import ScreenSharePrivacyModal from "./ScreenSharePrivacyModal"; // SCREEN-PRIVATE-LIVE

interface ScreenShareWindowProps {
  shares: ScreenShare[];
  onStopLocal?: () => void;
  /**
   * Открыт ли сейчас тот самый голосовой канал, где идёт показ.
   *
   * Демонстрация принадлежит каналу, а не всему приложению. Уходя в текстовый
   * канал, человек уходит от показа — и окно, продолжавшее висеть поверх
   * переписки, было не «удобно», а мешало: читать чат было нечем. Теперь вне
   * своего канала показ сворачивается в плашку «идёт трансляция».
   */
  onVoiceChannel?: boolean;
  /**
   * Счётчик запросов «покажи трансляцию». Растёт на каждый левый щелчок по
   * голосовому каналу.
   *
   * Прежде вернуться к показу можно было только плашкой в углу — а у плашки
   * есть кнопка «Скрыть», и после неё окно уходило в никуда: `bannerHidden`
   * сбрасывался лишь когда трансляций не осталось вовсе. Человек, случайно
   * скрывший плашку, до конца чужого показа не мог вернуться ничем.
   *
   * Щелчок по каналу — то самое естественное действие, которым люди и пытались
   * вернуться. Счётчик, а не флаг: важен сам факт нового запроса, в том числе
   * повторного.
   */
  focusNonce?: number;
}

// FIX-SS-MODES: у демонстрации ровно два режима отображения — «Во весь экран»
// (full) и «Мини-окно» (mini). Прежний третий режим «Средний» удалён: он
// открывался сам поверх комнаты и воспринимался как «непонятная штука».
// FIX-SS-PIP: режим «Мини» больше НЕ переводит всё окно десктоп-приложения в
// системный PiP (раньше приложение целиком сжималось в маленькое окно ОС).
// Мини-окно — это компактный плеер ВНУТРИ приложения, перетаскиваемый мышью;
// из него можно только развернуть демонстрацию во весь экран или закрыть её.
type ViewMode = "full" | "mini";

type IconName = "mic" | "sound" | "noise" | "full" | "mini" | "exit" | "stop" | "leave" | "return" | "gear";

function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "mic") return <svg {...common}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/></svg>;
  if (name === "sound") return <svg {...common}><path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>;
  if (name === "noise") return <svg {...common}><path d="M2 12h3l2-7 4 18 3-11 2 4h6"/></svg>;
  // full = развернуть на весь экран (стрелки в углы), mini = компактное окно
  if (name === "full") return <svg {...common}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg>;
  if (name === "mini") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="13" y="12" width="6" height="5" rx="1"/></svg>;
  if (name === "exit") return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></svg>;
  if (name === "stop") return <svg {...common}><rect x="6" y="6" width="12" height="12" rx="2"/></svg>;
  if (name === "leave") return <svg {...common}><path d="M5 11a11 11 0 0 1 14 0"/><path d="m7 14-3 4 4 2 3-4M17 14l3 4-4 2-3-4"/></svg>;
  if (name === "return") return <svg {...common}><path d="m9 14-4-4 4-4"/><path d="M5 10h8a6 6 0 0 1 6 6v2"/></svg>;
  if (name === "gear") return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
  return null;
}

function RoundButton({ title, active = false, danger = false, disabled = false, onClick, children }: {
  title: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const color = danger
    ? "bg-red-500/15 text-red-300 border-red-400/30 hover:bg-red-500/25"
    : active
      ? "bg-violet-500/20 dark:bg-cyan-400/15 text-violet-200 dark:text-cyan-200 border-violet-400/40 dark:border-cyan-400/35"
      : "bg-white/[0.06] text-white/75 border-white/10 hover:bg-white/10 hover:text-white";
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className={`w-11 h-11 rounded-xl border inline-flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${color}`}>{children}</button>;
}

/**
 * Прямоугольник области чата — окно показа раскрывается ровно в ней.
 *
 * Раньше стоял `fixed inset-0`: показ накрывал всё окно приложения, и вместе с
 * ним пропадали список сообществ, каналы и участники. А обсуждение того, что
 * показывают, идёт ровно там — в чате. Теперь окно занимает колонку контента,
 * а боковые панели остаются на месте.
 *
 * Область находится по отметке `data-tz-share-area` в разметке страницы.
 * Позиционирование остаётся `fixed` с явными координатами, а не `absolute`
 * внутри колонки: колонка участвует в прокрутке и в ограничении отрисовки, и
 * вложенный в неё оверлей обрезался бы по её содержимому.
 *
 * Если отметки нет (мини-виджет вне страницы чата) — разворачиваемся на всё
 * окно, как прежде.
 */
function useShareAreaRect(active: boolean) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const host = document.querySelector("[data-tz-share-area]");
      if (!host) { setRect(null); return; }
      const r = host.getBoundingClientRect();
      if (r.width < 320 || r.height < 240) { setRect(null); return; } // узкий экран — во всё окно
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    /* Колонку можно тащить за разделитель — следим за её размером, иначе окно
       показа осталось бы стоять по старым координатам. */
    const host = document.querySelector("[data-tz-share-area]");
    const observer = host && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (host && observer) observer.observe(host);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [active]);

  return rect;
}

function useAttachStream(stream: MediaStream | null) {
  // FIX-SS-WHITE: устойчивое подключение потока к <video>. При смене режима
  // (полный экран / мини) элемент <video> пересоздаётся, и раньше бывал кадр,
  // когда поток ещё не привязан или воспроизведение отложено автоплей-политикой
  // — зритель видел пустой (белый/чёрный) прямоугольник. Теперь: всегда
  // переустанавливаем srcObject новому элементу и доигрываем по готовности
  // метаданных, а также по первому клику (обход автоплея).
  return useCallback((element: HTMLVideoElement | null) => {
    if (!element) return;
    if (stream && element.srcObject !== stream) element.srcObject = stream;
    if (!stream) return;
    const tryPlay = () => { element.play().catch(() => {}); };
    tryPlay();
    element.onloadedmetadata = tryPlay;
    element.oncanplay = tryPlay;
  }, [stream]);
}

export default function ScreenShareWindow({ shares, onStopLocal, onVoiceChannel = true, focusNonce = 0 }: ScreenShareWindowProps) {
  const voice = useVoice();
  const [activeId, setActiveId] = useState<string | null>(null);
  // FIX-SS-MODES: демонстрация открывается сразу во весь экран (как то же
  // самое окно комнаты), откуда её можно свернуть в мини или закрыть.
  const [mode, setMode] = useState<ViewMode>("full");
  const [viewerDismissed, setViewerDismissed] = useState(false);
  /* Плашку «идёт трансляция» тоже нужно уметь убрать: прекратив просмотр,
     человек оставался с ней на экране до конца чужого показа, и убрать её было
     нечем. Возвращается сама, когда начнётся следующая трансляция. */
  const [bannerHidden, setBannerHidden] = useState(false);
  /* Согласие на просмотр, по одному на трансляцию. Чужой показ раньше
     разворачивался сам и сразу во весь экран — что бы там ни было на чужом
     мониторе, зритель это уже увидел. Теперь до согласия картинка размыта, и
     из размытия видно только то, что показ идёт. */
  const [consented, setConsented] = useState<Set<string>>(() => new Set());
  const [launching, setLaunching] = useState(true);

  // ── Мини-окно ──────────────────────────────────────────────────────
  // Компактный плеер в пределах окна приложения; перетаскивается мышью за
  // шапку. Никакого системного PiP всего приложения (FIX-SS-PIP).
  const [miniPos, setMiniPos] = useState<{ x: number; y: number } | null>(null);
  /* SCREEN-PRIVATE-LIVE: панель управления зрителями. Открывается правым
     щелчком по своему показу или шестерёнкой в шапке; координаты нужны, чтобы
     окошко появилось у курсора. */
  const [privacyAt, setPrivacyAt] = useState<{ x: number; y: number } | null>(null);
  /* FIX-SHARECAM: состояние кнопки камеры держим рядом с остальными хуками: ниже в файле
     есть ранние return, а хуки после них запрещены (react-hooks/rules-of-hooks). */
  const [cameraBusy, setCameraBusy] = useState(false);
  const miniDragRef = useRef<{ dx: number; dy: number; w: number; h: number } | null>(null);

  const onMiniDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const card = e.currentTarget.closest("section");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    miniDragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
    const onMove = (ev: PointerEvent) => {
      const drag = miniDragRef.current;
      if (!drag) return;
      setMiniPos({
        x: Math.min(Math.max(ev.clientX - drag.dx, 8), Math.max(8, window.innerWidth - drag.w - 8)),
        y: Math.min(Math.max(ev.clientY - drag.dy, 8), Math.max(8, window.innerHeight - drag.h - 8)),
      });
    };
    const onUp = () => {
      miniDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    if (shares.length === 0) {
      setActiveId(null);
      // Демонстраций больше нет — сбрасываем «свёрнутость», чтобы следующая
      // трансляция открылась нормально.
      setViewerDismissed(false);
      setBannerHidden(false);
      setMode("full");
      /* Показов не осталось — следующий снова спросит согласия. */
      setConsented(new Set());
      return;
    }
    if (!activeId || !shares.some((share) => share.socketId === activeId)) {
      // FIX-SS-STOPVIEW: активная трансляция сменилась/исчезла — переключаемся на
      // первую доступную, но НЕ сбрасываем viewerDismissed. Раньше это принудительно
      // возвращало зрителя в полноэкранный просмотр каждый раз, когда массив shares
      // менялся (новый демонстрирующий, смена socketId) — из-за этого «невозможно
      // было перестать смотреть демонстрацию». Выбор зрителя теперь сохраняется.
      setActiveId(shares[0].socketId);
    }
  }, [shares, activeId]);

  /* Запрос «покажи трансляцию» разворачивает окно заново. Согласие на просмотр
     при этом НЕ выдаётся: картинка снова под размытием, пока человек не нажмёт
     «Смотреть». Возврат к показу и согласие смотреть — разные решения. */
  useEffect(() => {
    if (focusNonce <= 0) return;
    setViewerDismissed(false);
    setBannerHidden(false);
    setMode("full");
  }, [focusNonce]);

  /* Сменилась сама трансляция — скрытая плашка больше не про неё. Раньше это
     сбрасывалось только когда показов не осталось совсем: после ухода одного
     ведущего и прихода другого плашка оставалась скрытой. */
  useEffect(() => {
    if (activeId) setBannerHidden(false);
  }, [activeId]);

  /* Смена голосового канала — новый разговор. Отказ смотреть чей-то показ в
     прежнем канале к новому отношения не имеет: человек заходит туда, где уже
     идёт трансляция, и должен её увидеть, а не остаться с решением, принятым
     в другом месте. Само согласие на просмотр при этом не наследуется — в
     новом канале картинка снова под размытием. */
  const voiceChannelId = voice.channelId;
  useEffect(() => {
    setViewerDismissed(false);
    setBannerHidden(false);
    setMode("full");
  }, [voiceChannelId]);

  useEffect(() => {
    if (!activeId) return;
    setLaunching(true);
    const timer = window.setTimeout(() => setLaunching(false), 1650);
    return () => window.clearTimeout(timer);
  }, [activeId]);

  const active = shares.find((share) => share.socketId === activeId) ?? shares[0] ?? null;
  const attachVideo = useAttachStream(active?.stream ?? null);
  const areaRect = useShareAreaRect(true);

  /* SCREEN-VIEWERS: пока открыто окно чужой трансляции, сообщаем серверу, что
     смотрим именно её — ведущий и другие зрители видят состав. Эффект стоит до
     раннего return ниже: хуки нельзя вызывать условно. */
  const setViewingScreen = voice.setViewingScreen;
  /* В список зрителей попадаем только после согласия: иначе ведущий видел бы
     «смотрит» у того, у кого на экране размытый прямоугольник. */
  const awaitingConsent = !!active && !active.isLocal && !consented.has(active.socketId);
  const watchedSocketId = active && !active.isLocal && !awaitingConsent ? active.socketId : null;
  useEffect(() => {
    if (!watchedSocketId) return;
    setViewingScreen(watchedSocketId);
    return () => setViewingScreen(null);
  }, [watchedSocketId, setViewingScreen]);

  if (!active || typeof document === "undefined") return null;

  const isViewer = !active.isLocal;
  /* Ники зрителей текущей трансляции. */
  const viewers = voice.screenViewers.get(active.socketId) ?? [];
  const canStop = active.isLocal && !!onStopLocal;
  const hasPoorPeer = active.isLocal && [...voice.connectionQuality.values()].some((value) => value === "poor");
  const quality = hasPoorPeer || (voice.localPing != null && voice.localPing >= 400)
    ? "Нестабильно"
    : voice.localPing == null
      ? "Стабильно"
      : voice.localPing < 150 ? "Отлично" : "Средне";
  const streamLabel = `${active.quality.resolution}p · до ${active.quality.fps} FPS`;

  const accept = () => setConsented((prev) => new Set(prev).add(active.socketId));

  /* Заслонка поверх размытой картинки. Показывается ровно до выбора: смотреть
     или нет. «Не смотреть» не останавливает чужой показ — он продолжается,
     просто без вас, и вернуться можно плашкой в углу. */
  const consentOverlay = awaitingConsent ? (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 p-4">
      <div className="max-w-[320px] w-full rounded-xl border border-white/12 bg-neutral-900/95 p-4 text-center shadow-2xl">
        <span className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-violet-500/20 dark:bg-cyan-400/15 text-violet-300 dark:text-cyan-300 mb-2">
          <Icon name="mini" />
        </span>
        <strong className="block text-[13px] text-white">{active.userName} демонстрирует экран</strong>
        <span className="mt-1 block text-[11px] text-white/50">
          Картинка размыта, пока вы не откроете просмотр.
        </span>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={accept}
            className="flex-1 py-2 rounded-lg bg-violet-600 dark:bg-cyan-600 text-white text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Смотреть
          </button>
          <button
            type="button"
            onClick={() => setViewerDismissed(true)}
            className="flex-1 py-2 rounded-lg border border-white/12 text-white/70 text-xs font-medium hover:bg-white/[0.06] transition-colors"
          >
            Не смотреть
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const toggleCameraWithConfirm = () => {
    if (cameraBusy) return;
    /* Подтверждение только на включение: выключать надо одним нажатием. */
    if (!voice.isCameraOn && !window.confirm("Включить камеру? Вас увидят участники голосового канала.")) return;
    setCameraBusy(true);
    void voice.toggleCamera().finally(() => setCameraBusy(false));
  };

  const stopOrExit = () => {
    if (canStop) { onStopLocal?.(); return; }
    /* «Прекратить просмотр» возвращает всё к началу: согласие снимается, и при
       следующем открытии картинка снова под размытием. Иначе один раз нажатое
       «Смотреть» действовало бы до конца созвона, что бы ведущий потом ни
       вывел на экран. */
    setConsented((prev) => {
      const next = new Set(prev);
      next.delete(active.socketId);
      return next;
    });
    setViewerDismissed(true);
  };

  /* SCREEN-PRIVATE-LIVE: правый щелчок по СВОЕЙ демонстрации открывает
     настройки приватности. У чужой трансляции контекстное меню не трогаем. */
  const openPrivacyMenu = (e: React.MouseEvent) => {
    if (!active.isLocal) return;
    e.preventDefault();
    setPrivacyAt({ x: e.clientX, y: e.clientY });
  };

  const privacyPanel = privacyAt && active.isLocal ? (
    <ScreenSharePrivacyModal
      anchor={privacyAt}
      heading="Кто видит ваш экран"
      submitLabel="Применить"
      initialPrivate={voice.isScreenPrivate}
      initialUserIds={voice.screenAllowUserIds}
      viewers={viewers}
      onClose={() => setPrivacyAt(null)}
      onStart={(allowUserIds) => {
        setPrivacyAt(null);
        void voice.updateScreenAllow(allowUserIds);
      }}
    />
  ) : null;

  /* Свёрнуто в плашку в двух случаях: зритель сам закрыл просмотр либо ушёл в
     другой канал. Во втором случае разворачиваем не во весь экран, а в мини —
     человек сейчас читает переписку, и накрывать её нельзя. Плашка стоит слева
     снизу: справа внизу живёт мини-виджет голосового канала. */
  const collapsedByChannel = !onVoiceChannel && mode === "full";
  if ((viewerDismissed || collapsedByChannel) && bannerHidden) return null;
  if (viewerDismissed || collapsedByChannel) {
    const title = collapsedByChannel
      ? "Идёт трансляция"
      : isViewer ? "Вернуться к демонстрации" : "Вернуться к вашей демонстрации";
    const note = collapsedByChannel
      ? `${active.isLocal ? "Вы демонстрируете экран" : `${active.userName} демонстрирует экран`} · нажмите, чтобы смотреть`
      : isViewer ? `${active.userName} продолжает показ` : "Экран по-прежнему транслируется участникам";
    return createPortal(
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        /* Плашка ставится внутрь области контента, а не в угол окна: в левом
           нижнем углу приложения живут строка голосового канала и кнопка
           приглашения — плашка садилась прямо на них. */
        className="fixed z-[77] h-12 max-w-[340px] rounded-xl border border-white/10 bg-neutral-900/95 shadow-2xl px-3 flex items-center gap-3 text-left text-white"
        style={areaRect
          ? { left: areaRect.left + 16, top: areaRect.top + areaRect.height - 64 }
          : { left: 20, bottom: 20 }}
      >
        <button
          type="button"
          onClick={() => { setViewerDismissed(false); setMode("mini"); }}
          className="flex items-center gap-3 min-w-0 text-left"
        >
          <span className="w-8 h-8 rounded-lg bg-violet-500/20 dark:bg-cyan-400/15 inline-flex items-center justify-center text-violet-300 dark:text-cyan-300 relative shrink-0">
            <Icon name="return" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          </span>
          <span className="min-w-0">
            <strong className="text-xs block truncate">{title}</strong>
            <span className="text-[10px] text-white/45 block truncate">{note}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setBannerHidden(true)}
          title="Убрать напоминание"
          aria-label="Убрать напоминание о трансляции"
          className="shrink-0 h-7 px-2 rounded-lg text-[10px] text-white/45 hover:text-white hover:bg-white/10 inline-flex items-center"
        >
          Скрыть
        </button>
      </motion.div>,
      document.body,
    );
  }

  if (mode === "mini") {
    // FIX-SS-PIP: обычное мини-окно внутри приложения. Из него два действия:
    // развернуть во весь экран или закрыть просмотр (стримеру — остановить).
    return createPortal(
      <motion.section
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="fixed right-5 bottom-5 z-[77] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-white/10 bg-neutral-950 shadow-2xl"
        style={miniPos ? { left: miniPos.x, top: miniPos.y, right: "auto", bottom: "auto" } : undefined}
      >
        <div
          onPointerDown={onMiniDragStart}
          title="Перетащите за шапку, чтобы переместить окно"
          className="h-9 px-2.5 flex items-center gap-2 bg-neutral-900 border-b border-white/10 cursor-move select-none touch-none"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          <span className="text-[11px] text-white truncate flex-1">{active.userName} · демонстрация</span>
          <button type="button" onClick={() => setMode("full")} title="Во весь экран" className="w-7 h-7 rounded-lg text-white/55 hover:text-white hover:bg-white/10 inline-flex items-center justify-center"><Icon name="full" /></button>
          <button type="button" onClick={stopOrExit} title={canStop ? "Остановить демонстрацию" : "Прекратить просмотр"} className="w-7 h-7 rounded-lg text-red-300 hover:bg-red-500/15 inline-flex items-center justify-center"><Icon name={canStop ? "stop" : "exit"} /></button>
        </div>
        <div className="relative aspect-video bg-black" onContextMenu={openPrivacyMenu}>
          <video
            ref={attachVideo}
            autoPlay
            muted
            playsInline
            className={`absolute inset-0 w-full h-full object-contain transition-[filter] duration-300 ${awaitingConsent ? "blur-xl scale-105" : ""}`}
          />
          {consentOverlay}
          <span className="absolute left-2 bottom-2 px-2 py-1 rounded-md bg-black/70 text-[9px] text-white/70">Мини-режим · звук продолжается</span>
        </div>
        {privacyPanel}
      </motion.section>,
      document.body,
    );
  }

  // Полноэкранный режим — единственный «развёрнутый» вид демонстрации.
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed z-[76] flex items-center justify-center bg-black/85"
      style={areaRect
        ? { left: areaRect.left, top: areaRect.top, width: areaRect.width, height: areaRect.height }
        : { inset: 0 }}
    >
      <motion.section initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", damping: 28, stiffness: 260 }} className="pointer-events-auto w-full h-full rounded-none border-0 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[#111315] shadow-2xl">
        <header className="h-[52px] min-h-[52px] px-3.5 flex items-center gap-3 border-b border-white/10 bg-[#171a1d]">
          <span className="w-2 h-2 shrink-0 rounded-full bg-red-400 animate-pulse" />
          {/* FIX-SHAREHEAD: шапка — три блока: точка, текст, кнопки. Средний
              блок не растягивался, и вторая строка («Зрителей пока нет») уезжала
              вправо, упираясь в кнопки. */}
          <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
            <strong className="text-xs text-white block truncate">
              {active.userName} демонстрирует экран
              {active.isLocal && voice.isScreenPrivate && (
                <span className="ml-1.5 text-[9px] font-medium text-amber-300">приватно</span>
              )}
            </strong>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] leading-none text-white/40">
              <span className="whitespace-nowrap">LIVE · {quality}</span>
              {/* SCREEN-VIEWERS: кто смотрит прямо сейчас. У ведущего это
                  кнопка: управление доступом раньше пряталось за шестерёнкой и
                  правым щелчком, и половина о нём не догадывалась. */}
              {active.isLocal ? (
                <button
                  type="button"
                  onClick={(e) => setPrivacyAt({ x: e.clientX, y: e.clientY })}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-[3px] leading-none text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  {viewers.length > 0 ? `Зрителей: ${viewers.length} · кто именно` : "Зрителей пока нет"}
                </button>
              ) : (
                <span className="inline-flex max-w-full items-center truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-[3px] leading-none text-white/55">
                  {viewers.length > 0
                    ? `Зрителей: ${viewers.length} · ${viewers.map((v) => v.userName).join(", ")}`
                    : "Зрителей пока нет"}
                </span>
              )}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* SCREEN-PRIVATE-LIVE: правый щелчок по картинке делает то же самое,
                но кнопка нужна — иначе о возможности никто не догадается. */}
            {active.isLocal && (
              <button
                type="button"
                onClick={(e) => setPrivacyAt({ x: e.clientX, y: e.clientY })}
                title="Кто видит ваш экран"
                aria-label="Настройки приватности показа"
                className="w-8 h-8 rounded-lg text-white/55 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center"
              >
                <Icon name="gear" />
              </button>
            )}
            {/* FIX-SHARECAM: камера рядом с остальными кнопками показа. */}
            <button
              type="button"
              onClick={toggleCameraWithConfirm}
              disabled={!voice.isConnected || cameraBusy}
              title={!voice.isConnected ? "Сначала подключитесь к голосовому каналу" : voice.isCameraOn ? "Выкл. камеру" : "Вкл. камеру"}
              aria-label="Камера"
              className={`w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors disabled:opacity-40 ${voice.isCameraOn ? "bg-white/15 text-white" : "text-white/55 hover:text-white hover:bg-white/[0.06]"}`}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cameraBusy ? "animate-pulse" : undefined}>
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
                {!voice.isCameraOn && !cameraBusy && <line x1="2" y1="3" x2="22" y2="21" />}
              </svg>
            </button>
            <button type="button" onClick={() => setMode("mini")} title="Свернуть в мини-окно" className="w-8 h-8 rounded-lg text-white/55 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center"><Icon name="mini" /></button>
            <button type="button" onClick={stopOrExit} title={canStop ? "Остановить демонстрацию" : "Прекратить просмотр"} className="w-8 h-8 rounded-lg text-red-300 hover:bg-red-500/15 inline-flex items-center justify-center"><Icon name={canStop ? "stop" : "exit"} /></button>
          </div>
        </header>

        <div className="flex-1 min-h-0 flex gap-3 p-3">
          <main
            className="relative flex-1 min-w-0 min-h-0 overflow-hidden rounded-lg border border-white/10 bg-black"
            onContextMenu={openPrivacyMenu}
          >
            <video
              ref={attachVideo}
              autoPlay
              muted
              playsInline
              className={`absolute inset-0 w-full h-full object-contain transition-[filter] duration-300 ${awaitingConsent ? "blur-2xl scale-105" : ""}`}
            />
            {consentOverlay}
            <AnimatePresence>
              {launching && !awaitingConsent && (
                <motion.div key={active.socketId} initial={{ opacity: 1 }} exit={{ opacity: 0 }} className="tz-share-launch-fx">
                  <i className="tz-share-ring tz-share-ring-1" /><i className="tz-share-ring tz-share-ring-2" /><i className="tz-share-ring tz-share-ring-3" />
                  <i className="tz-share-scan" />
                  <div className="tz-share-launch-card"><span className="tz-share-launch-icon"><Icon name="mini" /></span><strong>Подключаем демонстрацию</strong><small>Защищённый видеопоток готов</small></div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="absolute left-3 bottom-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/65 text-[10px] text-white/70">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              {active.isLocal
                ? voice.isScreenPrivate
                  ? "Приватный показ · правый клик — настройки"
                  : "Экран доступен участникам · правый клик — настройки"
                : "Экран доступен участникам"}
            </div>
          </main>

          <aside className="hidden lg:flex w-56 xl:w-64 shrink-0 flex-col gap-2 min-h-0">
            <div className="rounded-lg border border-white/10 bg-[#171a1d] p-3">
              <div className="text-[9px] uppercase tracking-[0.12em] text-white/35 mb-2">Трансляция</div>
              <div className="flex items-center gap-2 text-[11px] text-white/75"><span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_10px_rgba(74,222,128,.6)]" />{quality}</div>
              <div className="mt-2 text-[9px] text-white/35">{streamLabel} · авто</div>
              {/* Статистика показывается всегда, а не только когда стало плохо:
                  цифра «потеряно 0%» — это подтверждение, что всё в порядке, и
                  ведущему не приходится гадать по чужим репликам в чате. */}
              {active.isLocal && voice.screenShareStats && (
                <div className={`mt-2 rounded-md border px-2 py-1.5 text-[9px] ${
                  voice.screenShareStats.lossPercent > 2
                    ? "border-amber-400/20 bg-amber-400/[0.08] text-amber-200/80"
                    : "border-white/10 bg-white/[0.03] text-white/45"
                }`}>
                  Потери кадров: {voice.screenShareStats.droppedFrames} ({voice.screenShareStats.lossPercent}%)
                </div>
              )}
              {/* Полная сетка: дорожка кодируется и уходит каждому зрителю
                  отдельно, поэтому после нескольких человек качество делится
                  между ними. Честнее сказать об этом заранее, чем оставить
                  ведущего гадать, почему картинка «поплыла». */}
              {active.isLocal && viewers.length > SCREEN_COMFORT_VIEWERS && (
                <div className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/[0.08] px-2 py-1.5 text-[9px] text-amber-200/80">
                  Зрителей {viewers.length}: поток отправляется каждому отдельно, качество делится между ними.
                </div>
              )}
            </div>
            <div className="rounded-lg border border-white/10 bg-[#171a1d] p-2.5 flex-1 min-h-0 overflow-y-auto">
              <div className="text-[9px] uppercase tracking-[0.12em] text-white/35 px-1 mb-2">Доступные экраны</div>
              <div className="grid grid-cols-1 gap-2">
                {shares.map((share) => (
                  <ShareTile
                    key={share.socketId}
                    share={share}
                    active={share.socketId === active.socketId}
                    /* Превью чужого показа тоже под размытием: иначе содержимое
                       видно в миниатюре, и согласие ничего не значит. */
                    blurred={!share.isLocal && !consented.has(share.socketId)}
                    onSelect={() => setActiveId(share.socketId)}
                  />
                ))}
              </div>
            </div>
          </aside>
        </div>

        <footer className="min-h-[70px] px-3 py-2.5 border-t border-white/10 bg-[#171a1d] flex items-center justify-center gap-2">
          <RoundButton title={voice.isMuted ? "Включить микрофон" : "Выключить микрофон"} danger={voice.isMuted} onClick={voice.toggleMute}><Icon name="mic" /></RoundButton>
          <RoundButton title={voice.isDeafened ? "Включить звук" : "Выключить звук"} danger={voice.isDeafened} onClick={voice.toggleDeafen}><Icon name="sound" /></RoundButton>
          <RoundButton title={voice.nsEnabled ? "Выключить шумоподавление" : "Включить шумоподавление"} active={voice.nsEnabled} onClick={voice.toggleNS}><Icon name="noise" /></RoundButton>
          <span className="w-px h-8 bg-white/10 mx-1" />
          <RoundButton title="Свернуть в мини-окно" onClick={() => setMode("mini")}><Icon name="mini" /></RoundButton>
          {/* Подпись, а не только иконка: «прекратить просмотр» отличалось от
              «выйти из канала» лишь всплывающей подсказкой, и найти его было
              нельзя. Текст говорит прямо, что произойдёт. */}
          <button
            type="button"
            onClick={stopOrExit}
            className="h-11 px-4 rounded-xl border border-red-400/30 bg-red-500/15 text-red-300 hover:bg-red-500/25 inline-flex items-center gap-2 text-xs font-medium transition-colors"
          >
            <Icon name={canStop ? "stop" : "exit"} />
            {canStop ? "Остановить показ" : "Прекратить просмотр"}
          </button>
          <span className="w-px h-8 bg-white/10 mx-1" />
          <RoundButton title="Выйти из голосового канала" danger onClick={() => { voice.leaveVoice(); setViewerDismissed(true); }}><Icon name="leave" /></RoundButton>
        </footer>
      </motion.section>
      {privacyPanel}
    </motion.div>,
    document.body,
  );
}

function ShareTile({ share, active, blurred, onSelect }: { share: ScreenShare; active: boolean; blurred: boolean; onSelect: () => void }) {
  const attachVideo = useAttachStream(share.stream);
  return (
    <button type="button" onClick={onSelect} className={`relative w-full aspect-video overflow-hidden rounded-lg border text-left transition-colors ${active ? "border-violet-400 dark:border-cyan-400 bg-violet-500/10 dark:bg-cyan-400/10" : "border-white/10 bg-black hover:border-white/25"}`}>
      <video ref={attachVideo} autoPlay muted playsInline className={`absolute inset-0 w-full h-full object-cover ${blurred ? "blur-md scale-110" : ""}`} />
      <span className="absolute inset-x-0 bottom-0 px-2 py-1 bg-black/70 text-[9px] text-white/75 truncate">{share.isLocal ? "Ваш экран" : share.userName}</span>
    </button>
  );
}
