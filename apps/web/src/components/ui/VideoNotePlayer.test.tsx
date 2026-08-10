/**
 * Тесты: VideoNotePlayer — размер видеосообщения.
 *
 * Сторона квадрата была одна на всех — 176 пикселей. На телефоне это меньше
 * половины ширины экрана: лицо в кадре размером с ноготь. Теперь на узком
 * экране квадрат занимает ширину переписки, а на большом остаётся прежним.
 *
 * Здесь проверяется именно это разделение — и то, что квадрат остаётся
 * квадратом. Разъехаться легко: достаточно кому-то вернуть высоту в пикселях,
 * и на телефоне вместо квадрата получится полоса.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import VideoNotePlayer from "@/components/ui/VideoNotePlayer";

function box(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe("VideoNotePlayer: размер", () => {
  it("на телефоне ширина считается от экрана, а не в пикселях", () => {
    const { container } = render(<VideoNotePlayer url="/uploads/videos/a.webm" />);
    expect(box(container).className).toContain("w-[min(70vw,420px)]");
  });

  it("на большом экране размер прежний — 176 пикселей", () => {
    const { container } = render(<VideoNotePlayer url="/uploads/videos/a.webm" />);
    const el = box(container);
    expect(el.className).toContain("md:w-[var(--tz-note-size)]");
    expect(el.style.getPropertyValue("--tz-note-size")).toBe("176px");
  });

  it("размер для большого экрана можно задать снаружи", () => {
    const { container } = render(<VideoNotePlayer url="/uploads/videos/a.webm" size={240} />);
    expect(box(container).style.getPropertyValue("--tz-note-size")).toBe("240px");
  });

  it("ИНВАРИАНТ: высота следует за шириной — заметка остаётся квадратом", () => {
    /* Высота НЕ задаётся числом намеренно: на телефоне ширина резиновая, и
       фиксированная высота превратила бы квадрат в полосу. */
    const { container } = render(<VideoNotePlayer url="/uploads/videos/a.webm" />);
    const button = container.querySelector("button")!;
    expect(button.className).toContain("aspect-square");
    expect(button.className).toContain("w-full");
    expect(button.getAttribute("style")).toBeNull();
  });

  it("подпись кнопки на месте: заметку находят и без зрения", () => {
    const { container } = render(<VideoNotePlayer url="/uploads/videos/a.webm" />);
    expect(container.querySelector("button")!.getAttribute("aria-label")).toMatch(/видеосообщение/i);
  });
});
