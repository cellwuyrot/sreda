import { describe, it, expect } from "vitest";
import { projectAuditWhere } from "./projectAudit";
import { positiveInteger } from "./adminPagination";

describe("administrative pagination", () => {
  it.each([null, "", "0", "-1", "0.5", "1.5", "abc", "Infinity", "9007199254740992"])("rejects invalid page %s", value => {
    expect(positiveInteger(value, 1)).toBe(1);
  });
  it("bounds positive integer sizes", () => {
    expect(positiveInteger("200", 15, 100)).toBe(100);
    expect(positiveInteger("15", 20, 100)).toBe(15);
  });
});

describe("project audit boundary", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  it("has a bounded rolling 30-day window, including the cutoff", () => {
    expect(projectAuditWhere(now).createdAt).toEqual({ gte: new Date("2026-09-22T12:00:00Z"), lte: now });
  });
  it("whitelists project targets rather than denying a few private targets", () => {
    const query = projectAuditWhere(now);
    expect(query.OR).toContainEqual({ target: { in: expect.arrayContaining(["WindowConfig", "PaymentSettings", "TzIdProjectRole"]) } });
    const encoded = JSON.stringify(query);
    for (const privateTarget of ["Group", "group", "WallPost", "DirectConversation", "E2EEKey", "MailMessage"]) {
      expect(encoded).not.toContain(`"${privateTarget}"`);
    }
    expect(query.OR).toContainEqual({ target: "User", action: { in: ["update", "delete", "ban", "unban"] } });
    expect(encoded).not.toContain("profile.email.changed");
  });
});
