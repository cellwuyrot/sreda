"use client";

/**
 * DesktopCachePanel — панель управления кешем и данными в десктоп приложении.
 *
 * Отображается только при наличии `window.triozDesktop` (т.е. исключительно в Electron).
 *
 * Кнопки:
 *   1. «Очистить кеш»  — только HTTP/дисковый кеш Chromium.
 *                        Безопасно — куки и сессия не затрагиваются.
 *   2. «Сбросить всё»  — IndexedDB, localStorage, ServiceWorker, CacheStorage,
 *                        shadercache + диск кеш + куки.
 *                        После этого пользователь будет разлогинен.
 */

import { useState, useCallback, useRef, useEffect } from "react";

interface ExtendedDesktopApi {
  clearCache: () => Promise<void>;
  clearStorageData: (storages: string[]) => Promise<void>;
}

function getApi(): ExtendedDesktopApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as Record<string, unknown>).triozDesktop as ExtendedDesktopApi | undefined;
  if (!api || typeof api.clearCache !== "function") return null;
  return api;
}

// ── Spinner (CSS-анимация через <style>) ─────────────────────────────────────
const SPIN_STYLE = "tz-sp";

function SpinSvg() {
  return (
    <>
      <style>{`.${SPIN_STYLE}{animation:tz-spin .8s linear infinite}@keyframes tz-spin{to{transform:rotate(360deg)}}`}</style>
      <svg className={SPIN_STYLE} width={14} height={14} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-9-9" />
      </svg>
    </>
  );
}

function BroomSvg() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 22l4-4" />
      <path d="M13.5 6.5l4 4L10 18l-6-2 1-6 8.5-3.5z" />
      <path d="M15 3l6 6" />
    </svg>
  );
}

function TrashSvg() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function CheckSvg() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Хук для одиночного действия с состоянием ─────────────────────────────────
type BtnState = "idle" | "busy" | "done" | "error";

function useAsyncAction(fn: () => Promise<void>): [BtnState, () => void] {
  const [state, setState] = useState<BtnState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const run = useCallback(() => {
    if (state === "busy") return;
    setState("busy");
    fn()
      .then(() => {
        setState("done");
        timerRef.current = setTimeout(() => setState("idle"), 2500);
      })
      .catch(() => {
        setState("error");
        timerRef.current = setTimeout(() => setState("idle"), 3000);
      });
  }, [fn, state]);

  return [state, run];
}

// ── Строка-пункт в карточке ────────────────────────────────────────────────────
function Dot({ danger }: { danger?: boolean }) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
        danger ? "bg-red-400/70" : "bg-cyan-500/70"
      }`}
    />
  );
}

// ── Кнопка действия ───────────────────────────────────────────────────────────
interface ActionBtnProps {
  label: string;
  icon: React.ReactNode;
  state: BtnState;
  onClick: () => void;
  danger?: boolean;
}

function ActionBtn({ label, icon, state, onClick, danger }: ActionBtnProps) {
  const base = danger
    ? "border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-red-400"
    : "border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300";
  const done = "border-green-500/40 bg-green-500/10 text-green-400";
  const err  = "border-red-500/40 bg-red-500/10 text-red-400";

  const cls  = state === "done" ? done : state === "error" ? err : base;
  const text = state === "done" ? "Готово" : state === "error" ? "Ошибка" : label;
  const ico  = state === "done" ? <CheckSvg /> : state === "busy" ? <SpinSvg /> : icon;

  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={onClick}
      className={`w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all disabled:opacity-60 ${cls}`}
    >
      <span className="flex-shrink-0">{ico}</span>
      {text}
    </button>
  );
}

// ── Главный компонент ─────────────────────────────────────────────────────────
export default function DesktopCachePanel() {
  const api = getApi();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const clearCacheFn = useCallback(async () => {
    if (!api) throw new Error("no api");
    await api.clearCache();
  }, [api]);

  const [cacheState, runClearCache] = useAsyncAction(clearCacheFn);

  const handleReset = useCallback(async () => {
    if (!api) return;
    setResetBusy(true);
    setConfirmReset(false);
    try {
      await api.clearStorageData([
        "localstorage",
        "indexdb",
        "serviceworkers",
        "cachestorage",
        "shadercache",
        "cookies",
      ]);
      await api.clearCache();
      // Куки удалены — перезагрузка откроет страницу входа
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setResetBusy(false);
    }
  }, [api]);

  // Не Electron — не показываем
  if (!api) return null;

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 space-y-5">

      {/* Заголовок */}
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
          Кеш и данные приложения
        </h2>
        <p className="text-xs text-neutral-500 dark:text-gray-400 mt-1">
          Управление кешем Chromium и хранилищем данных десктоп приложения.
          Глубже, чем Ctrl&nbsp;+&nbsp;Shift&nbsp;+&nbsp;R.
        </p>
      </div>

      {/* Информационные карточки */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/5 bg-neutral-800/40 px-4 py-3">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Очистка кеша
          </p>
          <ul className="text-xs text-neutral-300 space-y-1">
            {["Изображения и шрифты", "Скрипты и стили", "Service Worker / CacheStorage", "Shader-кеш GPU"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Dot />{t}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-red-500/10 bg-red-500/5 px-4 py-3">
          <p className="text-xs font-semibold text-red-400/80 uppercase tracking-wider mb-2">
            Полный сброс
          </p>
          <ul className="text-xs text-neutral-300 space-y-1">
            {["Всё из очистки кеша", "localStorage и IndexedDB", "Куки сессии → выход из аккаунта"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Dot danger />{t}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Кнопки. Раньше они стояли лесенкой: безопасная у левого края,
          необратимая — ниже и у правого, подписи разной длины и высоты.
          Читалось как две ступени одного действия, а блок выглядел кривым.
          Теперь колонки повторяют карточки над ними: под «очисткой кеша» —
          её кнопка, под «полным сбросом» — его. Разнесены они по-прежнему,
          только по горизонтали, а не по диагонали. Подписи — ровно в две
          строки, поэтому колонки одинаковой высоты. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 items-start">

        {/* Безопасная очистка */}
        <div className="space-y-1.5">
          <ActionBtn
            label="Очистить кеш"
            icon={<BroomSvg />}
            state={cacheState}
            onClick={runClearCache}
          />
          <p className="text-xs text-neutral-500">
            <span className="block">Удаляет дисковый кеш.</span>
            <span className="block">Сессия и настройки сохраняются.</span>
          </p>
        </div>

        {/* Полный сброс с подтверждением. */}
        <div className="space-y-1.5">
          {!confirmReset ? (
            <div className="flex">
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-sm font-medium transition-all"
              >
                <TrashSvg />
                Сбросить всё и выйти
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-red-500/40 bg-red-500/10">
              <p className="text-sm text-red-300 flex-1 min-w-0">
                Все данные будут удалены, вы выйдете из аккаунта. Продолжить?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                >
                  {resetBusy && <SpinSvg />}
                  Да, сбросить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
          {!confirmReset && (
            <p className="text-xs text-neutral-500">
              <span className="block">Полное очищение хранилища и куки.</span>
              <span className="block">Приложение перезагрузится, вы выйдете из аккаунта.</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
