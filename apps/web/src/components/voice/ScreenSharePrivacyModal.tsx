"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useVoice } from "@/contexts/VoiceContext";
import { getDesktopApi, type DesktopScreenSource } from "@/lib/desktop";
import InfoTooltip from "@/components/ui/InfoTooltip";

type SourcesState = "idle" | "loading" | "ready" | "error";

/**
 * SCREEN-PRIVATE: выбор режима показа перед стартом демонстрации.
 *
 * «Всем в канале» — прежнее поведение. «Приватно» — трансляцию видят только
 * отмеченные участники: остальным не приходит даже событие о её начале, а
 * ведущий физически не добавляет им видеодорожку (см. VoiceContext).
 *
 * SCREEN-PRIVATE-LIVE: та же панель обслуживает и УЖЕ ИДУЩИЙ показ. Ведущий
 * вызывает её правым щелчком по своему окну демонстрации (или шестерёнкой в
 * шапке) — тогда передаётся `anchor` с координатами курсора, начальные значения
 * берутся из текущего состояния трансляции, а подтверждение зовёт
 * `updateScreenAllow` вместо старта. В этом режиме окно не затемняет экран:
 * ведущий должен видеть то, что показывает.
 *
 * `withQuality` включает блок качества — им пользуется окно ЗАПУСКА показа.
 * Раньше разрешение, частоту кадров и звук можно было выбрать только в нативном
 * окне десктоп-оболочки, а в браузере — вообще никак: значение лежало в
 * localStorage, и записывал его лишь тот самый нативный выбор. То есть
 * веб-версия навсегда оставалась на 720p/30, а после появления этого окна
 * человек видел вопрос «кому видно» и не видел ни источника, ни качества.
 * Выбор источника (окно, вкладка, весь экран) остаётся за системным диалогом —
 * список окон браузеру недоступен, поэтому здесь только сказано, где он будет.
 */
export default function ScreenSharePrivacyModal({
  onClose,
  onStart,
  anchor,
  initialPrivate = false,
  initialUserIds = null,
  heading = "Демонстрация экрана",
  submitLabel = "Начать показ",
  viewers,
  withQuality = false,
}: {
  onClose: () => void;
  /**
   * Подтверждение. `sourceId` — выбранный экран или окно; в браузере его нет,
   * там источник спрашивает системный диалог.
   */
  onStart: (allowUserIds: string[] | null, sourceId?: string | null) => void;
  /** Координаты курсора: панель открывается рядом с ними, а не по центру. */
  anchor?: { x: number; y: number };
  initialPrivate?: boolean;
  initialUserIds?: string[] | null;
  heading?: string;
  submitLabel?: string;
  /** Кто смотрит прямо сейчас — показывается только для живого показа. */
  viewers?: { userId: string; userName: string }[];
  /** Показать выбор качества и звука: нужен только перед запуском показа. */
  withQuality?: boolean;
}) {
  const voice = useVoice();
  const { data: session } = useSession();
  const myUserId = (session?.user as { id?: string } | undefined)?.id;
  const [isPrivate, setIsPrivate] = useState(initialPrivate);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialUserIds ?? []));

  /* Источники (экраны и окна) умеет перечислять только оболочка: браузеру
     список окон ОС недоступен, там его показывает системный диалог. Читаем
     после монтирования — на сервере window нет, а расхождение разметки дало бы
     ошибку гидратации. */
  const [shellSources, setShellSources] = useState(false);
  const [sources, setSources] = useState<DesktopScreenSource[]>([]);
  const [sourcesState, setSourcesState] = useState<SourcesState>("idle");
  const [sourceId, setSourceId] = useState<string | null>(null);
  /* Список снимается один раз при открытии: окна за это время открывают и
     закрывают, поэтому нужна кнопка «Обновить». */
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!withQuality) return;
    const api = getDesktopApi();
    if (!api?.getScreenSources) {
      setShellSources(false);
      return;
    }
    setShellSources(true);
    let alive = true;
    setSourcesState("loading");
    api.getScreenSources()
      .then((list) => {
        if (!alive) return;
        setSources(list);
        setSourcesState("ready");
        /* Сразу выбираем целый экран: показывают чаще всего его, и лишний клик
           ни к чему. Прошлый выбор сохраняем, если он ещё жив. */
        setSourceId((prev) =>
          prev && list.some((s) => s.id === prev)
            ? prev
            : list.find((s) => s.isScreen)?.id ?? list[0]?.id ?? null,
        );
      })
      .catch(() => { if (alive) setSourcesState("error"); });
    return () => { alive = false; };
  }, [withQuality, reloadTick]);

  const quality = voice.screenShareQuality;

  // Участники канала, кроме себя: показывать экран самому себе незачем.
  const candidates = voice.users.filter((u) => u.userId !== myUserId);
  const watching = new Set((viewers ?? []).map((v) => v.userId));

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  /* Приватный показ без адресатов бессмысленен, а показ без источника в
     оболочке невозможен: там системного диалога дальше не будет. */
  const canStart = (!isPrivate || selected.size > 0) && (!shellSources || !!sourceId);

  /* Панель у курсора: прижимаем к окну, чтобы не выехала за край. */
  const anchoredStyle = anchor
    ? {
        left: Math.min(Math.max(anchor.x, 12), Math.max(12, window.innerWidth - 340)),
        top: Math.min(Math.max(anchor.y, 12), Math.max(12, window.innerHeight - 430)),
      }
    : undefined;

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] p-4 ${anchor ? "" : "flex items-center justify-center bg-black/70"}`}
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      {/* С блоком качества окно стало выше: на низком экране оно должно
          прокручиваться, а не уезжать кнопками за край. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        /* FIX-SHAREWIDE: у панели у курсора ширина фиксированная. В строке
           классов рядом стояли w-full и w-[320px]; порядок классов ничего не
           решает, побеждал w-full — и окно «Кто видит ваш экран»
           растягивалось на всю ширину приложения. */
        className={`rounded-2xl border border-white/10 bg-[#171a1d] p-5 shadow-2xl ${
          anchor
            ? "absolute w-[320px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto"
            : `w-full max-h-[calc(100vh-2rem)] overflow-y-auto ${shellSources && withQuality ? "max-w-xl" : "max-w-sm"}`
        }`}
        style={anchoredStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-white">
          {heading}
          <InfoTooltip
            side="bottom"
            className="ml-1"
            text={
              withQuality
                ? `Здесь настраивается качество картинки, звук и то, кто увидит ваш экран.${shellSources ? "" : " Что именно показывать — окно, вкладку или экран целиком — спросит системный диалог уже после «Начать показ»."}`
                : "Здесь выбирается, кто увидит ваш экран."
            }
          />
        </h2>

        {viewers && (
          <p className="mt-2 text-[11px] text-white/40">
            {viewers.length > 0
              ? `Смотрят сейчас: ${viewers.map((v) => v.userName).join(", ")}`
              : "Пока никто не смотрит"}
          </p>
        )}

        {/* Источник. Раньше эта сетка жила в отдельном окне оболочки, которое
            открывалось ВТОРЫМ — после того, как здесь уже спросили качество и
            приватность. Одни и те же вопросы задавались дважды. */}
        {withQuality && shellSources && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-white/60">Что показать</span>
              <button
                type="button"
                onClick={() => setReloadTick((t) => t + 1)}
                className="text-[11px] text-white/40 hover:text-white/70"
              >
                Обновить список
              </button>
            </div>

            {sourcesState === "loading" && (
              <p className="mt-2 text-[11px] text-white/40">Смотрим, что открыто…</p>
            )}
            {sourcesState === "error" && (
              <p className="mt-2 text-[11px] text-amber-400/80">
                Не удалось получить список окон. Попробуйте обновить.
              </p>
            )}
            {sourcesState === "ready" && sources.length === 0 && (
              <p className="mt-2 text-[11px] text-white/40">Нет доступных источников для показа.</p>
            )}

            {sources.length > 0 && (
              <div className="mt-2 grid max-h-60 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSourceId(s.id)}
                    onDoubleClick={() => { if (canStart) onStart(isPrivate ? Array.from(selected) : null, s.id); }}
                    className={`overflow-hidden rounded-xl border text-left transition-colors ${
                      sourceId === s.id
                        ? "border-cyan-400/70 bg-cyan-400/10"
                        : "border-white/10 hover:bg-white/5"
                    }`}
                  >
                    {/* Превью приходит data-URL от оболочки: обычный img, без
                        оптимизатора Next — оптимизировать тут нечего. */}
                    <img src={s.thumbnail} alt="" className="aspect-video w-full bg-black/40 object-cover" />
                    <span className="flex items-center gap-1.5 px-2 py-1.5">
                      <span className="flex-none rounded bg-white/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-white/60">
                        {s.isScreen ? "Экран" : "Окно"}
                      </span>
                      <span className="min-w-0 truncate text-[11px] text-white/80">{s.name}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {withQuality && (
          <div className="mt-4 space-y-2.5 rounded-xl border border-white/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-white/60">Разрешение</span>
              <div className="flex gap-1.5">
                {([720, 1080] as const).map((res) => (
                  <QualityPill
                    key={res}
                    label={`${res}p`}
                    active={quality.resolution === res}
                    locked={!voice.isPremium && res !== 720}
                    onClick={() => voice.setScreenShareQuality({ resolution: res, fps: quality.fps })}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-white/60">Кадры в секунду</span>
              <div className="flex gap-1.5">
                {([30, 60] as const).map((fps) => (
                  <QualityPill
                    key={fps}
                    label={`${fps}`}
                    active={quality.fps === fps}
                    locked={!voice.isPremium && fps !== 30}
                    onClick={() => voice.setScreenShareQuality({ resolution: quality.resolution, fps })}
                  />
                ))}
              </div>
            </div>

            {!voice.isPremium && (
              <p className="text-[11px] text-white/40">1080p и 60 кадров — в подписке Premium</p>
            )}

            {/* FIX-SS-ECHO: звук трансляции — осознанный выбор, по умолчанию
                «Без звука». Оболочка умеет отдать только ВЕСЬ звук системы
                (Electron/Chromium не даёт захватить звук одного приложения), а в
                системный микс попадают голоса собеседников, которые проигрывает
                сам TZ.Connect, — и они возвращаются к людям эхом. Поэтому звук
                включается вручную и с явным предупреждением. */}
            <div className="border-t border-white/10 pt-2.5">
              <span className="flex items-center text-xs text-white/60">
                Звук трансляции
                <InfoTooltip
                  className="ml-1"
                  text="Демонстрируется картинка экрана; звук идёт отдельной дорожкой. В десктоп-оболочке доступен «Системный звук» — это весь звук компьютера целиком, только на Windows (звук отдельного приложения захватывать пока нельзя). Захват звука конкретного приложения появится позже."
                />
              </span>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <AudioChoice
                  label="Без звука"
                  hint="Только картинка"
                  active={!voice.screenAudioEnabled}
                  onClick={() => voice.setScreenAudioEnabled(false)}
                />
                <AudioChoice
                  label="Системный звук"
                  hint="Весь звук ПК"
                  active={voice.screenAudioEnabled}
                  onClick={() => voice.setScreenAudioEnabled(true)}
                />
              </div>
              {voice.screenAudioEnabled && (
                <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-200/90">
                  Уйдёт весь звук компьютера, включая голоса других участников — они услышат себя в трансляции. Включайте только при необходимости и слушайте через наушники, иначе будет эхо.
                </p>
              )}
            </div>

          </div>
        )}

        {withQuality && <p className="mt-4 text-xs text-white/60">Кому видно</p>}

        <div className={`${withQuality ? "mt-2" : "mt-4"} space-y-2`}>
          <button
            type="button"
            onClick={() => setIsPrivate(false)}
            className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
              !isPrivate ? "border-cyan-400/60 bg-cyan-400/10 text-white" : "border-white/10 text-white/70 hover:bg-white/5"
            }`}
          >
            Все в канале
            <span className="mt-0.5 block text-[11px] text-white/40">Обычная трансляция</span>
          </button>
          <button
            type="button"
            onClick={() => setIsPrivate(true)}
            className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
              isPrivate ? "border-amber-400/60 bg-amber-400/10 text-white" : "border-white/10 text-white/70 hover:bg-white/5"
            }`}
          >
            Приватная
            <span className="mt-0.5 block text-[11px] text-white/40">Видят только выбранные участники</span>
          </button>
        </div>

        {isPrivate && (
          <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-white/10">
            {candidates.length === 0 ? (
              <p className="p-3 text-center text-xs text-white/40">В канале больше никого нет</p>
            ) : (
              candidates.map((u) => (
                <label
                  key={u.socketId}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-white/5 px-3 py-2 last:border-0 hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(u.userId)}
                    onChange={() => toggle(u.userId)}
                    className="h-4 w-4 accent-cyan-400"
                  />
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/80">
                    {u.userName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white/85">{u.userName}</span>
                  {watching.has(u.userId) && (
                    <span className="flex-none text-[10px] text-green-400">смотрит</span>
                  )}
                </label>
              ))
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/10 py-2 text-sm text-white/70 hover:bg-white/5"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!canStart}
            onClick={() => onStart(isPrivate ? Array.from(selected) : null, shellSources ? sourceId : null)}
            className="flex-1 rounded-xl bg-cyan-500 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

/**
 * FIX-SS-ECHO: одна из двух карточек выбора звука трансляции («Без звука» /
 * «Системный звук»). Оформлена как таблетки качества рядом, чтобы выбор читался
 * как единый переключатель, а не набор случайных кнопок.
 */
function AudioChoice({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
        active
          ? "border-cyan-400/60 bg-cyan-400/10 text-white"
          : "border-white/10 text-white/70 hover:bg-white/5"
      }`}
    >
      <span className="block text-xs">{label}</span>
      <span className="block text-[10px] text-white/40">{hint}</span>
    </button>
  );
}

/**
 * Кнопка-таблетка выбора качества. Вариант, закрытый тарифом, не нажимается и
 * объясняет причину подсказкой: скрывать его нельзя — иначе непонятно, что
 * качество вообще бывает выше.
 */
function QualityPill({
  label,
  active,
  locked,
  onClick,
}: {
  label: string;
  active: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      title={locked ? "Доступно в подписке Premium" : undefined}
      className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? "border-cyan-400/60 bg-cyan-400/10 text-white"
          : "border-white/10 text-white/70 hover:bg-white/5"
      } ${locked ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
    >
      {label}
    </button>
  );
}
