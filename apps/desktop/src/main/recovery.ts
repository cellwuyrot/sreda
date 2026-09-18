import { app, BrowserWindow, ipcMain, powerMonitor, session } from "electron";
import { IPC } from "../shared/constants";
import Store from "electron-store";
import path from "path";
import { pathToFileURL } from "url";

/** Восстановление — один цикл на окно, а не отдельный reload на каждый 404.
 * Cookie, localStorage и пользовательские файлы никогда не удаляются.
 */
const MAX_ATTEMPTS = 2;
const VOICE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 4_000;
const LOAD_TIMEOUT_MS = 30_000;
const STABLE_MS = 30_000;
const CHECK_INTERVAL_MS = 60_000;
export const RECOVERY_REQUEST = IPC.RECOVER_WINDOW;
const recoveryFile = path.join(__dirname, "../../static/recovery/index.html");
const recoveryFileUrl = pathToFileURL(recoveryFile).href;
const store = new Store<{ cacheAppVersion: string }>({ name: "recovery", defaults: { cacheAppVersion: "" } });

type Health = "healthy" | "unhealthy" | "unknown";
type Request = { reason: string; clearCache?: boolean; manual?: boolean };
type Options = {
  getStartUrl: () => string;
  beforeRecovery: () => void;
  onResume?: () => void;
};
type State = {
  win: BrowserWindow;
  options: Options;
  attempts: number;
  generation: number;
  busy: Promise<void> | null;
  pending: Request | null;
  failed: boolean;
  disposed: boolean;
  checking: boolean;
  badChecks: number;
  healthySince: number;
  httpStatus: number;
  timer: ReturnType<typeof setTimeout> | null;
  interval: ReturnType<typeof setInterval>;
  pendingWatch: ReturnType<typeof setInterval>;
  dispose: () => void;
};
const states = new Map<BrowserWindow, State>();
let voiceSignalAt = 0;
let ipcInstalled = false;

export function voiceCallActive(): boolean {
  return voiceSignalAt > 0 && Date.now() - voiceSignalAt < VOICE_TTL_MS;
}
export function setVoiceActive(active: boolean): void {
  voiceSignalAt = active ? Date.now() : 0;
  if (!active) for (const state of states.values()) flushPending(state);
}
function alive(state: State): boolean {
  return !state.disposed && !state.win.isDestroyed() && !state.win.webContents.isDestroyed();
}
function sameOrigin(state: State, url: string): boolean {
  try { return new URL(url).origin === new URL(state.options.getStartUrl()).origin; }
  catch { return false; }
}
function isFallback(state: State): boolean {
  return state.win.webContents.getURL().split(/[?#]/, 1)[0] === recoveryFileUrl;
}
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("recovery timeout")), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Ошибка/таймаут выполнения JS — неизвестное состояние, НЕ успех.
 * Одно неизвестное состояние не повод прерывать звонок или текущую навигацию.
 */
async function probe(state: State): Promise<Health> {
  if (!alive(state)) return "unknown";
  const wc = state.win.webContents;
  if (wc.isCrashed()) return "unhealthy";
  if (wc.isLoadingMainFrame() || !sameOrigin(state, wc.getURL())) return "unknown";
  if (state.httpStatus >= 400) return "unhealthy";
  const generation = state.generation;
  try {
    const result = await bounded(wc.executeJavaScript(`(() => {
      const body = document.body;
      if (!body || document.readyState === "loading") return false;
      const visible = (el) => {
        if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      };
      const controls = Array.from(body.querySelectorAll("button, a[href], input, textarea, [role=button]"));
      const messages = Array.from(body.querySelectorAll("h1, h2, p, [role=alert]"));
      return controls.some(visible) || messages.some((el) => visible(el) && (el.innerText || "").trim().length > 20);
    })()`), PROBE_TIMEOUT_MS);
    if (!alive(state) || generation !== state.generation) return "unknown";
    return result === true ? "healthy" : "unhealthy";
  } catch { return "unknown"; }
}
function noteHealthy(state: State): void {
  state.badChecks = 0;
  if (!state.healthySince) state.healthySince = Date.now();
  // Только реальный, устойчивый UI возвращает автоматический бюджет.
  if (Date.now() - state.healthySince >= STABLE_MS) state.attempts = 0;
}
function scheduleCheck(state: State, ms = 5_000): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => { state.timer = null; void check(state); }, ms);
}
async function check(state: State): Promise<void> {
  if (!alive(state) || state.busy || state.failed || state.checking) return;
  if (state.win.webContents.isLoadingMainFrame() || !sameOrigin(state, state.win.webContents.getURL())) return;
  state.checking = true;
  const generation = state.generation;
  try {
    const health = await probe(state);
    if (!alive(state) || generation !== state.generation || state.busy) return;
    if (health === "healthy") { noteHealthy(state); return; }
    state.healthySince = 0;
    state.badChecks += 1;
    if (state.badChecks < 2) { scheduleCheck(state); return; }
    void requestRecovery(state, { reason: `интерфейс недоступен (${health})` });
  } finally { state.checking = false; }
}
function flushPending(state: State): void {
  if (!state.pending || state.busy || voiceCallActive() || !alive(state)) return;
  const request = state.pending;
  state.pending = null;
  void requestRecovery(state, request);
}

async function clearCaches(win: BrowserWindow): Promise<void> {
  // Используем сессию именно этого окна, не глобальную defaultSession.
  await win.webContents.session.clearCache();
  await win.webContents.session.clearCodeCaches({ urls: [] });
}
async function showFailure(state: State): Promise<void> {
  if (!alive(state)) return;
  state.failed = true;
  state.pending = null;
  state.options.beforeRecovery();
  try { await bounded(state.win.loadFile(recoveryFile), LOAD_TIMEOUT_MS); }
  catch (err) { console.error("[recovery] локальный экран недоступен; используйте меню трея", err); }
}
async function reloadAndVerify(state: State, clearCache: boolean): Promise<boolean> {
  if (clearCache) {
    try { await bounded(clearCaches(state.win), 10_000); }
    catch (err) { console.warn("[recovery] очистка кеша не завершилась", err); }
  }
  if (!alive(state)) return false;
  const wc = state.win.webContents;
  const current = wc.getURL();
  const target = sameOrigin(state, current) ? current : state.options.getStartUrl();
  state.httpStatus = 0;
  try {
    // loadURL позволяет дождаться загрузки. no-cache заставляет перепроверить
    // документ; новая HTML-сборка указывает на новые хешированные чанки.
    await bounded(state.win.loadURL(target, { extraHeaders: "Cache-Control: no-cache\r\nPragma: no-cache\r\n" }), LOAD_TIMEOUT_MS);
  } catch { return false; }
  // Даём React время на гидратацию. Единственный did-finish-load не успех.
  for (let i = 0; i < 4 && alive(state); i += 1) {
    await delay(3_000);
    if (!alive(state)) return false;
    if (await probe(state) === "healthy") return true;
  }
  return false;
}
async function runRecovery(state: State, request: Request): Promise<void> {
  state.options.beforeRecovery();
  state.failed = false;
  state.healthySince = 0;
  state.badChecks = 0;
  // Ручное действие даёт новый бюджет, но не бесконечный цикл.
  if (request.manual) state.attempts = 0;
  while (alive(state) && state.attempts < MAX_ATTEMPTS) {
    if (!request.manual && voiceCallActive()) { state.pending = request; return; }
    state.attempts += 1;
    console.warn(`[recovery] ${request.reason}; попытка ${state.attempts}/${MAX_ATTEMPTS}`);
    if (await reloadAndVerify(state, request.clearCache === true)) {
      state.healthySince = Date.now();
      scheduleCheck(state, STABLE_MS);
      return;
    }
    if (alive(state) && state.attempts < MAX_ATTEMPTS) await delay(2_000);
  }
  if (!request.manual && voiceCallActive()) { state.pending = request; return; }
  if (alive(state)) await showFailure(state);
}
function requestRecovery(state: State, request: Request): Promise<void> {
  if (!alive(state)) return Promise.resolve();
  if (state.busy) return state.busy; // объединяем все 404/таймеры текущего цикла
  if (state.failed && !request.manual) return Promise.resolve();
  if (!request.manual && voiceCallActive()) {
    state.pending = { ...request, clearCache: request.clearCache || state.pending?.clearCache };
    return Promise.resolve();
  }
  state.pending = null;
  // Promise.then фиксирует busy ДО первого побочного эффекта/события loadURL.
  state.busy = Promise.resolve().then(() => runRecovery(state, request))
    .catch(async (err) => { console.error("[recovery] ошибка восстановления", err); await showFailure(state); })
    .finally(() => { state.busy = null; flushPending(state); });
  return state.busy;
}

/** Сетевая ошибка тоже проходит через отсрочку звонка, но не чистит кеш. */
export function recoverWindow(win: BrowserWindow, reason: string): Promise<void> {
  const state = states.get(win);
  return state ? requestRecovery(state, { reason }) : Promise.resolve();
}

/** Ручной путь используется треем и проверенным IPC, не внутренней отсрочкой. */
export function clearCacheAndReload(win: BrowserWindow, reason: string, opts?: { manual?: boolean }): Promise<void> {
  const state = states.get(win);
  return state ? requestRecovery(state, { reason, manual: opts?.manual, clearCache: true }) : Promise.resolve();
}
export function recoveryOwnsNavigation(win: BrowserWindow): boolean {
  const state = states.get(win);
  return !!state && (!!state.busy || state.failed);
}

export async function invalidateCacheOnVersionChange(): Promise<void> {
  const version = app.getVersion();
  const previous = store.get("cacheAppVersion");
  if (version === previous) return;
  try {
    if (previous) {
      // На старте окна ещё нет; только здесь используется defaultSession.
      await bounded(session.defaultSession.clearCache(), 10_000);
      await bounded(session.defaultSession.clearCodeCaches({ urls: [] }), 10_000);
    }
    // Не запоминаем успешную миграцию до фактического завершения очистки.
    store.set("cacheAppVersion", version);
  } catch (err) { console.warn("[recovery] кеш версии не обновлён; повторим при следующем запуске", err); }
}

/** Подписки устанавливаются один раз на окно и снимаются при его закрытии. */
export function installRecovery(win: BrowserWindow, options: Options): void {
  states.get(win)?.dispose();
  const state: State = {
    win, options, attempts: 0, generation: 0, busy: null, pending: null,
    failed: false, disposed: false, checking: false, badChecks: 0,
    healthySince: 0, httpStatus: 0, timer: null,
    interval: setInterval(() => { void check(state); }, CHECK_INTERVAL_MS),
    // Renderer может перестать слать voice=false. После TTL не ждём целую минуту.
    pendingWatch: setInterval(() => flushPending(state), 2_000),
    dispose: () => undefined,
  };
  states.set(win, state);
  const wc = win.webContents;
  const onStart = (): void => { state.generation += 1; state.healthySince = 0; state.badChecks = 0; };
  const onFinish = (): void => { if (!state.busy && !state.failed) scheduleCheck(state, 15_000); };
  const onNavigate = (_e: Electron.Event, url: string, status: number): void => {
    if (sameOrigin(state, url)) state.httpStatus = status;
  };
  const onGone = (_e: Electron.Event, details: Electron.RenderProcessGoneDetails): void => {
    voiceSignalAt = 0; // погибший renderer уже не может поддерживать звонок
    console.warn(`[recovery] render-process-gone: ${details.reason}, exit=${details.exitCode}`);
    if (state.failed) return; // ручной путь через трей остаётся доступен
    void requestRecovery(state, { reason: `renderer завершился (${details.reason})` });
  };
  const onUnresponsive = (): void => { state.healthySince = 0; scheduleCheck(state); };
  const onWake = (): void => {
    state.healthySince = 0;
    options.onResume?.();
    scheduleCheck(state, 5_000);
  };
  const onShow = (): void => { scheduleCheck(state, 2_000); };
  wc.on("did-start-loading", onStart);
  wc.on("did-finish-load", onFinish);
  wc.on("did-navigate", onNavigate);
  wc.on("render-process-gone", onGone);
  win.on("unresponsive", onUnresponsive);
  win.on("show", onShow);
  win.on("restore", onShow);
  win.on("focus", onShow);
  powerMonitor.on("resume", onWake);

  // Эти события webRequest глобальны для сессии: только один владелец главного
  // окна. Origin проверяется при каждом запросе, включая смену appUrl в настройках.
  const webRequest = wc.session.webRequest;
  webRequest.onBeforeSendHeaders({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    if (details.webContentsId === wc.id && details.resourceType === "mainFrame" && sameOrigin(state, details.url)) {
      details.requestHeaders["Cache-Control"] = "no-cache";
      details.requestHeaders.Pragma = "no-cache";
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  webRequest.onCompleted({ urls: ["http://*/*", "https://*/*"] }, (details) => {
    if (!alive(state) || details.webContentsId !== wc.id || details.statusCode !== 404 || !sameOrigin(state, details.url)) return;
    const pathname = new URL(details.url).pathname;
    if (pathname.startsWith("/_next/static/") && /\.(?:js|css)$/.test(pathname)) {
      // URL без query: не пишем токены и параметры пользователя в журнал.
      console.warn(`[recovery] устаревший ресурс: ${pathname}`);
      void requestRecovery(state, { reason: "404 ресурса веб-сборки", clearCache: true });
    }
  });
  state.dispose = () => {
    state.disposed = true;
    state.pending = null;
    win.removeListener("closed", state.dispose);
    if (state.timer) clearTimeout(state.timer);
    clearInterval(state.interval);
    clearInterval(state.pendingWatch);
    wc.removeListener("did-start-loading", onStart);
    wc.removeListener("did-finish-load", onFinish);
    wc.removeListener("did-navigate", onNavigate);
    wc.removeListener("render-process-gone", onGone);
    win.removeListener("unresponsive", onUnresponsive);
    win.removeListener("show", onShow);
    win.removeListener("restore", onShow);
    win.removeListener("focus", onShow);
    powerMonitor.removeListener("resume", onWake);
    webRequest.onBeforeSendHeaders(null);
    webRequest.onCompleted(null);
    states.delete(win);
  };
  win.once("closed", state.dispose);

  if (!ipcInstalled) {
    ipcInstalled = true;
    ipcMain.handle(RECOVERY_REQUEST, (event) => {
      const current = [...states.values()].find((s) => s.win.webContents === event.sender);
      // Только главное окно и главный frame нашего сайта/локальной ошибки.
      if (!current || !alive(current) || event.senderFrame !== event.sender.mainFrame) return false;
      const url = event.senderFrame.url;
      if (!sameOrigin(current, url) && !(current.failed && isFallback(current))) return false;
      void clearCacheAndReload(current.win, "ручная кнопка восстановления", { manual: true });
      return true;
    });
  }
}
export function stopRecovery(): void {
  for (const state of [...states.values()]) state.dispose();
}
