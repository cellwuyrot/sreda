/**
 * Тесты: NEWSPOST — правила ленты новостей.
 *
 * Проверяется то, на чём лента ломается тихо и незаметно:
 *
 *   • черновик и отложенный пост не должны утечь чужому глазу;
 *   • обложка не должна уводить браузер на чужой сервер;
 *   • курсор постраничной выдачи не должен молча отдавать не ту страницу;
 *   • уведомление о публикации не должно уйти дважды или уйти о черновике;
 *   • получателем рассылки не должен стать тот, кому канал недоступен.
 */
import { describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";

/* Модуль в самом конце обращается к базе (рассылка уведомления), поэтому
   prisma подменяется до импорта — сами проверки её не касаются. */
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/createNotification", () => ({ createNotificationsBulk: vi.fn(async () => 0) }));

const {
  normalizePostTitle,
  sanitizePostCover,
  stripPostMarkup,
  postExcerpt,
  needsPostExpand,
  isPostVisible,
  isPostPublished,
  comparePostsForFeed,
  parseFeedCursor,
  parseFeedLimit,
  shouldAnnouncePost,
  parsePublishAt,
  canReadChannelAsMember,
  selectAnnounceRecipients,
  parsePostAttachments,
  foldPostReactions,
  serializeNewsPost,
  POST_EXCERPT_LIMIT,
  MAX_POST_TITLE,
} = await import("@/lib/newsPost");

// ── Заголовок ────────────────────────────────────────────────────────────────

describe("заголовок поста", () => {
  it("обрезает пробелы по краям", () => {
    expect(normalizePostTitle("  Открытие сезона  ")).toBe("Открытие сезона");
  });

  it("ФИКСАЦИЯ: пустой заголовок — всегда пустая строка, а не null", () => {
    /* Клиент проверяет одну пустоту вместо трёх (null, undefined, «   »), и
       поэтому не забывает проверить какую-нибудь из них. */
    expect(normalizePostTitle(undefined)).toBe("");
    expect(normalizePostTitle(null)).toBe("");
    expect(normalizePostTitle("   \n  ")).toBe("");
    expect(normalizePostTitle(42)).toBe("");
  });

  it("перевод строки внутри заголовка схлопывается в пробел", () => {
    /* Заголовок часто вставляют копированием — с переносом вёрстка карточки
       разъезжается. */
    expect(normalizePostTitle("Первая\nвторая")).toBe("Первая вторая");
  });

  it("ИНВАРИАНТ: длиннее предела в базу не уходит", () => {
    /* Колонка VARCHAR(200): более длинная строка не обрежется, а уронит запрос. */
    expect(normalizePostTitle("я".repeat(500))).toHaveLength(MAX_POST_TITLE);
  });
});

// ── Обложка ──────────────────────────────────────────────────────────────────

describe("обложка поста", () => {
  it("путь в наше хранилище принимается", () => {
    expect(sanitizePostCover("/uploads/news/cover.jpg")).toBe("/uploads/news/cover.jpg");
  });

  it("ИНВАРИАНТ: чужой адрес не сохраняется", () => {
    /* Иначе каждый, кто пролистал ленту, отдал бы чужому серверу свой адрес и
       заголовки — открывая при этом только наш сайт. */
    expect(sanitizePostCover("https://evil.tld/pixel.png")).toBeNull();
    expect(sanitizePostCover("http://evil.tld/a.png")).toBeNull();
  });

  it("ИНВАРИАНТ: «//host» — тоже чужой сайт, а не путь", () => {
    /* Браузер читает //evil.tld как адрес с текущей схемой; проверка «строка
       начинается с косой черты» такую ссылку пропускает. */
    expect(sanitizePostCover("//evil.tld/a.png")).toBeNull();
  });

  it("ИНВАРИАНТ: выход из каталога загрузок отклоняется", () => {
    /* /uploads/../ ведёт в приватные каталоги хранилища. */
    expect(sanitizePostCover("/uploads/../private/passport.jpg")).toBeNull();
    expect(sanitizePostCover("/uploads/..\\private\\a.jpg")).toBeNull();
  });

  it("посторонний путь внутри сайта не годится", () => {
    expect(sanitizePostCover("/api/admin/export")).toBeNull();
    expect(sanitizePostCover("")).toBeNull();
    expect(sanitizePostCover(null)).toBeNull();
  });

  it("слишком длинный путь отклоняется", () => {
    expect(sanitizePostCover(`/uploads/${"a".repeat(500)}.jpg`)).toBeNull();
  });
});

// ── Выжимка ──────────────────────────────────────────────────────────────────

describe("выжимка для карточки", () => {
  it("убирает разметку, оставляя текст", () => {
    const text = stripPostMarkup("## Важно\n\n**Завтра** в 10:00 — [подробнее](https://example.com/a)\n\n- пункт");
    expect(text).toBe("Важно Завтра в 10:00 — подробнее пункт");
  });

  it("картинка не оставляет после себя восклицательный знак", () => {
    /* Порядок замен: картинки разбираются раньше ссылок, иначе от ![alt](src)
       оставалась бы «!». */
    expect(stripPostMarkup("До ![схема](/uploads/a.png) после")).toBe("До после");
  });

  it("короткий текст возвращается целиком, без многоточия", () => {
    expect(postExcerpt("Коротко и ясно")).toBe("Коротко и ясно");
    expect(needsPostExpand("Коротко и ясно")).toBe(false);
  });

  it("ИНВАРИАНТ: обрезка не разрывает слово", () => {
    /* «начина…» читается как сбой отрисовки, а не как сокращение. */
    const content = "слово ".repeat(200);
    const excerpt = postExcerpt(content);
    expect(excerpt.endsWith("…")).toBe(true);
    const body = excerpt.slice(0, -1);
    /* Всё, что осталось, — целые слова: обрывка «сло» быть не может. */
    for (const word of body.split(" ").filter(Boolean)) expect(word).toBe("слово");
  });

  it("ФИКСАЦИЯ: одно длинное слово всё-таки режется", () => {
    /* Иначе выжимка вернулась бы пустой — а это хуже жёсткого обрыва. */
    const excerpt = postExcerpt("д".repeat(POST_EXCERPT_LIMIT + 100));
    expect(excerpt).toHaveLength(POST_EXCERPT_LIMIT + 1); // + многоточие
  });

  it("кнопка «читать далее» считается по очищенному тексту", () => {
    /* Пост из ссылок весит много знаков, а показать в нём почти нечего:
       считай мы по сырому тексту, кнопка вела бы в пустоту. */
    const links = "[тут](https://example.com/very/long/address/that/goes/on) ".repeat(12);
    expect(links.length).toBeGreaterThan(POST_EXCERPT_LIMIT);
    expect(needsPostExpand(links)).toBe(false);
  });
});

// ── Видимость ────────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("видимость поста", () => {
  const draft = { userId: "author", draft: true, publishAt: null };
  const scheduled = { userId: "author", draft: false, publishAt: new Date(NOW + HOUR) };
  const published = { userId: "author", draft: false, publishAt: new Date(NOW - HOUR) };

  it("ИНВАРИАНТ: чужой черновик не виден никому, кроме автора", () => {
    /* Черновик пишется «для себя»; увидь его модерация — черновиком просто
       перестанут пользоваться. */
    expect(isPostVisible(draft, "author", NOW)).toBe(true);
    expect(isPostVisible(draft, "someone", NOW)).toBe(false);
    expect(isPostVisible(draft, "", NOW)).toBe(false);
  });

  it("ИНВАРИАНТ: отложенный пост не виден до своего часа", () => {
    /* Иначе смысл отложенной публикации пропадает: новость можно прочитать
       раньше времени по прямой ссылке. */
    expect(isPostVisible(scheduled, "someone", NOW)).toBe(false);
    expect(isPostVisible(scheduled, "author", NOW)).toBe(true);
    expect(isPostVisible(scheduled, "someone", NOW + 2 * HOUR)).toBe(true);
  });

  it("обычный пост виден всем", () => {
    expect(isPostVisible(published, "someone", NOW)).toBe(true);
  });

  it("ФИКСАЦИЯ: «опубликован» не зависит от того, кто смотрит", () => {
    /* На этом держатся уведомления и просмотры: для них авторство неважно. */
    expect(isPostPublished(draft, NOW)).toBe(false);
    expect(isPostPublished(scheduled, NOW)).toBe(false);
    expect(isPostPublished(published, NOW)).toBe(true);
  });

  it("ровно наступившее время публикации считается наступившим", () => {
    expect(isPostPublished({ userId: "a", draft: false, publishAt: new Date(NOW) }, NOW)).toBe(true);
  });

  it("испорченная дата публикации не прячет пост навсегда", () => {
    /* Нечитаемое значение трактуется как «времени нет» — пост опубликован.
       Обратное поведение похоронило бы пост без единого следа в интерфейсе. */
    expect(isPostPublished({ userId: "a", draft: false, publishAt: "не дата" }, NOW)).toBe(true);
  });
});

// ── Порядок и курсор ─────────────────────────────────────────────────────────

describe("порядок ленты", () => {
  const post = (id: string, pinned: boolean, iso: string) => ({ id, pinned, createdAt: new Date(iso) });

  it("ИНВАРИАНТ: закреплённый пост идёт первым, даже если он самый старый", () => {
    /* Ради этого закрепление и существует: объявление не должно уезжать вниз. */
    const feed = [
      post("new", false, "2026-09-09T10:00:00.000Z"),
      post("old-pinned", true, "2025-01-01T10:00:00.000Z"),
      post("mid", false, "2026-09-08T10:00:00.000Z"),
    ].sort(comparePostsForFeed);
    expect(feed.map((entry) => entry.id)).toEqual(["old-pinned", "new", "mid"]);
  });

  it("между закреплёнными порядок тоже по дате, от свежего", () => {
    const feed = [
      post("pin-old", true, "2025-01-01T10:00:00.000Z"),
      post("pin-new", true, "2026-09-09T10:00:00.000Z"),
    ].sort(comparePostsForFeed);
    expect(feed.map((entry) => entry.id)).toEqual(["pin-new", "pin-old"]);
  });
});

describe("курсор постраничной выдачи", () => {
  it("ISO-момент разбирается", () => {
    expect(parseFeedCursor("2026-09-09T12:00:00.000Z")?.toISOString()).toBe("2026-09-09T12:00:00.000Z");
    expect(parseFeedCursor("2026-09-09T12:00:00+03:00")).toBeInstanceOf(Date);
  });

  it("ИНВАРИАНТ: мусорный курсор не превращается в другую страницу", () => {
    /* new Date("20") даёт валидную дату в 2001 году: без строгой проверки
       мусор молча отдавал бы совсем не тот кусок ленты. */
    expect(parseFeedCursor("20")).toBeNull();
    expect(parseFeedCursor("2026-09-09")).toBeNull();
    expect(parseFeedCursor("вчера")).toBeNull();
    expect(parseFeedCursor(null)).toBeNull();
    expect(parseFeedCursor(1757419200000)).toBeNull();
  });
});

describe("размер страницы", () => {
  it("по умолчанию двадцать, потолок — пятьдесят", () => {
    /* Потолок нужен, чтобы ?limit=100000 не превращался в выгрузку всего
       канала одним запросом. */
    expect(parseFeedLimit(undefined)).toBe(20);
    expect(parseFeedLimit("5")).toBe(5);
    expect(parseFeedLimit("1000")).toBe(50);
    expect(parseFeedLimit("-3")).toBe(20);
    expect(parseFeedLimit("много")).toBe(20);
  });
});

// ── Уведомление ──────────────────────────────────────────────────────────────

describe("нужно ли уведомлять о посте", () => {
  it("обычная публикация — да", () => {
    expect(shouldAnnouncePost({ draft: false, publishAt: null, announcedAt: null }, NOW)).toBe(true);
  });

  it("ИНВАРИАНТ: о черновике не уведомляем", () => {
    /* Уведомление о том, чего ещё нет: человек идёт по ссылке и не находит
       поста — черновик виден только автору. */
    expect(shouldAnnouncePost({ draft: true, publishAt: null, announcedAt: null }, NOW)).toBe(false);
  });

  it("ИНВАРИАНТ: дважды об одном посте не уведомляем", () => {
    /* Обход отложенных постов видит «время наступило» на каждом тике: без этой
       проверки уведомление уходило бы каждые полминуты. */
    expect(shouldAnnouncePost({ draft: false, publishAt: null, announcedAt: new Date(NOW - HOUR) }, NOW)).toBe(false);
  });

  it("ИНВАРИАНТ: отложенный пост молчит до своего часа", () => {
    expect(shouldAnnouncePost({ draft: false, publishAt: new Date(NOW + HOUR), announcedAt: null }, NOW)).toBe(false);
    expect(shouldAnnouncePost({ draft: false, publishAt: new Date(NOW + HOUR), announcedAt: null }, NOW + 2 * HOUR)).toBe(true);
  });
});

describe("время отложенной публикации", () => {
  it("будущее время принимается", () => {
    const parsed = parsePublishAt(new Date(NOW + HOUR).toISOString(), NOW);
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.getTime()).toBe(NOW + HOUR);
  });

  it("ФИКСАЦИЯ: прошедшее время — это «опубликовать сейчас», а не ошибка", () => {
    /* Между нажатием «запланировать на 12:00» и приходом запроса могло пройти
       время; отказывать за это — издевательство. */
    expect(parsePublishAt(new Date(NOW - 1000).toISOString(), NOW)).toEqual({ ok: true, value: null });
  });

  it("пустое значение — обычная публикация", () => {
    expect(parsePublishAt(null, NOW)).toEqual({ ok: true, value: null });
    expect(parsePublishAt(undefined, NOW)).toEqual({ ok: true, value: null });
  });

  it("ИНВАРИАНТ: нечитаемая дата отклоняется, а не превращается в «сейчас»", () => {
    /* Иначе опечатка в дате публиковала бы новость немедленно — ровно
       противоположно намерению. */
    expect(parsePublishAt("завтра", NOW).ok).toBe(false);
    expect(parsePublishAt({}, NOW).ok).toBe(false);
  });

  it("ИНВАРИАНТ: дальше года вперёд отклоняется", () => {
    /* Почти всегда это промах в поле ввода года: пост исчез бы из ленты
       навсегда и без следа. */
    expect(parsePublishAt(NOW + 400 * 24 * HOUR, NOW).ok).toBe(false);
  });
});

// ── Кому виден канал ─────────────────────────────────────────────────────────

const openChannel = { hidden: false, isRestricted: false, readAccess: "ALL", allowedRoleIds: [], paused: false };
const member = (over: Partial<{ userId: string; role: string; muted: boolean; roleIds: string[] }> = {}) => ({
  userId: "u1",
  role: "MEMBER",
  muted: false,
  roleIds: [],
  ...over,
});

describe("право читать канал (для рассылки)", () => {
  it("обычный участник открытого канала — читает", () => {
    expect(canReadChannelAsMember(openChannel, member())).toBe(true);
  });

  it("ИНВАРИАНТ: закрытый на чтение канал не уведомляет посторонних", () => {
    /* Иначе заголовок закрытой новости приходил бы в шторку телефона тому,
       кому сам канал недоступен. */
    const modOnly = { ...openChannel, readAccess: "MOD" };
    expect(canReadChannelAsMember(modOnly, member())).toBe(false);
    expect(canReadChannelAsMember(modOnly, member({ role: "MODERATOR" }))).toBe(true);

    const adminOnly = { ...openChannel, readAccess: "ADMIN" };
    expect(canReadChannelAsMember(adminOnly, member({ role: "MODERATOR" }))).toBe(false);
    expect(canReadChannelAsMember(adminOnly, member({ role: "ADMIN" }))).toBe(true);
  });

  it("ИНВАРИАНТ: скрытый канал — только модерация", () => {
    const hidden = { ...openChannel, hidden: true };
    expect(canReadChannelAsMember(hidden, member())).toBe(false);
    expect(canReadChannelAsMember(hidden, member({ role: "MODERATOR" }))).toBe(true);
  });

  it("ИНВАРИАНТ: канал по тегам — только носителям тега", () => {
    const restricted = { ...openChannel, isRestricted: true, allowedRoleIds: ["tag-1"] };
    expect(canReadChannelAsMember(restricted, member())).toBe(false);
    expect(canReadChannelAsMember(restricted, member({ roleIds: ["tag-1"] }))).toBe(true);
    /* Модерация проходит и без тега — как в connectPermissions. */
    expect(canReadChannelAsMember(restricted, member({ role: "MODERATOR" }))).toBe(true);
  });

  it("ФИКСАЦИЯ: ограничение без списка тегов никого не отсекает", () => {
    /* Так же ведёт себя connectPermissions: пустой список — это «настройку
       включили, но не заполнили», а не «закрыть всем». */
    const restricted = { ...openChannel, isRestricted: true, allowedRoleIds: [] };
    expect(canReadChannelAsMember(restricted, member())).toBe(true);
  });

  it("приостановленное сообщество молчит для всех, кроме администрации", () => {
    const paused = { ...openChannel, paused: true };
    expect(canReadChannelAsMember(paused, member({ role: "MODERATOR" }))).toBe(false);
    expect(canReadChannelAsMember(paused, member({ role: "ADMIN" }))).toBe(true);
  });
});

describe("получатели уведомления о посте", () => {
  const base = {
    authorId: "author",
    channel: openChannel,
    members: [member({ userId: "author" }), member({ userId: "u1" }), member({ userId: "u2" })],
    channelMutes: [] as { userId: string; muted: boolean }[],
  };

  it("ИНВАРИАНТ: автор не уведомляет сам себя", () => {
    /* Он только что нажал «опубликовать» — уведомление об этом выглядит как
       сбой. */
    expect(selectAnnounceRecipients(base)).toEqual(["u1", "u2"]);
  });

  it("ИНВАРИАНТ: заглушивший канал уведомления не получает", () => {
    /* Ради этого заглушку и включают. */
    const recipients = selectAnnounceRecipients({ ...base, channelMutes: [{ userId: "u1", muted: true }] });
    expect(recipients).toEqual(["u2"]);
  });

  it("ИНВАРИАНТ: заглушивший всё сообщество уведомления не получает", () => {
    const recipients = selectAnnounceRecipients({
      ...base,
      members: [member({ userId: "u1", muted: true }), member({ userId: "u2" })],
    });
    expect(recipients).toEqual(["u2"]);
  });

  it("ФИКСАЦИЯ: явно включённый канал сильнее заглушки сообщества", () => {
    /* Человек выключил всё, кроме новостей, — новости он и должен получать.
       Та же логика, что у @everyone в /api/messages. */
    const recipients = selectAnnounceRecipients({
      ...base,
      members: [member({ userId: "u1", muted: true })],
      channelMutes: [{ userId: "u1", muted: false }],
    });
    expect(recipients).toEqual(["u1"]);
  });

  it("ИНВАРИАНТ: тому, кто не видит канал, уведомление не уходит", () => {
    const recipients = selectAnnounceRecipients({
      ...base,
      channel: { ...openChannel, readAccess: "MOD" },
      members: [member({ userId: "u1" }), member({ userId: "u2", role: "MODERATOR" })],
    });
    expect(recipients).toEqual(["u2"]);
  });
});

// ── Как пост выглядит снаружи ────────────────────────────────────────────────

describe("сборка поста для клиента", () => {
  const row = {
    id: "p1",
    title: null,
    content: "Текст новости",
    cover: "/uploads/a.jpg",
    attachments: '[{"url":"/uploads/f.pdf"}]',
    pinned: true,
    views: 7,
    commentsClosed: false,
    draft: false,
    publishAt: null,
    editedAt: null,
    createdAt: new Date("2026-09-09T12:00:00.000Z"),
    userId: "author",
    user: { id: "author", name: "Аня", username: "anya", avatar: null },
    reactions: [
      { emoji: "👍", userId: "u1" },
      { emoji: "👍", userId: "viewer" },
      { emoji: "🔥", userId: "u2" },
    ],
    _count: { threadReplies: 3 },
  };

  it("отдаёт ровно тот вид, который ждёт лента", () => {
    const post = serializeNewsPost(row, { userId: "viewer", canModerate: false });
    expect(post).toMatchObject({
      id: "p1",
      title: "",
      cover: "/uploads/a.jpg",
      attachments: [{ url: "/uploads/f.pdf" }],
      author: { id: "author", username: "anya", avatar: null },
      createdAt: "2026-09-09T12:00:00.000Z",
      editedAt: null,
      pinned: true,
      views: 7,
      commentCount: 3,
      publishAt: null,
    });
  });

  it("ИНВАРИАНТ: реакции свёрнуты по смайлу и помечены «моя»", () => {
    /* Без свёртки популярный пост тащил бы в ленту по килобайту
       идентификаторов на каждый смайл. */
    const post = serializeNewsPost(row, { userId: "viewer", canModerate: false });
    expect(post.reactions).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "🔥", count: 1, mine: false },
    ]);
  });

  it("порядок реакций — по первому появлению", () => {
    /* Иначе реакции прыгали бы местами при каждом обновлении ленты. */
    const folded = foldPostReactions([{ emoji: "🔥", userId: "a" }, { emoji: "👍", userId: "b" }], "x");
    expect(folded.map((entry) => entry.emoji)).toEqual(["🔥", "👍"]);
  });

  it("ИНВАРИАНТ: править может автор или модерация", () => {
    expect(serializeNewsPost(row, { userId: "author", canModerate: false }).canEdit).toBe(true);
    expect(serializeNewsPost(row, { userId: "viewer", canModerate: true }).canEdit).toBe(true);
    expect(serializeNewsPost(row, { userId: "viewer", canModerate: false }).canEdit).toBe(false);
  });

  it("ФИКСАЦИЯ: битые вложения не роняют ленту", () => {
    /* Одна испорченная строка JSON — и без защиты весь канал отдавал бы 500. */
    expect(parsePostAttachments("{не json")).toEqual([]);
    expect(parsePostAttachments(null)).toEqual([]);
    /* Не-массив тоже не пропускаем: клиент ждёт список. */
    expect(parsePostAttachments('{"url":"/uploads/a"}')).toEqual([]);
  });

  it("счётчик комментариев берётся из пересчёта, а не из денормализации", () => {
    /* threadCount переживает удаление комментариев и начинает врать. */
    const post = serializeNewsPost({ ...row, threadCount: 99 }, { userId: "viewer", canModerate: false });
    expect(post.commentCount).toBe(3);
  });
});
