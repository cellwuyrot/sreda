"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initUpdateButton = initUpdateButton;
/* Что показывать при каждом состоянии — в общем модуле, под тестами. */
const updateState_1 = require("../shared/updateState");
/**
 * UPD-BTN: кнопка обновления в верхнем правом углу окна.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * О готовом обновлении сообщало системное окно «Перезапустить сейчас?». Оно
 * всплывает поверх работы — посреди набора сообщения, посреди звонка — и
 * требует ответа, хотя ничего срочного не произошло: файл уже скачан и
 * подождёт сколько угодно. Отмахнулся один раз — и о новой версии больше
 * ничего не напоминает до следующего запуска.
 *
 * ── Как стало ───────────────────────────────────────────────────────────────
 *
 * В углу тихо появляется кнопка. Пока идёт загрузка — она серая и ничего не
 * просит; файл на диске — становится нажимаемой. Нажали — приложение
 * закрывается и открывается уже обновлённым, без мастера установки и без
 * вопросов. Не нажали — обновление встанет при следующем выходе, как и раньше.
 *
 * ── Почему кнопка не внутри системной полосы окна ───────────────────────────
 *
 * Полосу со «свернуть / развернуть / закрыть» рисует сама Windows, и чужих
 * кнопок в неё не поставить. Отдать её приложению целиком можно, но тогда мы
 * теряем перетаскивание окна за верх и разворот двойным щелчком — это заметно
 * хуже, чем кнопка на три десятка точек ниже. Поэтому кнопка прижата к тому же
 * правому верхнему углу, сразу под системными кнопками.
 *
 * Устройство то же, что было у прежней нижней плашки, и по тем же причинам:
 * оболочка показывает ЧУЖУЮ страницу, поэтому своё рисуется из preload,
 * прячется в Shadow DOM (стили страницы её не видят), задаётся через CSSOM (не
 * подпадает под Content-Security-Policy страницы) и переустанавливается
 * наблюдателем, если React вычистит узел при перерисовке.
 */
const HOST_ID = "trioz-desktop-update";
const COLOR = {
    idleBg: "rgba(18, 18, 28, 0.85)",
    readyBg: "#00d4ff",
    readyInk: "#06222b",
    muted: "#9aa3b5",
    border: "rgba(255, 255, 255, 0.12)",
};
let root = null;
let buttonEl = null;
let state = { status: "idle" };
let installFn = null;
/** Применить набор свойств через CSSOM — так их не блокирует CSP страницы. */
function css(el, styles) {
    for (const [prop, value] of Object.entries(styles))
        el.style.setProperty(prop, value);
}
function createHost() {
    const host = document.createElement("div");
    host.id = HOST_ID;
    root = host.attachShadow({ mode: "open" });
    buttonEl = document.createElement("button");
    buttonEl.type = "button";
    css(buttonEl, {
        position: "fixed",
        top: "8px",
        right: "12px",
        /* Выше всего, что может нарисовать страница: кнопка не должна прятаться за
           модальным окном приложения. */
        "z-index": "2147483647",
        display: "none",
        "align-items": "center",
        gap: "6px",
        height: "24px",
        padding: "0 10px",
        margin: "0",
        border: `1px solid ${COLOR.border}`,
        "border-radius": "999px",
        "font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        "font-size": "11px",
        "font-weight": "600",
        "line-height": "1",
        cursor: "default",
        "user-select": "none",
        background: COLOR.idleBg,
        color: COLOR.muted,
        "box-shadow": "0 2px 10px rgba(0, 0, 0, 0.35)",
    });
    buttonEl.addEventListener("click", () => {
        if (state.status !== "ready")
            return;
        /* Сразу гасим кнопку: установка занимает секунды, и второе нажатие за это
           время ничего хорошего не сделает. */
        buttonEl.disabled = true;
        buttonEl.textContent = "Установка…";
        installFn?.();
    });
    root.appendChild(buttonEl);
    return host;
}
function render() {
    if (!buttonEl)
        return;
    const view = (0, updateState_1.updateButtonView)(state);
    if (!view.visible) {
        css(buttonEl, { display: "none" });
        return;
    }
    buttonEl.disabled = !view.enabled;
    buttonEl.textContent = view.label;
    buttonEl.title = view.title;
    css(buttonEl, {
        display: "inline-flex",
        background: view.enabled ? COLOR.readyBg : COLOR.idleBg,
        color: view.enabled ? COLOR.readyInk : COLOR.muted,
        cursor: view.enabled ? "pointer" : "default",
    });
}
function attach() {
    if (!document.body)
        return;
    const existing = document.getElementById(HOST_ID);
    if (existing)
        return;
    document.body.appendChild(createHost());
    render();
}
/**
 * Показать кнопку и держать её живой.
 *
 * `subscribe` — обновления состояния из главного процесса, `initial` —
 * состояние на момент открытия страницы (обновление могло скачаться раньше, чем
 * она загрузилась), `install` — «поставить».
 */
function initUpdateButton(subscribe, initial, install) {
    installFn = install;
    const start = () => {
        attach();
        /* Страница живёт своей жизнью и может вычистить узел при перерисовке —
           возвращаем его на место. */
        const observer = new MutationObserver(() => {
            if (!document.getElementById(HOST_ID))
                attach();
        });
        if (document.body)
            observer.observe(document.body, { childList: true });
    };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    }
    else {
        start();
    }
    subscribe((next) => {
        state = next;
        render();
    });
    void initial()
        .then((next) => {
        /* Пришедшее по подписке новее запрошенного: не откатываем. */
        if (state.status === "idle") {
            state = next;
            render();
        }
    })
        .catch(() => {
        /* Не ответили — кнопки просто не будет до следующей проверки. */
    });
}
//# sourceMappingURL=updateButton.js.map