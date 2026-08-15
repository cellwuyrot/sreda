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
/* ═══════════════════════════════════════════════════════════════════
   FIX-BLANK2: почему трёх уровней выше оказалось мало

   Все три сторожа — лечение ПОСЛЕ того, как человек увидел чёрное окно, и каждый
   из них промахивается в своём случае:

   • уровень 1 срабатывает только при смене версии КЛИЕНТА. Но сервер выкатывается
     гораздо чаще, чем обновляется десктоп: версия та же, сборка другая;
   • уровень 2 ждёт 404 на /_next/static/*. Если старый HTML и старые чанки лежат в
     кеше вместе (а они там и лежат вместе: `immutable`, год хранения), сетевого
     запроса не будет вовсе — и 404 не придёт никогда. Старый код бодро запускается
     и умирает уже на общении с новым сервером (другие payload build id,
     несовпадение RSC-потока) — белый экран без единого 404;
   • уровень 3 считал страницу живой при ЛЮБОМ `svg`/`img` в DOM. А упавшее дерево
     React обычно оставляет в разметке каркас с одной-двумя иконками — проверка
     отвечала «всё хорошо» на том самом чёрном экране, который должна была поймать.

   Отсюда три добавления ниже: запрет кешировать сам HTML (лечит причину),
   честная проверка «интерфейс есть» и тихое обслуживание кеша раз в 15 минут.
   ══════════════════════════════════════════════════════════════════ */

/**
 * Уровень 0 — лечение причины, а не последствий.
 *
 * Сам HTML-документ — единственный файл, который в этой схеме нельзя брать из
 * кеша: именно он содержит список чанков конкретной сборки. Статика с хешем в
 * имени может и должна кешироваться годами — её не трогаем, иначе каждый запуск
 * тянул бы весь код заново.
 *
 * Стоит это одного условного запроса на открытие окна: документ всё равно
 * отдаётся Next.js без тяжёлой работы, а цена ошибки — нерабочее приложение до
 * ручной чистки кеша.
 */
export function preventDocumentCaching(appOrigin: string): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${appOrigin}/*`] },
    (details, callback) => {
      if (details.resourceType === "mainFrame") {
        details.requestHeaders["Cache-Control"] = "no-cache";
        details.requestHeaders["Pragma"] = "no-cache";
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

/**
 * Отрисован ли интерфейс на самом деле.
 *
 * Проверяем не «есть хоть что-то в DOM», а признаки живого приложения: видимый
 * текст или сколько-нибудь развесистое дерево с элементами управления. Одинокая
 * иконка на пустом фоне — это и есть тот самый чёрный экран.
 */
async function rendererLooksAlive(win: BrowserWindow): Promise<boolean> {
  if (win.isDestroyed()) return true;
  try {
    return (await win.webContents.executeJavaScript(
      `(() => {
         const b = document.body;
         if (!b) return false;
         const text = (b.innerText || "").replace(/\s+/g, "").length;
         const controls = b.querySelectorAll("button, a[href], input, textarea, canvas").length;
         return text > 20 || controls >= 3;
       })()`,
      true,
    )) as boolean;
  } catch {
    /* Окно закрылось или JS не выполнить — лучше не лечить, чем перезагрузить вслепую. */
    return true;
  }
}

/**
 * Тихое обслуживание кеша раз в 15 минут.
 *
 * Делает ровно то, что человек делает руками, но без него и без перезагрузки:
 * выкидывает из кеша всё, что успело там осесть. Открытая страница от этого не
 * страдает: её код уже в памяти, а картинки и аватары живут в отдельном
 * локальном кеше (mediaCache), который здесь не трогается.
 *
 * Заодно — осмотр окна: если интерфейса нет, человек сейчас смотрит на чёрный
 * прямоугольник — такое лечится перезагрузкой сразу.
 *
 * Чего здесь сознательно НЕТ: периодической перезагрузки «на всякий случай». Она
 * сносит дерево React вместе с VoiceProvider, то есть выбрасывает из разговора и теряет
 * недописанное сообщение — цена выше пользы.
 */
const CACHE_MAINTENANCE_MS = 15 * 60 * 1000;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

export function startCacheMaintenance(win: BrowserWindow): void {
  stopCacheMaintenance();
  maintenanceTimer = setInterval(() => {
    void runCacheMaintenance(win);
  }, CACHE_MAINTENANCE_MS);
}

export function stopCacheMaintenance(): void {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}

async function runCacheMaintenance(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) {
    stopCacheMaintenance();
    return;
  }
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({ urls: [] });
  } catch (err) {
    console.warn("[recovery] плановая чистка кеша не удалась:", err);
  }
  /* Перезагружаем только то, что и так уже не работает. */
  if (await rendererLooksAlive(win)) {
    markRenderHealthy();
    return;
  }
  await clearCacheAndReload(win, "плановая проверка: интерфейс не отрисован");
}

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
      /* FIX-BLANK2: раньше считалось, что хватит любого svg/img. Но упавшее дерево
         React оставляет в разметке каркас с парой иконок — и сторож отвечал
         «отрисовано» на том самом чёрном экране. */
      rendererLooksAlive(win)
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
