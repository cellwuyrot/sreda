import { describe, it, expect } from "vitest";
import { createElement, Fragment } from "react";
import { render } from "@testing-library/react";
import { parseAttachments, renderContent, type RenderOptions } from "./messageFormat";
import type { Attachment } from "./messageTypes";

/**
 * Разметка отдаёт дерево элементов, а не строку, поэтому проверяется то, что
 * из него получилось в DOM. Файл остаётся .ts (JSX здесь не нужен) —
 * `createElement` заменяет обёртку.
 */
function markup(text: string, options?: RenderOptions): HTMLElement {
  return render(createElement(Fragment, null, renderContent(text, options))).container;
}

describe("parseAttachments", () => {
  it("возвращает пустой массив для undefined", () => {
    expect(parseAttachments(undefined)).toEqual([]);
  });

  it("возвращает пустой массив для null", () => {
    expect(parseAttachments(null)).toEqual([]);
  });

  it("возвращает пустой массив для пустой строки", () => {
    expect(parseAttachments("")).toEqual([]);
  });

  it("разбирает корректный JSON с одним вложением", () => {
    const attachment: Attachment = {
      url: "https://example.com/file.jpg",
      name: "file.jpg",
      size: 1024,
      type: "image/jpeg",
      isImage: true,
    };
    const raw = JSON.stringify([attachment]);
    expect(parseAttachments(raw)).toEqual([attachment]);
  });

  it("разбирает массив из нескольких вложений", () => {
    const attachments: Attachment[] = [
      { url: "/a.png", name: "a.png", size: 100, type: "image/png", isImage: true },
      { url: "/b.pdf", name: "b.pdf", size: 2048, type: "application/pdf", isImage: false },
    ];
    expect(parseAttachments(JSON.stringify(attachments))).toEqual(attachments);
  });

  it("возвращает пустой массив для невалидного JSON", () => {
    expect(parseAttachments("{not valid json")).toEqual([]);
  });

  it("разбирает вложение с голосовым сообщением", () => {
    const voice: Attachment = {
      url: "/voice.ogg",
      name: "voice.ogg",
      size: 512,
      type: "audio/ogg",
      isImage: false,
      isVoice: true,
      duration: 12.5,
    };
    const result = parseAttachments(JSON.stringify([voice]));
    expect(result[0].isVoice).toBe(true);
    expect(result[0].duration).toBe(12.5);
  });
});

/**
 * POSTFMT: подзаголовок «## » и цитата «> ».
 *
 * Оба правила построчные и живут в одном переборе с упоминанием канала «#» и
 * списком «- ». Ветви разбираются по номерам скобок, поэтому здесь проверяется
 * не только новое, но и то, что от вставки не съехало старое: разъехавшийся
 * номер группы не даёт ошибки сборки — разметка просто перестаёт разбираться.
 */
describe("подзаголовок", () => {
  it("строка с «## » становится подзаголовком", () => {
    const el = markup("## Итоги недели").querySelector("span.font-semibold");
    expect(el?.textContent).toBe("Итоги недели");
  });

  it("ИНВАРИАНТ: вторая решётка не превращается в упоминание канала", () => {
    /* Ветвь «#канал» стоит в переборе после подзаголовка. Окажись она раньше —
       каждый подзаголовок стал бы кликабельной ссылкой на канал «#», а текст
       заголовка уехал бы в его имя. */
    const container = markup("## Итоги недели");
    expect(container.querySelector("[title^='Перейти в канал']")).toBeNull();
    expect(container.textContent).toBe("Итоги недели");
  });

  it("подзаголовок — только в начале строки", () => {
    const container = markup("текст ## не заголовок");
    expect(container.querySelector("span.font-semibold")).toBeNull();
  });

  it("подзаголовок находится и в середине сообщения", () => {
    const container = markup("Вступление\n## Часть вторая\nдальше");
    expect(container.querySelector("span.font-semibold")?.textContent).toBe("Часть вторая");
    expect(container.textContent).toContain("Вступление");
    expect(container.textContent).toContain("дальше");
  });

  it("ФИКСАЦИЯ: «####» остаётся упоминанием канала, как было раньше", () => {
    /* Правило требует ровно «## » с пробелом. Без этого условия любой хештег с
       двумя решётками менял бы вид у уже написанных сообщений. */
    const container = markup("#### срочно");
    expect(container.querySelector("span.font-semibold")).toBeNull();
    expect(container.querySelector("[title^='Перейти в канал']")?.textContent).toBe("####");
  });
});

describe("цитата", () => {
  it("строка с «> » становится цитатой", () => {
    const el = markup("> Он сказал так").querySelector("span.italic");
    expect(el?.textContent).toBe("Он сказал так");
  });

  it("несколько строк подряд — несколько цитат", () => {
    const container = markup("> первая\n> вторая");
    expect(container.querySelectorAll("span.italic").length).toBe(2);
  });

  it("цитата — только в начале строки", () => {
    expect(markup("2 > 1").querySelector("span.italic")).toBeNull();
  });

  it("знак «больше» внутри ссылки цитатой не считается", () => {
    const container = markup("https://trioz.ru/a?x=1");
    expect(container.querySelector("span.italic")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://trioz.ru/a?x=1");
  });
});

describe("новая разметка внутри блока кода", () => {
  it("ИНВАРИАНТ: «## » и «> » внутри ``` остаются кодом", () => {
    /* Блок кода вырезается до разбора остального текста. Иначе строка `# заголовок`
       из чужой программы или `> ` из вывода консоли приезжали бы в переписку
       оформленными — то есть код показывался бы неверно. */
    const container = markup("```\n## не заголовок\n> не цитата\n```");
    expect(container.querySelector("code")?.textContent).toBe("## не заголовок\n> не цитата");
    expect(container.querySelector("span.font-semibold")).toBeNull();
    expect(container.querySelector("span.italic")).toBeNull();
  });

  it("текст вокруг блока кода разбирается по-прежнему", () => {
    const container = markup("## Пример\n```\nx\n```\n> и вывод");
    expect(container.querySelector("span.font-semibold")?.textContent).toBe("Пример");
    expect(container.querySelector("span.italic")?.textContent).toBe("и вывод");
    expect(container.querySelector("code")?.textContent).toBe("x");
  });
});

describe("прежняя разметка после добавления новой", () => {
  it("жирный, курсив и код внутри строки", () => {
    expect(markup("**важно**").querySelector("strong")?.textContent).toBe("важно");
    expect(markup("*тихо*").querySelector("em")?.textContent).toBe("тихо");
    expect(markup("`fetch`").querySelector("code")?.textContent).toBe("fetch");
  });

  it("ссылка остаётся ссылкой, в том числе без протокола", () => {
    expect(markup("https://trioz.ru").querySelector("a")?.getAttribute("href")).toBe("https://trioz.ru");
    expect(markup("www.trioz.ru").querySelector("a")?.getAttribute("href")).toBe("https://www.trioz.ru");
  });

  it("список через «- » рисуется точкой", () => {
    const container = markup("- пункт");
    expect(container.textContent).toBe("•пункт");
  });

  it("ИНВАРИАНТ: упоминание канала кликабельно, а тег сообщества — плашка", () => {
    /* Обе ветви разбираются по одному номеру группы, сдвинутому вставкой
       подзаголовка и цитаты. */
    expect(markup("#новости").querySelector("[title^='Перейти в канал']")?.textContent).toBe("#новости");
    const tagged = markup("#тестер", { roleTags: new Map([["тестер", { name: "тестер", color: "#ff0000" }]]) });
    expect(tagged.querySelector("[title^='Тег сообщества']")?.textContent).toBe("#тестер");
  });

  it("ИНВАРИАНТ: упоминания участника и @everyone на месте", () => {
    expect(markup("@ivan").querySelector("a")?.getAttribute("href")).toBe("/profile/ivan");
    expect(markup("@everyone").textContent).toBe("@everyone");
  });

  it("ИНВАРИАНТ: свой эмодзи сообщества по-прежнему становится картинкой", () => {
    const known = markup(":party:", { emoji: new Map([["party", "/uploads/party.png"]]) });
    expect(known.querySelector("img")?.getAttribute("src")).toBe("/uploads/party.png");
    /* Незнакомое имя остаётся текстом: иначе «12:30:45» превращался бы в дыру. */
    expect(markup(":party:").querySelector("img")).toBeNull();
    expect(markup(":party:").textContent).toBe(":party:");
  });
});
