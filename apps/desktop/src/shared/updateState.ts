import type { DesktopUpdateState } from "./types";

/**
 * UPD-BTN: во что превращается состояние обновления на кнопке в углу окна.
 *
 * Вынесено из самой кнопки, потому что ошибиться тут легко, а заметить трудно:
 * кнопка появляется раз в несколько недель и живёт секунды. Худший случай —
 * нажимаемая кнопка, когда ставить ещё нечего: человек жмёт её посреди работы,
 * приложение закрывается, а обновления нет.
 */

export interface UpdateButtonView {
  /** Показывать ли кнопку вообще. */
  visible: boolean;
  /** Можно ли нажать: только когда файл уже на диске. */
  enabled: boolean;
  label: string;
  /** Подсказка при наведении. */
  title: string;
}

export function updateButtonView(state: DesktopUpdateState): UpdateButtonView {
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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
