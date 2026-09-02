"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncOverlay = syncOverlay;
exports.updateVoiceOverlayState = updateVoiceOverlayState;
exports.handleOverlayAction = handleOverlayAction;
exports.handleOverlayResize = handleOverlayResize;
exports.handleOverlayMoveStart = handleOverlayMoveStart;
exports.handleOverlayMove = handleOverlayMove;
exports.handleOverlayMoveEnd = handleOverlayMoveEnd;
exports.destroyOverlay = destroyOverlay;
const electron_1 = require("electron");
const recovery_1 = require("./recovery"); // разговор важнее автоперезагрузки
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const mainWindow_1 = require("./mainWindow");
const constants_1 = require("../shared/constants");
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
let overlayWindow = null;
let lastState = null;
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
let userPosition = null;
/**
 * FIX-OVL-DRAG2: штатный `-webkit-app-region: drag` в этом окне неработоспособен,
 * и починить его нельзя — это следствие того, как окно показывается. Оверлей
 * всплывает через showInactive() поверх чужого полноэкранного приложения и
 * остаётся неактивным. Перетаскивание через app-region начинается в системном
 * обработчике несущего окна и требует, чтобы первый нажатый клик его активировал:
 * у неактивного always-on-top окна нажатие уходит на активацию, и перетаскивание
 * просто не начинается — со стороны это выглядит ровно как «веду мышью, а оно
 * стоит». Поэтому окно двигаем сами: шапка шлёт экранные координаты курсора,
 * а main ставит позицию. Побочная выгода: фокус у игры не отбирается вовсе.
 */
let dragOrigin = null;
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
function currentHeight() {
    return Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, contentHeight));
}
function shouldShow() {
    const cfg = (0, config_1.getConfig)();
    if (!cfg.overlayEnabled)
        return false;
    if (userDismissed)
        return false;
    if (!lastState || !lastState.inVoice)
        return false;
    const win = (0, mainWindow_1.getMainWindow)();
    if (!win || win.isDestroyed())
        return false;
    // PiP-мини-окно уже показывает демонстрацию — оверлей не нужен.
    if ((0, mainWindow_1.isPipMode)())
        return false;
    // Показываем, когда TrioZ НЕ в фокусе, т.е. пользователь сейчас в другом
    // приложении. `isFocused()` ложно и для свёрнутого, и для скрытого, и для
    // просто потерявшего фокус окна — ровно те случаи, когда нужен оверлей.
    return !win.isFocused();
}
function createOverlayWindow() {
    const win = new electron_1.BrowserWindow({
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT,
        frame: false,
        transparent: true,
        resizable: false,
        movable: true,
        // FIX-OVL-BTN: раньше здесь было `focusable: false` — именно из-за этого не
        // работали кнопки «расширить» и «закрыть». Нефокусируемое окно (на Windows это
        // стиль WS_EX_NOACTIVATE) не активируется по клику, и браузерный слой не доводит
        // до rendererа полную пару mousedown+mouseup — событие click просто не рождается,
        // поэтому обработчики в static/overlay/index.html никогда не вызывались (при этом
        // перетаскивание работало — его делает сама оболочка через -webkit-app-region,
        // поэтому со стороны выглядело «окно живое, а кнопки мёртвые»).
        //
        // Фокус у игры при этом не отбирается: окно показывается через showInactive()
        // (см. syncOverlay) — оно всплывает поверх без активации и забирает фокус
        // только тогда, когда пользователь сам по нему кликнул, то есть когда это и нужно.
        focusable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        webPreferences: {
            preload: path_1.default.join(__dirname, "../preload/overlay.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // FIX-OVL-THROTTLE: окно оверлея по своей природе НИКОГДА не получает фокус
            // (показывается через showInactive) и живёт поверх чужого полноэкранного
            // приложения. Без
            // этого флага Chromium троттлит его renderer как фоновую вкладку, поэтому
            // приходящие по IPC обновления состояния (индикация речи, мьют, живое
            // превью демонстрации экрана) переставали своевременно отрисовываться —
            // панель выглядела «зависшей» или пустой. Держим renderer оверлея всегда
            // активным.
            backgroundThrottling: false,
        },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path_1.default.join(__dirname, "../../static/overlay/index.html")).catch(() => undefined);
    // FIX-OVL-DRAG: запоминаем позицию после перетаскивания, чтобы
    // восстанавливать её при последующих показах оверлея.
    win.on("moved", () => {
        if (win.isDestroyed())
            return;
        const [x, y] = win.getPosition();
        userPosition = { x, y };
    });
    win.on("closed", () => {
        overlayWindow = null;
    });
    return win;
}
function positionOverlay(win) {
    // FIX-OVL-DRAG: если пользователь уже перетаскивал оверлей — восстанавливаем
    // его позицию, прижимая к рабочей области ближайшего дисплея, чтобы
    // окно не оказалось за пределами экрана (например, после отключения
    // второго монитора).
    const height = currentHeight(); // FIX-OVL-SIZE
    if (userPosition) {
        const area = electron_1.screen.getDisplayNearestPoint(userPosition).workArea;
        const x = Math.min(Math.max(userPosition.x, area.x), area.x + area.width - OVERLAY_WIDTH);
        const y = Math.min(Math.max(userPosition.y, area.y), area.y + area.height - height);
        win.setBounds({ x, y, width: OVERLAY_WIDTH, height });
        return;
    }
    const { overlaySide } = (0, config_1.getConfig)();
    // Мультимонитор: показываем оверлей на том экране, где сейчас курсор — там же,
    // где пользователь смотрит игру/приложение, а не всегда на главном мониторе.
    const area = electron_1.screen.getDisplayNearestPoint(electron_1.screen.getCursorScreenPoint()).workArea;
    const x = overlaySide === "left"
        ? area.x + OVERLAY_MARGIN
        : area.x + area.width - OVERLAY_WIDTH - OVERLAY_MARGIN;
    const y = area.y + Math.round((area.height - height) / 3);
    win.setBounds({ x, y, width: OVERLAY_WIDTH, height });
}
function pushState() {
    if (!overlayWindow || overlayWindow.isDestroyed())
        return;
    const cfg = (0, config_1.getConfig)();
    const state = lastState
        ? { ...lastState, screenThumb: cfg.overlayShowScreen ? lastState.screenThumb : null }
        : null;
    overlayWindow.webContents.send(constants_1.IPC.OVERLAY_STATE, state);
}
/** Пересчитать видимость оверлея. Вызывается при любом изменении состояния. */
function syncOverlay() {
    // Пользователь вернулся в TrioZ — снимаем ручное скрытие: в следующий раз,
    // когда он снова уйдёт в другое приложение, оверлей появится опять.
    const focusWin = (0, mainWindow_1.getMainWindow)();
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
        }
        else {
            // FIX-OVL-DRAG: позиционируем только перед показом скрытого окна.
            // Видимое окно не трогаем — иначе ежесекундный push состояния
            // сбрасывал бы позицию и делал перетаскивание невозможным.
            if (!overlayWindow.isVisible()) {
                positionOverlay(overlayWindow);
                overlayWindow.showInactive();
            }
            pushState();
        }
    }
    else if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        overlayWindow.hide();
    }
}
/** Свежие данные о голосовом чате из renderer-процесса. */
function updateVoiceOverlayState(state) {
    /* Заодно сообщаем сторожу перезагрузок, идёт ли разговор: во время звонка
       самолечение тёмного экрана выбрасывало человека из голосового канала. */
    (0, recovery_1.setVoiceActive)(!!state?.inVoice);
    // Выход из голосового канала сбрасывает ручное скрытие — при следующем
    // заходе оверлей снова доступен.
    if (!state || !state.inVoice)
        userDismissed = false;
    lastState = state;
    syncOverlay();
}
/**
 * Действие, запрошенное из окна оверлея (кнопки ⤔ и ✕ в его шапке).
 *
 * FIX-OVL-BTN: раньше оба действия были половинчатыми:
 * • «расширить» только поднимало окно, но не открывало Коннект: если человек ушёл
 *   в настройки/новости, он там и оказывался, а не в голосовом канале;
 * • «закрыть» прятало оверлей только до следующего захода в канал и НЕ было
 *   связано с переключателем «Оверлей (десктоп)» в настройках профиля,
 *   поэтому оверлей возвращался сам собой и выглядело как «закрытие не работает».
 */
function handleOverlayAction(action) {
    if (action === "open-app") {
        // «Расширить» = показать полноценный Коннект с голосовым каналом, в котором
        // человек сейчас сидит. Само подключение живёт в rendererе, поэтому рвать его
        // перезагрузкой нельзя: navigate() шлёт мягкий переход по IPC.NAVIGATE.
        // Если Коннект и так открыт — ничего не трогаем и просто поднимаем окно,
        // чтобы не сбить выбранное сообщество/канал.
        const win = (0, mainWindow_1.getMainWindow)();
        let onConnect = false;
        if (win && !win.isDestroyed()) {
            try {
                onConnect = new URL(win.webContents.getURL()).pathname === "/connect";
            }
            catch {
                onConnect = false;
            }
        }
        if (!onConnect)
            (0, mainWindow_1.navigate)("/connect");
        (0, mainWindow_1.focusMainWindow)();
    }
    else if (action === "close") {
        // «Закрыть» = выключить оверлей насовсем, а не «до следующего раза». Пишем
        // overlayEnabled: false в тот же сохраняемый конфиг, из которого читает и пишет
        // переключатель «Оверлей (десктоп)» в настройках профиля, — так крестик и
        // переключатель всегда показывают одно и то же состояние. Включить обратно —
        // тем же переключателем в настройках.
        userDismissed = true;
        (0, config_1.updateConfig)({ overlayEnabled: false });
        if (overlayWindow && !overlayWindow.isDestroyed())
            overlayWindow.hide();
    }
}
/**
 * FIX-OVL-SIZE: окно оверлея сообщило фактическую высоту контента (панель +
 * отступы). Подгоняем высоту окна, сохраняя позицию верхнего левого угла,
 * чтобы под панелью не оставалось прозрачной кликабельной «мёртвой зоны».
 */
function handleOverlayResize(rawHeight) {
    const next = Math.round(Number(rawHeight));
    if (!Number.isFinite(next) || next <= 0)
        return;
    const clamped = Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, next));
    if (clamped === contentHeight)
        return;
    contentHeight = clamped;
    /* FIX-OVL-DRAG2: пока окно ведут мышью, чужие setBounds запрещены: перестановка
       границ в середине жеста выдёргивает окно из-под курсора. Новая высота
       запомнена и применится по окончании перетаскивания. */
    if (dragOrigin)
        return;
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        const [x, y] = overlayWindow.getPosition();
        overlayWindow.setBounds({ x, y, width: OVERLAY_WIDTH, height: currentHeight() });
    }
}
/**
 * FIX-OVL-DRAG2: начало жеста. Запоминаем точку захвата и текущий угол окна,
 * чтобы вести окно по разнице, а не пригвождать его угол к курсору: иначе окно
 * прыгает в момент нажатия тем сильнее, чем дальше от угла взялись.
 */
function handleOverlayMoveStart(pointerX, pointerY) {
    if (!overlayWindow || overlayWindow.isDestroyed())
        return;
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY))
        return;
    const [winX, winY] = overlayWindow.getPosition();
    dragOrigin = { pointerX, pointerY, winX, winY };
}
/** FIX-OVL-DRAG2: шаг жеста — окно едет за курсором с той же разницей. */
function handleOverlayMove(pointerX, pointerY) {
    if (!dragOrigin || !overlayWindow || overlayWindow.isDestroyed())
        return;
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY))
        return;
    const height = currentHeight();
    const nextX = Math.round(dragOrigin.winX + (pointerX - dragOrigin.pointerX));
    const nextY = Math.round(dragOrigin.winY + (pointerY - dragOrigin.pointerY));
    /* Не даём увести окно за край рабочей области: оттуда его не вернуть мышью,
       а шапка — единственное место захвата. Оставляем видимой хотя бы полоску. */
    const area = electron_1.screen.getDisplayNearestPoint({ x: pointerX, y: pointerY }).workArea;
    const x = Math.min(Math.max(nextX, area.x - OVERLAY_WIDTH + 80), area.x + area.width - 80);
    const y = Math.min(Math.max(nextY, area.y), area.y + area.height - 40);
    overlayWindow.setBounds({ x, y, width: OVERLAY_WIDTH, height });
}
/** FIX-OVL-DRAG2: конец жеста. Позицию запишет обработчик `moved`. */
function handleOverlayMoveEnd() {
    dragOrigin = null;
    if (!overlayWindow || overlayWindow.isDestroyed())
        return;
    const [x, y] = overlayWindow.getPosition();
    userPosition = { x, y };
    /* Высота, пришедшая пока вели окно, была отложена — применяем её теперь. */
    const height = currentHeight();
    const bounds = overlayWindow.getBounds();
    if (bounds.height !== height)
        overlayWindow.setBounds({ x, y, width: OVERLAY_WIDTH, height });
}
function destroyOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed())
        overlayWindow.destroy();
    overlayWindow = null;
}
//# sourceMappingURL=overlay.js.map