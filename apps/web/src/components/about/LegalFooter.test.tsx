/**
 * Тесты: отображение правовой информации в подвале /about.
 *
 * Почему это под тестом. Было два места редактирования одного текста — блок
 * «Правовая информация» в редакторе «О проекте» и раздел «Контент сайта →
 * Правовая информация». Страница читала только блок, так что большой текст
 * из админки не показывался нигде, а без блока подвал был вовсе пуст.
 *
 * Закрепляется главное: текст есть всегда — до ответа API, после ответа,
 * при ошибке сети и при пустых настройках; а текст из админки доезжает до
 * страницы целиком, вместе с полным документом.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LEGAL_DEFAULTS, LEGAL_SECTIONS, legalKeys } from "@/lib/legal";

const { default: LegalFooter } = await import("@/components/about/LegalFooter");

/** Подмена `/api/site-content`: ответ админского хранилища контента. */
function mockSiteContent(body: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LegalFooter", () => {
  it("ИНВАРИАНТ: подвал не бывает пустым — текст есть до ответа API", () => {
    mockSiteContent({});
    render(<LegalFooter />);

    expect(screen.getByRole("heading", { name: LEGAL_DEFAULTS.heading })).toBeTruthy();
    expect(screen.getByText(LEGAL_DEFAULTS.subheading)).toBeTruthy();
    // Преамбула видна сразу, без раскрытия документа.
    expect(screen.getByText(/является публичной офертой/)).toBeTruthy();
  });

  it("раздел подписан «Правовая информация» и достижим по якорю #legal", () => {
    mockSiteContent({});
    const { container } = render(<LegalFooter />);

    expect(screen.getByText("Правовая информация")).toBeTruthy();
    // Ссылка <a href="#legal"> в колонтитуле должна куда-то вести.
    expect(container.querySelector("#legal")).not.toBeNull();
  });

  it("ИНВАРИАНТ: большой текст из админки доезжает до страницы", async () => {
    mockSiteContent({
      [legalKeys.heading]: "Оферта из админки",
      [legalKeys.subheading]: "редакция от 1 января 2027 г.",
      [legalKeys.preamble]: "Преамбула, заданная администратором.",
      [legalKeys.sectionContent(0)]: "Текст первого раздела из админки.",
    });

    render(<LegalFooter />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Оферта из админки" })).toBeTruthy();
    });
    expect(screen.getByText("редакция от 1 января 2027 г.")).toBeTruthy();
    expect(screen.getByText("Преамбула, заданная администратором.")).toBeTruthy();

    // Полный документ раскрывается кнопкой и содержит текст из админки.
    fireEvent.click(screen.getByRole("button", { name: /Читать полный текст/ }));
    expect(screen.getByText("Текст первого раздела из админки.")).toBeTruthy();
  });

  it("раскрытый документ показывает все разделы соглашения", async () => {
    mockSiteContent({});
    render(<LegalFooter />);

    fireEvent.click(screen.getByRole("button", { name: /Читать полный текст/ }));

    for (const section of LEGAL_SECTIONS) {
      expect(screen.getByRole("heading", { name: section.title })).toBeTruthy();
    }

    // Кнопка работает в обе стороны.
    fireEvent.click(screen.getByRole("button", { name: /Свернуть документ/ }));
    expect(screen.queryByRole("heading", { name: LEGAL_SECTIONS[0].title })).toBeNull();
  });

  it("ИНВАРИАНТ: при ошибке сети остаётся редакция по умолчанию", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    render(<LegalFooter />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: LEGAL_DEFAULTS.heading })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Читать полный текст/ }));
    expect(screen.getByRole("heading", { name: LEGAL_SECTIONS[0].title })).toBeTruthy();
  });

  it("ответ 403 не ломает раздел", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "Forbidden" }) })),
    );

    render(<LegalFooter />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: LEGAL_DEFAULTS.heading })).toBeTruthy();
    });
  });

  it("переход по ссылке #legal сразу раскрывает документ", async () => {
    mockSiteContent({});
    window.location.hash = "#legal";

    render(<LegalFooter />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: LEGAL_SECTIONS[0].title })).toBeTruthy();
    });
  });

  it("контакты для юридических запросов остаются на виду", () => {
    mockSiteContent({});
    render(<LegalFooter />);

    const mail = screen.getByText(LEGAL_DEFAULTS.contactEmail);
    expect(mail.getAttribute("href")).toBe(`mailto:${LEGAL_DEFAULTS.contactEmail}`);
    expect(screen.getByText(LEGAL_DEFAULTS.contactUrl).getAttribute("href")).toBe(
      LEGAL_DEFAULTS.contactUrl,
    );
  });
});
