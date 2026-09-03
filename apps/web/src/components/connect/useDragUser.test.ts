/**
 * Тесты: useDragUser — перенос участника голосового канала перетаскиванием.
 *
 * Что здесь закреплено. Хук держал канал под курсором в состоянии React и
 * тот же `overChannelId` стоял в зависимостях эффекта с обработчиками. Первое
 * же движение курсора над каналом меняло состояние, эффект перезапускался, а
 * его функция очистки вызывала reset() — сеанс перетаскивания обрывался ровно
 * в момент, когда курсор доходил до цели. Внешне это выглядело так, будто
 * перетаскивание не поддерживается вовсе: тащишь — и ничего.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useDragUser } from "./useDragUser";

/** Зона сброса: узел с data-voice-channel-id, как его ставит боковая панель. */
function dropZone(channelId: string): HTMLElement {
  const el = document.createElement("div");
  el.dataset.voiceChannelId = channelId;
  document.body.appendChild(el);
  return el;
}

/** jsdom не считает раскладку — говорим прямо, что лежит под курсором. */
function pointAt(el: Element | null) {
  document.elementFromPoint = () => el as Element;
}

/** Событие указателя: в jsdom нет PointerEvent, а MouseEvent несёт координаты. */
function pointer(type: string, x: number, y: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

const DOWN = {
  pointerType: "mouse",
  button: 0,
  clientX: 10,
  clientY: 10,
  preventDefault: () => {},
  stopPropagation: () => {},
} as unknown as React.PointerEvent;

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDragUser", () => {
  it("перетаскивание на другой канал вызывает перенос", () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDragUser({ enabled: true, onMove }));

    act(() => {
      result.current.userRowProps("s1", "u1").onPointerDown?.(DOWN);
    });

    const target = dropZone("ch2");
    pointAt(target);
    act(() => pointer("pointermove", 60, 60));

    /* Канал под курсором подсвечивается — это видимая часть того же состояния. */
    expect(result.current.dragging).toEqual({ socketId: "s1", userId: "u1" });
    expect(result.current.overChannelId).toBe("ch2");

    act(() => pointer("pointerup", 60, 60));

    expect(onMove).toHaveBeenCalledWith("s1", "u1", "ch2");
    expect(result.current.dragging).toBeNull();
  });

  it("несколько каналов по пути: перенос идёт в тот, где отпустили", () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDragUser({ enabled: true, onMove }));

    act(() => {
      result.current.userRowProps("s1", "u1").onPointerDown?.(DOWN);
    });

    pointAt(dropZone("ch2"));
    act(() => pointer("pointermove", 60, 60));
    pointAt(dropZone("ch3"));
    act(() => pointer("pointermove", 90, 90));
    act(() => pointer("pointerup", 90, 90));

    expect(onMove).toHaveBeenCalledWith("s1", "u1", "ch3");
  });

  it("щелчок без движения переносом не считается", () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDragUser({ enabled: true, onMove }));

    act(() => {
      result.current.userRowProps("s1", "u1").onPointerDown?.(DOWN);
    });
    pointAt(null);
    act(() => pointer("pointerup", 10, 10));

    expect(onMove).not.toHaveBeenCalled();
  });

  it("отпускание мимо каналов ничего не переносит", () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDragUser({ enabled: true, onMove }));

    act(() => {
      result.current.userRowProps("s1", "u1").onPointerDown?.(DOWN);
    });
    pointAt(null);
    act(() => pointer("pointermove", 60, 60));
    act(() => pointer("pointerup", 60, 60));

    expect(onMove).not.toHaveBeenCalled();
  });

  it("выключенный хук не даёт даже начать", () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDragUser({ enabled: false, onMove }));

    expect(result.current.userRowProps("s1", "u1")).toEqual({});
    pointAt(dropZone("ch2"));
    act(() => pointer("pointermove", 60, 60));
    act(() => pointer("pointerup", 60, 60));

    expect(onMove).not.toHaveBeenCalled();
  });
});
