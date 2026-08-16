/**
 * Тесты: PremiumMark — значок «TZ», вход в окно Premium и VPN.
 *
 * Почему это вообще под тестом. В Android «не было функции VPN» — при том что
 * весь VPN давно написан и работает. Причина оказалась в одной строке разметки:
 * левая панель скрыта на узком экране (`max-md:hidden`), а единственный вход в
 * окно VPN стоял именно в ней. Функция была, дотянуться до неё было нечем.
 *
 * Отсюда то, что здесь закрепляется:
 *
 *   • значок — кнопка, а не украшение: у него есть обработчик нажатия;
 *   • подпись для чтения с экрана на месте — по ней вход находится вслепую;
 *   • раскраска зависит от подписки: это единственный признак, по которому
 *     видно, действует premium или нет.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/Providers", () => ({ useTheme: () => ({ theme: "cyber" }) }));

const { default: PremiumMark } = await import("@/components/connect/PremiumMark");

describe("PremiumMark", () => {
  it("это кнопка с понятной подписью, а не картинка", () => {
    render(<PremiumMark isPremium={false} />);
    const button = screen.getByRole("button", { name: /premium/i });
    expect(button).toBeTruthy();
    expect(button.textContent).toBe("TZ");
  });

  it("ИНВАРИАНТ: нажатие открывает окно — иначе входа в соединение снова не будет", () => {
    const onClick = vi.fn();
    render(<PremiumMark isPremium onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /premium/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("у подписчика значок золотой, без подписки — обычный акцент", () => {
    const { container: gold } = render(<PremiumMark isPremium />);
    const { container: plain } = render(<PremiumMark isPremium={false} />);
    const goldStyle = gold.querySelector("button")!.getAttribute("style") ?? "";
    const plainStyle = plain.querySelector("button")!.getAttribute("style") ?? "";
    expect(goldStyle).toContain("linear-gradient");
    expect(plainStyle).toContain("--cn-accent-dim");
    expect(goldStyle).not.toBe(plainStyle);
  });

  it("размер задаётся снаружи: в панели крупнее, в шапке телефона меньше", () => {
    /* Шапка на телефоне ниже панели, и значок в 44 пикселя её распирал. */
    const { container } = render(<PremiumMark isPremium={false} size={36} />);
    const style = container.querySelector("button")!.getAttribute("style") ?? "";
    expect(style).toContain("36px");
  });
});
