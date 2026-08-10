import { describe, it, expect } from "vitest";
import { getMentionQuery, filterMentionUsers, insertMention, MENTION_LIMIT } from "./MentionPopup";
import type { MentionUser } from "./MentionPopup";

describe("getMentionQuery", () => {
  it("возвращает null для строки без @", () => {
    expect(getMentionQuery("привет", 6)).toBeNull();
  });

  it("возвращает null, если каретка перед @", () => {
    expect(getMentionQuery("@user", 0)).toBeNull();
  });

  it("обнаруживает @ в начале строки", () => {
    const result = getMentionQuery("@ivan", 5);
    expect(result).not.toBeNull();
    expect(result?.query).toBe("ivan");
    expect(result?.start).toBe(0);
  });

  it("обнаруживает @ после пробела", () => {
    const result = getMentionQuery("привет @al", 10);
    expect(result).not.toBeNull();
    expect(result?.query).toBe("al");
    expect(result?.start).toBe(7);
  });

  it("возвращает пустой query сразу после @", () => {
    const result = getMentionQuery("@", 1);
    expect(result).not.toBeNull();
    expect(result?.query).toBe("");
  });

  it("возвращает null, когда @ внутри слова без пробела перед ним", () => {
    // слово "test@user" — @ не после пробела/пунктуации
    const result = getMentionQuery("test@user", 9);
    expect(result).toBeNull();
  });

  it("обнаруживает кириллический ник", () => {
    const result = getMentionQuery("@иван", 5);
    expect(result).not.toBeNull();
    expect(result?.query).toBe("иван");
  });
});

describe("filterMentionUsers", () => {
  const users: MentionUser[] = [
    { id: "1", username: "alice", name: "Alice Smith", lastSeen: "2024-01-03T10:00:00Z" },
    { id: "2", username: "bob", name: "Bob Jones", lastSeen: "2024-01-02T10:00:00Z" },
    { id: "3", username: "charlie", name: "Charlie Brown", lastSeen: "2024-01-01T10:00:00Z" },
    { id: "4", username: "alyona", name: "Алёна", lastSeen: "2024-01-04T10:00:00Z" },
  ];

  it("возвращает всех при пустом запросе", () => {
    const result = filterMentionUsers(users, "");
    expect(result).toHaveLength(4);
  });

  it("фильтрует по началу имени пользователя", () => {
    const result = filterMentionUsers(users, "al");
    expect(result.map((u) => u.username)).toContain("alice");
    expect(result.map((u) => u.username)).toContain("alyona");
    expect(result.map((u) => u.username)).not.toContain("bob");
  });

  it("фильтрует по началу отображаемого имени", () => {
    const result = filterMentionUsers(users, "charlie");
    expect(result.map((u) => u.username)).toContain("charlie");
  });

  it("сортирует по lastSeen: более новые первыми", () => {
    const result = filterMentionUsers(users, "");
    expect(result[0].username).toBe("alyona"); // lastSeen 04
    expect(result[1].username).toBe("alice");  // lastSeen 03
  });

  it("ограничивает количество результатов по лимиту", () => {
    const manyUsers: MentionUser[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      username: `user${i}`,
      name: null,
      lastSeen: null,
    }));
    const result = filterMentionUsers(manyUsers, "");
    expect(result).toHaveLength(MENTION_LIMIT);
  });

  it("не возвращает дубликаты по username", () => {
    const dupes: MentionUser[] = [
      { id: "1", username: "alice", name: "Alice", lastSeen: null },
      { id: "2", username: "alice", name: "Alice дубль", lastSeen: null },
    ];
    const result = filterMentionUsers(dupes, "");
    expect(result).toHaveLength(1);
  });

  it("пропускает пользователей без username", () => {
    const noUsername: MentionUser[] = [
      { id: "1", username: null, name: "Noname", lastSeen: null },
    ];
    expect(filterMentionUsers(noUsername, "")).toHaveLength(0);
  });
});

describe("insertMention", () => {
  it("заменяет частично набранное упоминание", () => {
    const text = "Привет @iv";
    const mention = { query: "iv", start: 7 };
    const { next, caretAfter } = insertMention(text, mention, 10, "ivan");
    expect(next).toBe("Привет @ivan ");
    expect(caretAfter).toBe(13);
  });

  it("вставляет упоминание в середину строки", () => {
    const text = "@al и ещё текст";
    const mention = { query: "al", start: 0 };
    const { next, caretAfter } = insertMention(text, mention, 3, "alice");
    expect(next).toBe("@alice  и ещё текст");
    expect(caretAfter).toBe(7);
  });

  it("добавляет пробел после имени", () => {
    const { next } = insertMention("@", { query: "", start: 0 }, 1, "bob");
    expect(next.endsWith(" ")).toBe(true);
  });
});
