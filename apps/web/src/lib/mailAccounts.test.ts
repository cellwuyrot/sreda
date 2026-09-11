import { describe, it, expect } from "vitest";
import {
  parseAccounts,
  getAccount,
  getImapConfig,
  getSmtpConfig,
} from "./mailAccounts";

describe("mailAccounts.parseAccounts", () => {
  it("читает строковой пароль и подставляет полный адрес как логин", () => {
    const env = { MAIL_ACCOUNTS: JSON.stringify({ info: "secret1" }) };
    const map = parseAccounts(env);
    expect(map.get("info")).toEqual({ user: "info@trioz.ru", pass: "secret1" });
  });

  it("читает объектную форму с явным логином", () => {
    const env = { MAIL_ACCOUNTS: JSON.stringify({ sales: { user: "box5@trioz.ru", pass: "p" } }) };
    expect(parseAccounts(env).get("sales")).toEqual({ user: "box5@trioz.ru", pass: "p" });
  });

  it("не падает на битом JSON", () => {
    expect(parseAccounts({ MAIL_ACCOUNTS: "{oops" }).size).toBe(0);
  });

  it("пусто без переменной", () => {
    expect(parseAccounts({}).size).toBe(0);
  });
});

describe("mailAccounts.getAccount", () => {
  it("явный аккаунт важнее общего пароля", () => {
    const env = {
      MAIL_ACCOUNTS: JSON.stringify({ info: "explicit" }),
      MAIL_ACCOUNT_PASSWORD: "shared",
    };
    expect(getAccount("info", env)?.pass).toBe("explicit");
  });

  it("общий пароль как fallback с логином = адрес", () => {
    expect(getAccount("support", { MAIL_ACCOUNT_PASSWORD: "shared" })).toEqual({
      user: "support@trioz.ru",
      pass: "shared",
    });
  });

  it("null когда ничего не задано", () => {
    expect(getAccount("hr", {})).toBeNull();
  });
});

describe("mailAccounts.getImapConfig", () => {
  it("null без хоста", () => {
    expect(getImapConfig({})).toBeNull();
  });

  it("порт 993 → secure по умолчанию", () => {
    const c = getImapConfig({ MAIL_IMAP_HOST: "imap.trioz.ru" });
    expect(c).toEqual({ host: "imap.trioz.ru", port: 993, secure: true, rejectUnauthorized: true });
  });

  it("явный порт 143 → не secure", () => {
    const c = getImapConfig({ MAIL_IMAP_HOST: "h", MAIL_IMAP_PORT: "143" });
    expect(c?.secure).toBe(false);
  });
});

describe("mailAccounts.getSmtpConfig", () => {
  it("откат на SMTP_HOST проекта", () => {
    const c = getSmtpConfig({ SMTP_HOST: "smtp.trioz.ru" });
    expect(c?.host).toBe("smtp.trioz.ru");
    expect(c?.port).toBe(465);
    expect(c?.secure).toBe(true);
  });

  it("отдельный MAIL_SMTP_HOST имеет приоритет", () => {
    const c = getSmtpConfig({ MAIL_SMTP_HOST: "mail.trioz.ru", SMTP_HOST: "other" });
    expect(c?.host).toBe("mail.trioz.ru");
  });

  it("null без хоста", () => {
    expect(getSmtpConfig({})).toBeNull();
  });
});
