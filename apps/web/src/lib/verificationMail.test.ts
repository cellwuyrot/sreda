import { describe, expect, it } from "vitest";
import { buildVerificationMail } from "./verificationMail";

describe("verificationMail", () => {
  it("builds registration email with the code and noreply sender", () => {
    const mail = buildVerificationMail("123456", "register");
    expect(mail.subject).toContain("registracii");
    expect(mail.html).toContain("123456");
    expect(mail.html).toContain("noreply@trioz.ru");
    expect(mail.text).toContain("123456");
  });

  it("escapes code content before placing it into HTML", () => {
    const mail = buildVerificationMail("<123", "register");
    expect(mail.html).toContain("&lt;123");
    expect(mail.html).not.toContain("<123");
  });
});
