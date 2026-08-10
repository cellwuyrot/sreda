/**
 * Тесты: чистая часть ленты новостей (news/types.ts).
 *
 * Проверяется то, что ломается тихо и до продакшена не долетает глазами:
 * вложение с адресом `javascript:` (нажатие на такую ссылку исполняет код),
 * выжимка, обрезанная посреди разметки, «1 комментариев» в заголовке и
 * приписанные просмотры от округления вверх.
 *
 * Даты строятся местным конструктором и получают «сейчас» параметром — иначе
 * прогон в другом часовом поясе или после полуночи давал бы другой ответ.
 */
import { describe, it, expect } from "vitest";
import {
  commentsTitle,
  fileSizeLabel,
  formatPostDate,
  formatPostDateTime,
  formatViews,
  hasMoreToRead,
  parseNewsAttachments,
  pluralRu,
  postCover,
  postExcerpt,
  postMark,
  safeMediaUrl,
  type NewsPost,
} from "./types";

/** Опубликованный пост без обложки и вложений — основа для правок в тестах. */
function makePost(patch: Partial<NewsPost> = {}): NewsPost {
  return {
    id: "p1",
    title: "Заголовок",
    content: "Текст",
    cover: null,
    attachments: [],
    author: { id: "u1", name: "Иван", username: "ivan", avatar: null },
    createdAt: "2026-08-01T10:00:00.000Z",
    editedAt: null,
    pinned: false,
    views: 0,
    commentsClosed: false,
    commentCount: 0,
    reactions: [],
    draft: false,
    publishAt: null,
    canEdit: false,
    ...patch,
  };
}

describe("адреса вложений", () => {
  it("пропускает свои файлы и http(s)", () => {
    expect(safeMediaUrl("/uploads/a.png")).toBe("/uploads/a.png");
    expect(safeMediaUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
  });

  it("отсекает исполняемые схемы", () => {
    expect(safeMediaUrl("javascript:alert(1)")).toBeNull();
    expect(safeMediaUrl("data:text/html;base64,PHN2Zz4=")).toBeNull();
  });

  it("отсекает пустое и не-строки", () => {
    expect(safeMediaUrl("")).toBeNull();
    expect(safeMediaUrl(null)).toBeNull();
    expect(safeMediaUrl(42)).toBeNull();
  });
});

describe("разбор вложений", () => {
  it("выбрасывает записи без пригодного адреса", () => {
    const list = parseNewsAttachments([
      { url: "/uploads/ok.png" },
      { url: "javascript:alert(1)" },
      { name: "без адреса" },
      null,
      "строка",
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("/uploads/ok.png");
  });

  it("узнаёт картинку и видео по расширению, когда признака нет", () => {
    const [image, video] = parseNewsAttachments([
      { url: "/uploads/photo.JPG" },
      { url: "/uploads/clip.mp4" },
    ]);
    expect(image.isImage).toBe(true);
    expect(video.isVideo).toBe(true);
    expect(video.isImage).toBe(false);
  });

  it("не считает картинкой файл, у которого расширение только в имени папки", () => {
    const [file] = parseNewsAttachments([{ url: "/uploads/.png/report.docx", name: "report.docx" }]);
    expect(file.isImage).toBe(false);
  });

  it("подставляет имя и нулевой размер, если их не прислали", () => {
    const [file] = parseNewsAttachments([{ url: "/uploads/x.bin", size: -5 }]);
    expect(file.name).toBe("Файл");
    expect(file.size).toBe(0);
  });

  it("не падает, когда вложений нет вовсе", () => {
    expect(parseNewsAttachments(undefined)).toEqual([]);
    expect(parseNewsAttachments({})).toEqual([]);
  });
});

describe("обложка карточки", () => {
  it("берёт свою обложку", () => {
    expect(postCover(makePost({ cover: "/uploads/cover.jpg" }))).toBe("/uploads/cover.jpg");
  });

  it("без обложки берёт первую картинку из вложений", () => {
    const post = makePost({
      attachments: [{ url: "/uploads/doc.pdf" }, { url: "/uploads/a.png" }, { url: "/uploads/b.png" }],
    });
    expect(postCover(post)).toBe("/uploads/a.png");
  });

  it("не выдумывает заглушку, когда картинок нет", () => {
    expect(postCover(makePost({ attachments: [{ url: "/uploads/doc.pdf" }] }))).toBeNull();
  });

  it("небезопасная обложка не проходит дальше", () => {
    expect(postCover(makePost({ cover: "javascript:alert(1)" }))).toBeNull();
  });
});

describe("выжимка", () => {
  it("снимает разметку и склеивает строки", () => {
    expect(postExcerpt("**Важно**\nи *ещё* `код`\n- пункт")).toBe("Важно и ещё код пункт");
  });

  it("выбрасывает блоки кода целиком", () => {
    expect(postExcerpt("До\n```js\nconst a = 1;\n```\nПосле")).toBe("До После");
  });

  it("режет по границе слова и ставит многоточие", () => {
    const text = "слово ".repeat(80).trim();
    const excerpt = postExcerpt(text);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(301);
    expect(excerpt).not.toContain("сло…");
  });

  it("сплошную строку без пробелов режет по длине", () => {
    const excerpt = postExcerpt("а".repeat(500));
    expect(excerpt).toBe(`${"а".repeat(300)}…`);
  });

  it("короткий текст остаётся целым", () => {
    expect(postExcerpt("Коротко")).toBe("Коротко");
    expect(postExcerpt("")).toBe("");
  });

  it("«Читать далее» только там, где под обрезом что-то есть", () => {
    expect(hasMoreToRead("Коротко")).toBe(false);
    expect(hasMoreToRead("а".repeat(200))).toBe(true);
  });
});

describe("склонение и подписи", () => {
  it("склоняет по правилам русского счёта", () => {
    expect(pluralRu(1, "год", "года", "лет")).toBe("год");
    expect(pluralRu(3, "год", "года", "лет")).toBe("года");
    expect(pluralRu(5, "год", "года", "лет")).toBe("лет");
    expect(pluralRu(11, "год", "года", "лет")).toBe("лет");
    expect(pluralRu(21, "год", "года", "лет")).toBe("год");
    expect(pluralRu(102, "год", "года", "лет")).toBe("года");
    expect(pluralRu(112, "год", "года", "лет")).toBe("лет");
  });

  it("заголовок комментариев не выдаёт «1 комментариев»", () => {
    expect(commentsTitle(0)).toBe("Комментарии");
    expect(commentsTitle(1)).toBe("1 комментарий");
    expect(commentsTitle(2)).toBe("2 комментария");
    expect(commentsTitle(5)).toBe("5 комментариев");
  });

  it("размер файла", () => {
    expect(fileSizeLabel(0)).toBe("");
    expect(fileSizeLabel(512)).toBe("512 Б");
    expect(fileSizeLabel(2048)).toBe("2 КБ");
    expect(fileSizeLabel(1_572_864)).toBe("1,5 МБ");
  });
});

describe("просмотры", () => {
  it("до тысячи — как есть", () => {
    expect(formatViews(0)).toBe("0");
    expect(formatViews(999)).toBe("999");
  });

  it("сокращает и никогда не округляет вверх", () => {
    expect(formatViews(1000)).toBe("1 тыс.");
    expect(formatViews(1234)).toBe("1,2 тыс.");
    expect(formatViews(1999)).toBe("1,9 тыс.");
    expect(formatViews(999_999)).toBe("999 тыс.");
    expect(formatViews(1_500_000)).toBe("1,5 млн");
  });

  it("мусор не показывает как NaN", () => {
    expect(formatViews(Number.NaN)).toBe("0");
    expect(formatViews(-10)).toBe("0");
  });
});

describe("даты", () => {
  const NOW = new Date(2026, 7, 3, 18, 0, 0, 0); // 3 августа 2026, вечер

  it("сегодняшнее — со временем", () => {
    const at = new Date(2026, 7, 3, 9, 15).toISOString();
    expect(formatPostDate(at, NOW).startsWith("сегодня, ")).toBe(true);
  });

  it("вчерашнее — со временем", () => {
    const at = new Date(2026, 7, 2, 23, 40).toISOString();
    expect(formatPostDate(at, NOW).startsWith("вчера, ")).toBe(true);
  });

  it("в этом же году — без года", () => {
    const label = formatPostDate(new Date(2026, 4, 12, 10, 0).toISOString(), NOW);
    expect(label).toContain("12");
    expect(label).not.toContain("2026");
  });

  it("в прошлом году — с годом", () => {
    expect(formatPostDate(new Date(2025, 4, 12, 10, 0).toISOString(), NOW)).toContain("2025");
  });

  it("битую дату не показывает вовсе", () => {
    expect(formatPostDate("не дата", NOW)).toBe("");
    expect(formatPostDateTime("не дата", NOW)).toBe("");
  });

  it("дата со временем содержит и день, и часы", () => {
    const label = formatPostDateTime(new Date(2026, 7, 5, 10, 0).toISOString(), NOW);
    expect(label).toContain("5");
    expect(label).toContain(":");
  });
});

describe("метка состояния", () => {
  const NOW = new Date(2026, 7, 3, 18, 0, 0, 0).getTime();

  it("черновик важнее отложенного выхода", () => {
    expect(postMark(makePost({ draft: true, publishAt: new Date(NOW + 3600_000).toISOString() }), NOW)).toBe("draft");
  });

  it("время выхода в будущем — отложенный", () => {
    expect(postMark(makePost({ publishAt: new Date(NOW + 3600_000).toISOString() }), NOW)).toBe("scheduled");
  });

  it("время выхода прошло — обычный пост", () => {
    expect(postMark(makePost({ publishAt: new Date(NOW - 1000).toISOString() }), NOW)).toBeNull();
    expect(postMark(makePost(), NOW)).toBeNull();
  });
});
