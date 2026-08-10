/**
 * Тесты: src/lib/postDraft.ts — черновик поста и проверки перед отправкой.
 *
 * Проверяется то, что ломается молча и обнаруживается уже после потери работы:
 * стёртый черновик, воскрешённый старый текст, отложенная публикация, которая
 * на деле уходит немедленно, и кнопка панели, ставящая знак разметки не туда.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MAX_POST_TITLE,
  MAX_PUBLISH_AHEAD_MS,
  POST_DRAFT_TTL_MS,
  POST_DRAFT_VERSION,
  applyFormat,
  clearDraft,
  emptyDraft,
  isDraftEmpty,
  isPostEmpty,
  isValidPublishAt,
  normalizeTitle,
  postDraftKey,
  publishAtFromInputs,
  publishAtToInputs,
  readDraft,
  titleRemaining,
  validatePost,
  writeDraft,
  type PostAttachment,
  type PostDraft,
} from "@/lib/postDraft";

/** Полдень 2 августа 2026 года по местному времени. */
const NOON = new Date(2026, 7, 2, 12, 0, 0, 0).getTime();

const CHANNEL = "ch-1";

const FILE: PostAttachment = { url: "/uploads/a.pdf", name: "a.pdf", size: 10, type: "application/pdf", isImage: false };

/**
 * Подмена localStorage: тесты lib идут в окружении node, где его нет вовсе.
 * Заодно это единственный способ проверить ветку «хранилище недоступно».
 */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function filled(patch: Partial<PostDraft> = {}): PostDraft {
  return { ...emptyDraft(), content: "Первый абзац", ...patch };
}

describe("хранение черновика", () => {
  it("сохранённый черновик читается обратно целиком", () => {
    const draft = filled({ title: "Заголовок", cover: "/uploads/c.png", attachments: [FILE], commentsClosed: true, publishAt: NOON + 1000 });
    writeDraft(CHANNEL, draft, NOON);
    expect(readDraft(CHANNEL, NOON)).toEqual(draft);
  });

  it("ИНВАРИАНТ: набранное не теряется при закрытии редактора", () => {
    /* Ради этого модуль и существует: человек пишет пост двадцать минут, и
       единственная копия текста до отправки — та, что здесь. */
    writeDraft(CHANNEL, filled({ content: "Длинный текст на двадцать минут" }), NOON);
    expect(readDraft(CHANNEL, NOON)?.content).toBe("Длинный текст на двадцать минут");
  });

  it("черновики разных каналов не смешиваются", () => {
    writeDraft("a", filled({ content: "в канал А" }), NOON);
    writeDraft("b", filled({ content: "в канал Б" }), NOON);
    expect(readDraft("a", NOON)?.content).toBe("в канал А");
    expect(readDraft("b", NOON)?.content).toBe("в канал Б");
    expect(postDraftKey("a")).not.toBe(postDraftKey("b"));
  });

  it("ФИКСАЦИЯ: старый черновик не воскрешают", () => {
    /* Текст недельной давности — это не «случайно закрыл», а забытое. Подставить
       его в пустой редактор хуже, чем не подставить ничего: человек садится
       писать новое и получает чужой абзац поверх. */
    writeDraft(CHANNEL, filled(), NOON);
    expect(readDraft(CHANNEL, NOON + POST_DRAFT_TTL_MS - 1000)).not.toBeNull();
    expect(readDraft(CHANNEL, NOON + POST_DRAFT_TTL_MS + 1000)).toBeNull();
  });

  it("протухший черновик стирается, а не остаётся лежать", () => {
    writeDraft(CHANNEL, filled(), NOON);
    readDraft(CHANNEL, NOON + POST_DRAFT_TTL_MS + 1000);
    expect(localStorage.getItem(postDraftKey(CHANNEL))).toBeNull();
  });

  it("пустой черновик не хранится и стирает прежний", () => {
    writeDraft(CHANNEL, filled(), NOON);
    writeDraft(CHANNEL, emptyDraft(), NOON);
    expect(localStorage.getItem(postDraftKey(CHANNEL))).toBeNull();
  });

  it("один заголовок — уже работа, его сохраняем", () => {
    writeDraft(CHANNEL, { ...emptyDraft(), title: "Итоги недели" }, NOON);
    expect(readDraft(CHANNEL, NOON)?.title).toBe("Итоги недели");
    expect(isDraftEmpty({ ...emptyDraft(), title: "Итоги недели" })).toBe(false);
    expect(isDraftEmpty({ ...emptyDraft(), commentsClosed: true })).toBe(true);
  });

  it("clearDraft забывает черновик", () => {
    writeDraft(CHANNEL, filled(), NOON);
    clearDraft(CHANNEL);
    expect(readDraft(CHANNEL, NOON)).toBeNull();
  });

  it("битая запись не роняет редактор", () => {
    localStorage.setItem(postDraftKey(CHANNEL), "{это не json");
    expect(readDraft(CHANNEL, NOON)).toBeNull();
    expect(localStorage.getItem(postDraftKey(CHANNEL))).toBeNull();
  });

  it("ФИКСАЦИЯ: запись чужой версии формата отбрасывается целиком", () => {
    /* Разобрать наполовину — значит подставить в поля undefined и получить
       неуправляемое поле ввода, то есть молча съеденный ввод. */
    localStorage.setItem(
      postDraftKey(CHANNEL),
      JSON.stringify({ v: POST_DRAFT_VERSION + 1, savedAt: NOON, content: "из будущего" }),
    );
    expect(readDraft(CHANNEL, NOON)).toBeNull();
  });

  it("поля неверного типа заменяются пустыми, а не подставляются как есть", () => {
    localStorage.setItem(
      postDraftKey(CHANNEL),
      JSON.stringify({ v: POST_DRAFT_VERSION, savedAt: NOON, title: 42, content: "текст", cover: 7, attachments: "нет", commentsClosed: "да", publishAt: "скоро" }),
    );
    expect(readDraft(CHANNEL, NOON)).toEqual({
      title: "",
      content: "текст",
      cover: null,
      attachments: [],
      commentsClosed: false,
      publishAt: null,
    });
  });

  it("ИНВАРИАНТ: без localStorage модуль работает вхолостую, а не падает", () => {
    /* На сервере переменной нет вовсе, в приватном режиме Safari обращение к ней
       бросает исключение. Редактор должен открыться в обоих случаях. */
    vi.stubGlobal("localStorage", undefined);
    expect(() => writeDraft(CHANNEL, filled(), NOON)).not.toThrow();
    expect(readDraft(CHANNEL, NOON)).toBeNull();
    expect(() => clearDraft(CHANNEL)).not.toThrow();
  });
});

describe("пустота поста", () => {
  it("нет ни текста, ни вложений, ни обложки — пусто", () => {
    expect(isPostEmpty({})).toBe(true);
    expect(isPostEmpty({ content: "   \n  " })).toBe(true);
    expect(isPostEmpty({ content: "а" })).toBe(false);
    expect(isPostEmpty({ cover: "/uploads/c.png" })).toBe(false);
    expect(isPostEmpty({ attachments: [FILE] })).toBe(false);
  });

  it("ФИКСАЦИЯ: один заголовок содержимым не считается", () => {
    /* В ленте открывают ради содержимого; запись из одного заголовка читается
       как поломка вывода, а не как сообщение. */
    expect(isPostEmpty({ content: "" })).toBe(true);
  });
});

describe("заголовок", () => {
  it("обрезается до предела", () => {
    expect(normalizeTitle("я".repeat(500)).length).toBe(MAX_POST_TITLE);
  });

  it("края обрезаются, в том числе после обреза по длине", () => {
    expect(normalizeTitle("  Итоги недели  ")).toBe("Итоги недели");
    expect(normalizeTitle(`${"я".repeat(199)} хвост`)).toBe("я".repeat(199));
  });

  it("не строка — пустой заголовок", () => {
    expect(normalizeTitle(null)).toBe("");
    expect(normalizeTitle(undefined)).toBe("");
    expect(normalizeTitle(42)).toBe("");
  });

  it("счётчик появляется только у предела", () => {
    expect(titleRemaining("коротко")).toBeNull();
    expect(titleRemaining("я".repeat(MAX_POST_TITLE - 40))).toBe(40);
    expect(titleRemaining("я".repeat(MAX_POST_TITLE))).toBe(0);
  });
});

describe("время отложенной публикации", () => {
  it("будущее принимается, прошлое — нет", () => {
    expect(isValidPublishAt(NOON + 1000, NOON)).toBe(true);
    expect(isValidPublishAt(NOON - 1000, NOON)).toBe(false);
    expect(isValidPublishAt(NOON, NOON)).toBe(false);
  });

  it("ФИКСАЦИЯ: дальше года — почти всегда промах в годе", () => {
    expect(isValidPublishAt(NOON + MAX_PUBLISH_AHEAD_MS - 1000, NOON)).toBe(true);
    expect(isValidPublishAt(NOON + MAX_PUBLISH_AHEAD_MS + 1000, NOON)).toBe(false);
  });

  it("мусор вместо времени не проходит", () => {
    for (const bad of [null, undefined, "завтра", Number.NaN, Infinity, {}]) {
      expect(isValidPublishAt(bad, NOON), String(bad)).toBe(false);
    }
  });

  it("поля формы собираются в местное время и разбираются обратно", () => {
    const at = publishAtFromInputs("2026-08-03", "09:05");
    expect(at).toBe(new Date(2026, 7, 3, 9, 5).getTime());
    expect(publishAtToInputs(at)).toEqual({ date: "2026-08-03", time: "09:05" });
  });

  it("без даты времени нет", () => {
    expect(publishAtFromInputs("", "09:00")).toBeNull();
    expect(publishAtFromInputs("не дата", "09:00")).toBeNull();
    expect(publishAtToInputs(null)).toEqual({ date: "", time: "" });
  });
});

describe("проверка перед отправкой", () => {
  it("ИНВАРИАНТ: пустой пост не уходит на сервер", () => {
    /* Иначе в ленте появляется карточка, которую нельзя ни прочитать, ни понять,
       а удалять её приходится руками через настройки. */
    const check = validatePost({ content: "   ", title: "Заголовок" }, NOON);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("пустой");
  });

  it("черновик с одним заголовком сохранить можно", () => {
    /* Заготовка «напишу вечером»: отказ заставил бы держать название в голове. */
    expect(validatePost({ title: "Итоги недели", draft: true }, NOON).ok).toBe(true);
    expect(validatePost({ draft: true }, NOON).ok).toBe(false);
  });

  it("пост из одной обложки или вложения — осмысленный", () => {
    expect(validatePost({ cover: "/uploads/c.png" }, NOON).ok).toBe(true);
    expect(validatePost({ attachments: [FILE] }, NOON).ok).toBe(true);
  });

  it("заголовок в теле запроса уже обрезан", () => {
    const check = validatePost({ title: `  ${"я".repeat(500)}`, content: "текст" }, NOON);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.payload.title.length).toBe(MAX_POST_TITLE);
  });

  it("ИНВАРИАНТ: отложенная публикация в прошлом отклоняется", () => {
    /* Такой пост уходит в первый же обход планировщика — «отложенная» публикация
       оказывается немедленной, и узнаёт об этом человек уже из ленты. */
    const check = validatePost({ content: "текст", publishAt: NOON - 1000 }, NOON);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("прошло");
  });

  it("дальше года публикация не ставится", () => {
    const check = validatePost({ content: "текст", publishAt: NOON + MAX_PUBLISH_AHEAD_MS + 1000 }, NOON);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("год");
  });

  it("нечисловое время публикации не проходит", () => {
    expect(validatePost({ content: "текст", publishAt: Number.NaN }, NOON).ok).toBe(false);
  });

  it("тело запроса собрано полностью и с нужными умолчаниями", () => {
    const check = validatePost({ content: " текст ", attachments: [FILE], commentsClosed: true, publishAt: NOON + 60_000 }, NOON);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.payload).toEqual({
        title: "",
        content: "текст",
        cover: null,
        attachments: [FILE],
        draft: false,
        publishAt: NOON + 60_000,
        commentsClosed: true,
      });
    }
  });
});

describe("вставка разметки", () => {
  it("выделенное оборачивается, курсор охватывает тот же кусок", () => {
    const r = applyFormat("важное слово", 7, 12, "bold");
    expect(r.text).toBe("важное **слово**");
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe("слово");
  });

  it("ИНВАРИАНТ: без выделения курсор встаёт между знаками", () => {
    /* Иначе человек печатает после закрывающих звёздочек и видит их в ленте
       как обычный текст — кнопка выглядит сломанной. */
    const r = applyFormat("", 0, 0, "italic");
    expect(r.text).toBe("**");
    expect(r.selectionStart).toBe(1);
    expect(r.selectionEnd).toBe(1);
  });

  it("повторное нажатие снимает разметку", () => {
    const r = applyFormat("**слово**", 0, 9, "bold");
    expect(r.text).toBe("слово");
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe("слово");
  });

  it("подзаголовок и цитата ставят знак в начало строки", () => {
    expect(applyFormat("Итоги", 2, 2, "heading").text).toBe("## Итоги");
    expect(applyFormat("Он сказал", 0, 0, "quote").text).toBe("> Он сказал");
  });

  it("знак строки ставится в начало строки, а не под курсор", () => {
    const text = "Первая\nВторая";
    expect(applyFormat(text, 10, 10, "list").text).toBe("Первая\n- Вторая");
  });

  it("курсор едет вместе со вставленным знаком", () => {
    const r = applyFormat("Итоги", 5, 5, "heading");
    expect(r.selectionStart).toBe(8);
    expect(r.text.slice(0, r.selectionStart)).toBe("## Итоги");
  });

  it("список и цитата помечают каждую выделенную строку", () => {
    const text = "раз\nдва\nтри";
    expect(applyFormat(text, 0, text.length, "list").text).toBe("- раз\n- два\n- три");
    expect(applyFormat(text, 0, text.length, "quote").text).toBe("> раз\n> два\n> три");
  });

  it("ФИКСАЦИЯ: подзаголовок ставится только на одну строку", () => {
    /* Правило разметки — «## и строка до конца»: подзаголовка из трёх строк не
       бывает, а знак на каждой строке превратил бы абзац в лестницу заголовков. */
    const text = "раз\nдва";
    expect(applyFormat(text, 0, text.length, "heading").text).toBe("## раз\nдва");
  });

  it("повторное нажатие снимает построчный знак", () => {
    const text = "- раз\n- два";
    expect(applyFormat(text, 0, text.length, "list").text).toBe("раз\nдва");
  });

  it("ФИКСАЦИЯ: пустые строки внутри выделения знаком не помечаются", () => {
    /* `> ` без текста разметкой не считается (нужен хотя бы один символ) и в
       ленте выводится как есть — то есть мусором посреди цитаты. */
    expect(applyFormat("раз\n\nдва", 0, 8, "quote").text).toBe("> раз\n\n> два");
  });

  it("код: слово — обратными кавычками, несколько строк — блоком", () => {
    expect(applyFormat("вызов fetch тут", 6, 11, "code").text).toBe("вызов `fetch` тут");
    const multi = applyFormat("a\nb", 0, 3, "code");
    expect(multi.text).toBe("```\na\nb\n```\n");
    expect(multi.text.slice(multi.selectionStart, multi.selectionEnd)).toBe("a\nb");
  });

  it("ИНВАРИАНТ: блок кода начинается со своей строки", () => {
    /* Кавычки, прилипшие к концу абзаца, блоком не распознаются, и программа
       приезжает в ленту обычным текстом — со съеденными отступами. */
    expect(applyFormat("Абзац\nx\ny", 6, 9, "code").text).toBe("Абзац\n```\nx\ny\n```\n");
    expect(applyFormat("Абзацx\ny", 5, 8, "code").text).toBe("Абзац\n```\nx\ny\n```\n");
  });

  it("ссылка вставляет заготовку адреса, а не разметку в скобках", () => {
    /* Ссылками становятся сами адреса; `[текст](адрес)` вывелся бы в ленте
       скобками как есть. */
    const r = applyFormat("Подробности", 11, 11, "link");
    expect(r.text).toBe("Подробности https://");
    expect(r.selectionStart).toBe(r.text.length);
  });

  it("готовый адрес повторно не трогается", () => {
    const text = "https://trioz.ru";
    expect(applyFormat(text, 0, text.length, "link").text).toBe(text);
  });

  it("границы выделения приводятся в порядок", () => {
    /* Перевёрнутое и вылезшее за текст выделение приходит из DOM, и без этого
       вставка резала бы строку в случайном месте. */
    expect(applyFormat("слово", 5, 0, "bold").text).toBe("**слово**");
    expect(applyFormat("слово", 99, 99, "bold").text).toBe("слово****");
    expect(applyFormat("слово", Number.NaN, Number.NaN, "bold").text).toBe("слово****");
  });
});
