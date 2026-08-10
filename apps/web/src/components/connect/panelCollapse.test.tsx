import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  COLLAPSED_WIDTH,
  VIEW_TITLE,
  PanelChevron,
  CollapsedStrip,
} from "./panelCollapse";

describe("Константы panelCollapse", () => {
  it("COLLAPSED_WIDTH равен 60", () => {
    expect(COLLAPSED_WIDTH).toBe(60);
  });

  it("VIEW_TITLE содержит все три состояния", () => {
    expect(VIEW_TITLE.members).toBe("Участники");
    expect(VIEW_TITLE.sections).toBe("Разделы");
    expect(VIEW_TITLE.collapsed).toBe("Разделы");
  });
});

describe("PanelChevron", () => {
  it("рендерится без ошибок в раскрытом состоянии", () => {
    const { container } = render(<PanelChevron collapsed={false} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("применяет класс -rotate-90 в свёрнутом состоянии", () => {
    const { container } = render(<PanelChevron collapsed={true} />);
    const svg = container.querySelector("svg");
    // SVGAnimatedString: baseVal содержит строку классов
    expect(svg?.className.baseVal ?? svg?.getAttribute("class")).toContain("-rotate-90");
  });

  it("НЕ применяет класс -rotate-90 в раскрытом состоянии", () => {
    const { container } = render(<PanelChevron collapsed={false} />);
    const svg = container.querySelector("svg");
    const cls = svg?.className.baseVal ?? svg?.getAttribute("class") ?? "";
    expect(cls).not.toContain("-rotate-90");
  });
});

describe("CollapsedStrip", () => {
  it("рендерится как кнопка с подсказкой", () => {
    render(<CollapsedStrip onClick={() => {}} hint="Показать участников" />);
    const btn = screen.getByRole("button");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("title")).toBe("Показать участников");
  });

  it("вызывает onClick при клике", async () => {
    let clicked = false;
    render(<CollapsedStrip onClick={() => { clicked = true; }} hint="Тест" />);
    const btn = screen.getByRole("button");
    btn.click();
    expect(clicked).toBe(true);
  });
});
