"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateButtonView = updateButtonView;
function updateButtonView(state) {
    if (state.status === "ready") {
        return {
            visible: true,
            enabled: true,
            label: state.version ? `Обновить · ${state.version}` : "Обновить",
            title: "Приложение перезапустится обновлённым. Займёт пару секунд.",
        };
    }
    if (state.status === "downloading") {
        /* Проценты показываем, только когда они есть: «Загрузка обновления 0%»
           выглядит как зависшая загрузка, хотя это просто отсутствие данных. */
        const percent = typeof state.percent === "number" ? ` ${clampPercent(state.percent)}%` : "";
        return {
            visible: true,
            enabled: false,
            label: `Загрузка обновления${percent}`,
            title: "Новая версия скачивается в фоне",
        };
    }
    return { visible: false, enabled: false, label: "", title: "" };
}
function clampPercent(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}
//# sourceMappingURL=updateState.js.map