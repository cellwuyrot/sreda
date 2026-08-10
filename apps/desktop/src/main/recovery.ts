import { app, session, BrowserWindow } from "electron";
import Store from "electron-store";

/**
 * FIX-BLANK: восстановление после «тёмного экрана».
 *
 * Симптом: окно открывается почти-чёрным (виден только `backgroundColor`
 * главного окна), заголовок при этом правильный — «TZ.Connect — Мессенджер
 * Т.Р.И.О.Z». Лечилось только полным удалением и переустановкой приложения.
 *
 * Причина: Electron держит HTTP-кеш на диске (в userData), а веб-часть — это
 * Next.js, который на каждую сборку генерирует НОВЫЕ имена чанков
 * (`/_next/static/chunks/<hash>.js`) и удаляет старые. nginx отдаёт эти файлы с
 * `Cache-Control: public, max-age=31536000, immutable`. Если в кеше осел HTML
 * прошлой сборки, после обновления сервера он ссылается на чанки, которых на
 * сервере уже нет: HTML грузится успешно (поэтому `title` правильный и ни
 * `did-fail-load`, ни проверка 5xx в mainWindow не срабатывают), а весь JS
 * отдаёт 404 — React не монтируется, страница остаётся пустой. Переустановка
 * «помогала» только потому, что удаляла userData вместе с кешем.
 *
 * Три уровня защиты:
 *  1. `invalidateCacheOnVersionChange` — после автообновления клиента кеш кода
 *     сбрасывается на старте (сборка сменилась → старым чанкам верить нельзя);
 *  2. `watchStaleAssets` — ловим 404 на `/_next/static/*`: это точная подпись
 *     устаревшего HTML, чистим кеш и перезагружаем без него;
 *  3. `watchBlankRender` — страховка от любой другой причины: если через
 *     несколько секунд после загрузки в DOM нет ни одного элемента приложения,
 *     перезагружаемся с чистым кешем.
 *
 * ВАЖНО: чистим только HTTP-кеш (`clearCache`), но НЕ `clearStorageData` —
 * иначе удалятся cookie сессии NextAuth и пользователя выбросит из аккаунта.
 */

const store = new Store<{ cacheAppVersion: string }>({
  name: "recovery",
  defaults: { cacheAppVersion: "" },
});

/** Сколько ждать монтирования React после загрузки страницы. */
const BLANK_CHECK_DELAY_MS = 6000;

/** Чтобы не попасть в цикл «перезагрузка → пусто → перезагрузка». */
let recoveriesDone = 0;
const MAX_RECOVERIES = 2;

/** Сбросить счётчик после успешного рендера (следующий сбой снова лечим). */
export function markRenderHealthy(): void {
  recoveriesDone = 0;
}

/* ── Разговор важнее самолечения ──────────────────────────────────────
 *
 * Перезагрузка окна сносит дерево React вместе с VoiceProvider, то есть
 * выбрасывает человека из голосового канала. Обычно это оправдано: чинить
 * тёмный экран больше нечем. Но один случай оказался массовым и обидным.
 *
 * Сервер обновляется — Next.js генерирует чанки с новыми именами и удаляет
 * старые. Открытая страница продолжает работать: её код уже в памяти. А вот
 * переход в раздел, который ещё не загружался (настройки, админка, панель
 * канала), тянет чанк ПРОШЛОЙ сборки, получает 404 — и сторож ниже честно
 * лечит «устаревший HTML» перезагрузкой. Со стороны это выглядит так: сидишь
 * в голосовом канале, открываешь настройки — и вылетаешь из разговора.
 *
 * Поэтому во время разговора автоматическая перезагрузка откладывается.
 * Кеш чистится сразу (он ничего не ломает), а сама перезагрузка ждёт конца
 * звонка. Ручная перезагрузка из трея проходит всегда: её попросил человек.
 *
 * О разговоре main-процесс узнаёт из состояния оверлея, которое веб-часть
 * присылает примерно раз в секунду (см. overlay.ts). Если сигналы прекратились
 * (вкладка умерла, окно перезагрузилось), через VOICE_SIGNAL_TTL_MS считаем,
 * что разговора нет: иначе одна потерянная отправка навсегда запретила бы
 * лечение тёмного экрана. */

const VOICE_SIGNAL_TTL_MS = 10_000;
const PENDING_CHECK_MS = 2000;

let voiceSignalAt = 0;
let pendingRecovery: { win: BrowserWindow; reason: string } | null = null;
let pendingTimer: ReturnType<typeof setInterval> | null = null;

function isVoiceActive(): boolean {
  return voiceSignalAt > 0 && Date.now() - voiceSignalAt < VOICE_SIGNAL_TTL_MS;
}

/** Идёт ли сейчас разговор — нужно и окну, чтобы не гасить его навигацией. */
export function voiceCallActive(): boolean {
  return isVoiceActive();
}

/** Сообщить, идёт ли сейчас разговор. Зовётся из overlay.ts. */
export function setVoiceActive(active: boolean): void {
  voiceSignalAt = active ? Date.now() : 0;
  if (!active) flushPendingRecovery();
}

function flushPendingRecovery(): void {
  const pending = pendingRecovery;
  if (!pending) return;
  pendingRecovery = null;
  if (pendingTimer) {
    clearInterval(pendingTimer);
    pendingTimer = null;
  }
  if (pending.win.isDestroyed()) return;
  void clearCacheAndReload(pending.win, `${pending.reason}; разговор закончился`, { force: true });
}

function armPendingWatch(): void {
  if (pendingTimer) return;
  pendingTimer = setInterval(() => {
    if (!isVoiceActive()) flushPendingRecovery();
  }, PENDING_CHECK_MS);
}

/**
 * Очистить HTTP-кеш и перезагрузить страницу мимо кеша.
 * Cookie и localStorage не трогаем — сессия пользователя сохраняется.
 */
export async function clearCacheAndReload(
  win: BrowserWindow,
  reason: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (win.isDestroyed()) return;

  if (!opts?.force && isVoiceActive()) {
    // Кеш чистим сразу — это безопасно и к перезагрузке готовит.
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({ urls: [] });
    } catch { /* не смертельно: перезагрузим позже всё равно */ }
    pendingRecovery = { win, reason };
    armPendingWatch();
    console.warn(`[recovery] ${reason} — идёт разговор, перезагрузку откладываем до его конца`);
    return;
  }

  if (recoveriesDone >= MAX_RECOVERIES) {
    console.warn(`[recovery] ${reason} — лимит попыток исчерпан, оставляем как есть`);
    return;
  }
  recoveriesDone += 1;
  console.warn(`[recovery] ${reason} — чистим кеш и перезагружаем (попытка ${recoveriesDone})`);
  try {
    await session.defaultSession.clearCache();
    // Скомпилированный кеш JS живёт отдельно от HTTP-кеша: без его сброса
    // Chromium может подтянуть код удалённого чанка из code cache.
    await session.defaultSession.clearCodeCaches({ urls: [] });
  } catch (err) {
    console.error("[recovery] не удалось очистить кеш:", err);
  }
  if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
}

/**
 * Уровень 1. После обновления клиента (electron-updater) сбрасываем кеш кода
 * один раз: версия приложения сменилась, значит сборка веб-части почти
 * наверняка тоже — старые чанки в кеше уже мусор.
 */
export async function invalidateCacheOnVersionChange(): Promise<void> {
  const current = app.getVersion();
  const seen = store.get("cacheAppVersion");
  if (seen === current) return;
  store.set("cacheAppVersion", current);
  if (!seen) return; // первая установка — кеша ещё нет, чистить нечего
  console.log(`[recovery] версия изменилась ${seen} → ${current}: сбрасываем HTTP-кеш`);
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({ urls: [] });
  } catch (err) {
    console.error("[recovery] сброс кеша при смене версии не удался:", err);
  }
}

/**
 * Уровень 2. 404 на статике Next.js — точная подпись устаревшего HTML в кеше.
 * Одного такого ответа достаточно: чиним сразу, не дожидаясь таймера.
 */
export function watchStaleAssets(win: BrowserWindow, appOrigin: string): void {
  session.defaultSession.webRequest.onCompleted({ urls: [`${appOrigin}/_next/static/*`] }, (details) => {
    if (details.statusCode !== 404) return;
    void clearCacheAndReload(win, `статика сборки отдала 404 (${details.url})`);
  });
}

/**
 * Уровень 3. Страховка: через {@link BLANK_CHECK_DELAY_MS} после загрузки
 * проверяем, смонтировалось ли приложение. Пустой `<body>` (нет ни одного
 * элемента с текстом) означает, что рендер не состоялся.
 */
export function watchBlankRender(win: BrowserWindow, appOrigin: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  win.webContents.on("did-start-loading", cancel);

  win.webContents.on("did-finish-load", () => {
    cancel();
    const url = win.isDestroyed() ? "" : win.webContents.getURL();
    // Локальный splash — не наш случай: он рисуется намеренно и пуст по тексту.
    if (!url.startsWith(appOrigin)) return;

    timer = setTimeout(() => {
      timer = null;
      if (win.isDestroyed()) return;
      win.webContents
        .executeJavaScript(
          // Приложение считается отрисованным, если в DOM есть непустой текст
          // или хотя бы canvas/svg (голосовой оверлей, splash самой веб-части).
          `(() => {
             const b = document.body;
             if (!b) return false;
             const hasText = (b.innerText || "").trim().length > 0;
             const hasVisual = !!b.querySelector("canvas, svg, img");
             return hasText || hasVisual;
           })()`,
          true,
        )
        .then((rendered: boolean) => {
          if (rendered) {
            markRenderHealthy();
            return;
          }
          void clearCacheAndReload(win, "страница загрузилась, но интерфейс не отрисовался");
        })
        .catch(() => {
          /* окно закрылось или JS не выполнить — молча выходим */
        });
    }, BLANK_CHECK_DELAY_MS);
  });

  win.on("closed", cancel);
}
