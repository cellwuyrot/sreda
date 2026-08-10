import { BrowserWindow, screen } from "electron";
import { setVoiceActive } from "./recovery"; // разговор важнее автоперезагрузки
import path from "path";
import { getConfig } from "./config";
import { getMainWindow, focusMainWindow, isPipMode } from "./mainWindow";
import { IPC } from "../shared/constants";
import type { VoiceOverlayState } from "../shared/types";

/**
 * FIX-OVL: Discord-подобный оверлей голосового чата.
 *
 * Небольшое always-on-top окно у левого/правого края экрана. Появляется, как
 * только пользователь переключается из TrioZ в другое приложение (игру,
 * браузер и т.д.), находясь при этом в голосовом канале. Показывает участников
 * с индикацией речи/микрофона и, по желанию, живое превью демонстрации экрана.
 *
 * Ключевое отличие от прошлой версии: оверлей завязан не на «свёрнуто», а на
 * «TrioZ не в фокусе». Именно так ведёт себя оверлей Discord — он виден поверх
 * активного приложения, даже если окно TrioZ просто потеряло фокус, а не было
 * свёрнуто.
 *
 * Состояние приходит из renderer-процесса (VoiceOverlayBridge в веб-
 * приложении) через IPC.VOICE_OVERLAY_STATE примерно раз в секунду и сразу же
 * при изменении (кто-то заговорил, замьютился и т.п.).
 */

let overlayWindow: BrowserWindow | null = null;
let lastState: VoiceOverlayState | null = null;
/**
 * Пользователь скрыл оверлей крестиком. Держим его скрытым, пока он снова не
 * вернётся в TrioZ (окно получит фокус) или не перезайдёт в голосовой канал.
 */
let userDismissed = false;
/**
 * FIX-OVL-DRAG: позиция, в которую пользователь перетащил оверлей (за
 * шапку, -webkit-app-region: drag). Раньше окно нельзя было передвинуть:
 * syncOverlay вызывался каждую секунду (с каждым push состояния из
 * renderer) и принудительно возвращал окно в расчётную позицию. Теперь
 * мы позиционируем окно только перед показом, а позицию, выбранную
 * пользователем, запоминаем и восстанавливаем при следующих показах.
 */
let userPosition: { x: number; y: number } | null = null;

const OVERLAY_WIDTH = 300;
const OVERLAY_HEIGHT = 380;
const OVERLAY_MARGIN = 12;
// FIX-OVL-SIZE: пределы авто-высоты окна оверлея.
const OVERLAY_MIN_HEIGHT = 64;
const OVERLAY_MAX_HEIGHT = 600;
/**
 * FIX-OVL-SIZE: фактическая высота контента оверлея. Раньше окно всегда было
 * фиксированных 380px, а панель внутри — ниже; нижняя «пустая» часть окна
 * оставалась прозрачной, но перехватывала клики мыши (мёртвая зона поверх
 * игры/приложения). Теперь renderer меряет панель ResizeObserver-ом и шлёт
 * высоту сюда — окно всегда ровно по контенту, кликается только видимое.
 */
let contentHeight = OVERLAY_HEIGHT;

function currentHeight(): number {
  return Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, contentHeight));
}

function shouldShow(): boolean {
  const cfg = getConfig();
  if (!cfg.overlayEnabled) return false;
  if (userDismissed) return false;
  if (!lastState || !lastState.inVoice) return false;
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return false;
  // PiP-мини-окно уже показывает демонстрацию — оверлей не нужен.
  if (isPipMode()) return false;
  // Показываем, когда TrioZ НЕ в фокусе, т.е. пользователь сейчас в другом
  // приложении. `isFocused()` ложно и для свёрнутого, и для скрытого, и для
  // просто потерявшего фокус окна — ровно те случаи, когда нужен оверлей.
  return !win.isFocused();
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: false, // не отбирает фокус у игры/другого приложения
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "../../static/overlay/index.html")).catch(() => undefined);
  // FIX-OVL-DRAG: запоминаем позицию после перетаскивания, чтобы
  // восстанавливать её при последующих показах оверлея.
  win.on("moved", () => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    userPosition = { x, y };
  });
  win.on("closed", () => {
    overlayWindow = null;
  });
  return win;
}

function positionOverlay(win: BrowserWindow): void {
  // FIX-OVL-DRAG: если пользователь уже перетаскивал оверлей — восстанавливаем
  // его позицию, прижимая к рабочей области ближайшего дисплея, чтобы
  // окно не оказалось за пределами экрана (например, после отключения
  // второго монитора).
  const height = currentHeight(); // FIX-OVL-SIZE
  if (userPosition) {
    const area = screen.getDisplayNearestPoint(userPosition).workArea;
    const x = Math.min(Math.max(userPosition.x, area.x), area.x + area.width - OVERLAY_WIDTH);
    const y = Math.min(Math.max(userPosition.y, area.y), area.y + area.height - height);
    win.setBounds({ x, y, width: OVERLAY_WIDTH, height });
    return;
  }
  const { overlaySide } = getConfig();
  // Мультимонитор: показываем оверлей на том экране, где сейчас курсор — там же,
  // где пользователь смотрит игру/приложение, а не всегда на главном мониторе.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const x =
    overlaySide === "left"
      ? area.x + OVERLAY_MARGIN
      : area.x + area.width - OVERLAY_WIDTH - OVERLAY_MARGIN;
  const y = area.y + Math.round((area.height - height) / 3);
  win.setBounds({ x, y, width: OVERLAY_WIDTH, height });
}

function pushState(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const cfg = getConfig();
  const state = lastState
    ? { ...lastState, screenThumb: cfg.overlayShowScreen ? lastState.screenThumb : null }
    : null;
  overlayWindow.webContents.send(IPC.OVERLAY_STATE, state);
}

/** Пересчитать видимость оверлея. Вызывается при любом изменении состояния. */
export function syncOverlay(): void {
  // Пользователь вернулся в TrioZ — снимаем ручное скрытие: в следующий раз,
  // когда он снова уйдёт в другое приложение, оверлей появится опять.
  const focusWin = getMainWindow();
  if (focusWin && !focusWin.isDestroyed() && focusWin.isFocused()) {
    userDismissed = false;
  }

  if (shouldShow()) {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = createOverlayWindow();
      overlayWindow.webContents.once("did-finish-load", () => {
        pushState();
        if (overlayWindow && shouldShow()) {
          positionOverlay(overlayWindow);
          overlayWindow.showInactive();
        }
      });
    } else {
      // FIX-OVL-DRAG: позиционируем только перед показом скрытого окна.
      // Видимое окно не трогаем — иначе ежесекундный push состояния
      // сбрасывал бы позицию и делал перетаскивание невозможным.
      if (!overlayWindow.isVisible()) {
        positionOverlay(overlayWindow);
        overlayWindow.showInactive();
      }
      pushState();
    }
  } else if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide();
  }
}

/** Свежие данные о голосовом чате из renderer-процесса. */
export function updateVoiceOverlayState(state: VoiceOverlayState | null): void {
  /* Заодно сообщаем сторожу перезагрузок, идёт ли разговор: во время звонка
     самолечение тёмного экрана выбрасывало человека из голосового канала. */
  setVoiceActive(!!state?.inVoice);
  // Выход из голосового канала сбрасывает ручное скрытие — при следующем
  // заходе оверлей снова доступен.
  if (!state || !state.inVoice) userDismissed = false;
  lastState = state;
  syncOverlay();
}

/** Действие, запрошенное из окна оверлея. */
export function handleOverlayAction(action: string): void {
  if (action === "open-app") {
    focusMainWindow();
  } else if (action === "close") {
    // Пользователь скрыл оверлей вручную — прячем до возвращения в TrioZ или
    // повторного захода в голосовой канал (см. syncOverlay / updateVoiceOverlayState).
    userDismissed = true;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  }
}

/**
 * FIX-OVL-SIZE: окно оверлея сообщило фактическую высоту контента (панель +
 * отступы). Подгоняем высоту окна, сохраняя позицию верхнего левого угла,
 * чтобы под панелью не оставалось прозрачной кликабельной «мёртвой зоны».
 */
export function handleOverlayResize(rawHeight: number): void {
  const next = Math.round(Number(rawHeight));
  if (!Number.isFinite(next) || next <= 0) return;
  const clamped = Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, next));
  if (clamped === contentHeight) return;
  contentHeight = clamped;
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    const [x, y] = overlayWindow.getPosition();
    overlayWindow.setBounds({ x, y, width: OVERLAY_WIDTH, height: currentHeight() });
  }
}

export function destroyOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  overlayWindow = null;
}
