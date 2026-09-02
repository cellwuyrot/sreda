"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupScreenShare = setupScreenShare;
const electron_1 = require("electron");
const constants_1 = require("../shared/constants");
/**
 * Демонстрация экрана в оболочке: разрешения и выдача выбранного источника.
 *
 * Раньше здесь жило собственное окно запуска: список окон с превью, таблетки
 * качества и переключатель звука. Оно появлялось ВТОРЫМ — веб-приложение к тому
 * времени уже спросило, что и кому показывать, — и человек отвечал на одни и те
 * же вопросы дважды. Окна больше нет: список источников уходит в приложение
 * (см. {@link IPC.GET_SCREEN_SOURCES}), выбор делается там же, где качество и
 * приватность, а сюда приходит готовый идентификатор источника.
 *
 * Без `setDisplayMediaRequestHandler` вызов `navigator.mediaDevices
 * .getDisplayMedia()` в Electron молча падает, поэтому обработчик обязателен —
 * теперь он просто отдаёт выбранное, ничего не спрашивая.
 */
/**
 * Контекст СЛЕДУЮЩЕГО показа: приложение присылает его прямо перед вызовом
 * `getDisplayMedia()`. Здесь лежит выбранный источник, качество и звук; до
 * первого сообщения держим безопасные значения бесплатного тарифа.
 */
let pendingContext = {
    isPremium: false,
    resolution: 720,
    fps: 30,
    audio: false,
    sourceId: null,
};
/** Приводит присланное к валидному контексту, прижатому к тарифу. */
function normalizeContext(raw) {
    const c = (raw ?? {});
    const isPremium = c.isPremium === true;
    // Обычный аккаунт не может выйти за 720p/30 — прижимаем и здесь: главный
    // процесс последний перед захватом, и доверять присланному нельзя.
    const resolution = isPremium && c.resolution === 1080 ? 1080 : 720;
    const fps = isPremium && c.fps === 60 ? 60 : 30;
    // FIX-SS-ECHO: системный (loopback) звук умеет только Windows, и это ВЕСЬ микс
    // вывода — в него попадают голоса собеседников, которые проигрывает сам
    // TZ.Connect, поэтому у зрителей они дублируются эхом. Захватить звук одного
    // приложения Electron/Chromium не умеет (см. обработчик ниже). Поэтому звук —
    // строго осознанный опт-ин: приложение по умолчанию присылает `audio: false`
    // (см. readScreenAudioPref в вебе) и включает его только по явному выбору
    // человека, с предупреждением в окне запуска.
    const audio = process.platform === "win32" && c.audio === true;
    const sourceId = typeof c.sourceId === "string" && c.sourceId ? c.sourceId : null;
    return { isPremium, resolution, fps, audio, sourceId };
}
/**
 * Разрешения, которые выдаём молча. Веб-приложению нужны микрофон (голосовые
 * каналы), камера, захват экрана и уведомления; остальное отклоняется.
 */
const GRANTED_PERMISSIONS = new Set([
    "media",
    "display-capture",
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
    "pointerLock",
]);
/** Параметры перечисления источников: превью нужны только для списка. */
const SOURCE_TYPES = ["screen", "window"];
function setupScreenShare() {
    const ses = electron_1.session.defaultSession;
    // Приложение присылает выбор перед запросом медиа.
    electron_1.ipcMain.handle(constants_1.IPC.PREPARE_SCREEN_SHARE, (_e, ctx) => {
        pendingContext = normalizeContext(ctx);
    });
    /**
     * Список источников для окна запуска в приложении. Отдаём превью как
     * data-URL: страница живёт на https, локальные файлы ей недоступны, а
     * пересылать кадры иным способом ради одного снимка незачем.
     */
    electron_1.ipcMain.handle(constants_1.IPC.GET_SCREEN_SOURCES, async () => {
        const sources = await electron_1.desktopCapturer.getSources({
            types: SOURCE_TYPES,
            thumbnailSize: { width: 480, height: 270 },
        });
        return sources.map((s) => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.toDataURL(),
            isScreen: s.id.startsWith("screen:"),
        }));
    });
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(GRANTED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => GRANTED_PERMISSIONS.has(permission));
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
        const requested = pendingContext;
        // Выбор одноразовый: следующий запрос без нового сообщения не должен
        // молча показать прошлое окно.
        pendingContext = { ...pendingContext, sourceId: null };
        try {
            // Перечисляем заново: между выбором и запросом окно могли закрыть.
            // Превью здесь не нужны — нужен только идентификатор.
            const sources = await electron_1.desktopCapturer.getSources({
                types: SOURCE_TYPES,
                thumbnailSize: { width: 0, height: 0 },
            });
            if (sources.length === 0) {
                callback({}); // нечего захватывать
                return;
            }
            let source = requested.sourceId
                ? sources.find((s) => s.id === requested.sourceId) ?? null
                : null;
            if (!source && !requested.sourceId) {
                // Источник не выбран — так ведёт себя только старая сборка веб-части.
                // Берём целый экран: подставить чужое ОКНО нельзя, показать не то,
                // что человек имел в виду, хуже отказа.
                source = sources.find((s) => s.id.startsWith("screen:")) ?? null;
            }
            if (!source) {
                // Выбранное окно закрылось. Отказываем — приложение покажет причину и
                // предложит выбрать источник заново.
                callback({});
                return;
            }
            // WASAPI-SS: звук ОС захватывается нативным WASAPI-аддоном в renderer-е
            // (PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE), а не через
            // Chromium-loopback. Chromium всегда получает только видео-дорожку,
            // иначе он захватывает ВЕСЬ системный микс включая голоса из TZ.Connect.
            callback({ video: source });
        }
        catch (err) {
            console.error("[screenShare] display media request failed:", err);
            callback({});
        }
    }, 
    // Свой выбор источника делается в приложении, системный не нужен.
    { useSystemPicker: false });
}
//# sourceMappingURL=screenShare.js.map