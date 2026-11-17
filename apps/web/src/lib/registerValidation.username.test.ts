import { describe, expect, it } from "vitest";
import { validateUsername } from "./username";
import { checkUsername } from "./registerValidation";
describe("registration usernames", () => {
  it.each(["Андрей", "username", "123456", "новый-ник", "你好世界朋友"])('accepts %s', value => expect(checkUsername(value).valid).toBe(true));
  it("keeps registered Unicode usernames editable", () => expect(validateUsername("новый-ник")).toEqual({ ok: true, value: "новый-ник" }));
  it.each(["short", "name@example.com", "hello/world", "test.name", "everyone", "EVERYONE", "abc def", "abc\u200bdef", "x".repeat(21)])('rejects %s', value => expect(checkUsername(value).valid).toBe(false));
});
