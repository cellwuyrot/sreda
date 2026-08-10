/**
 * Тесты: кнопка обновления в углу окна.
 *
 * Кнопка появляется раз в несколько недель и живёт секунды — глазами такое не
 * проверяют. Худший случай, который здесь и закрывается: кнопка нажимаема,
 * когда ставить ещё нечего. Человек жмёт её посреди работы, приложение
 * закрывается — а обновления нет.
 */
import { describe, it, expect } from "vitest";
import { updateButtonView } from "./updateState";

describe("что видно на кнопке", () => {
  it("обновлять нечего — кнопки нет", () => {
    expect(updateButtonView({ status: "idle" }).visible).toBe(false);
  });

  it("ИНВАРИАНТ: пока идёт загрузка, кнопка не нажимается", () => {
    /* Ставить ещё нечего: нажатие закрыло бы приложение впустую. */
    const view = updateButtonView({ status: "downloading", version: "0.3.7", percent: 42 });
    expect(view).toMatchObject({ visible: true, enabled: false });
    expect(view.label).toContain("42%");
  });

  it("ФИКСАЦИЯ: без данных о ходе загрузки процентов нет", () => {
    /* «Загрузка обновления 0%» читается как зависшая загрузка, хотя это просто
       отсутствие данных: первое событие о ходе приходит не сразу. */
    expect(updateButtonView({ status: "downloading" }).label).toBe("Загрузка обновления");
  });

  it("проценты за пределами шкалы приводятся к ней", () => {
    expect(updateButtonView({ status: "downloading", percent: 140 }).label).toContain("100%");
    expect(updateButtonView({ status: "downloading", percent: -5 }).label).toContain("0%");
    expect(updateButtonView({ status: "downloading", percent: 41.6 }).label).toContain("42%");
    expect(updateButtonView({ status: "downloading", percent: Number.NaN }).label).toContain("0%");
  });

  it("файл на диске — кнопка нажимается и называет версию", () => {
    const view = updateButtonView({ status: "ready", version: "0.3.7" });
    expect(view).toMatchObject({ visible: true, enabled: true });
    expect(view.label).toBe("Обновить · 0.3.7");
  });

  it("версия неизвестна — кнопка всё равно работает", () => {
    /* Номер версии — украшение; отсутствие номера не повод прятать готовое
       обновление. */
    expect(updateButtonView({ status: "ready" })).toMatchObject({ enabled: true, label: "Обновить" });
  });
});
