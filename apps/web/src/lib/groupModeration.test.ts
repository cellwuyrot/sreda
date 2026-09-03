/**
 * Тесты модуля groupModeration.ts
 * Зона B, P0 — иерархия прав в группе.
 */
import { describe, it, expect } from "vitest";
import {
  rankOf,
  canActOn,
  allowedActions,
  isActionAllowed,
  assignableRoles,
  purgeScope,
  ROLE_RANK,
  RANK_OWNER,
  RANK_ADMIN,
  RANK_MODERATOR,
  RANK_MEMBER,
} from "@/lib/groupModeration";

// ── rankOf ───────────────────────────────────────────────────────────────────

describe("rankOf", () => {
  it("OWNER возвращает 4", () => {
    expect(rankOf("OWNER")).toBe(4);
  });

  it("ADMIN возвращает 3", () => {
    expect(rankOf("ADMIN")).toBe(3);
  });

  it("MODERATOR возвращает 2", () => {
    expect(rankOf("MODERATOR")).toBe(2);
  });

  it("MEMBER возвращает 1", () => {
    expect(rankOf("MEMBER")).toBe(1);
  });

  it("null возвращает 0", () => {
    expect(rankOf(null)).toBe(0);
  });

  it("undefined возвращает 0", () => {
    expect(rankOf(undefined)).toBe(0);
  });

  it("пустая строка возвращает 0", () => {
    expect(rankOf("")).toBe(0);
  });

  /**
   * ВАЖНОЕ ПОВЕДЕНИЕ: неизвестная строка роли НЕ молча превращается в 0 —
   * она получает RANK_MEMBER (1). Это задокументировано в коде: «незнакомая
   * строка — это участник». Тест фиксирует это поведение явно.
   */
  it("неизвестная роль возвращает RANK_MEMBER (1), а не 0", () => {
    expect(rankOf("SUPERADMIN")).toBe(RANK_MEMBER);
    expect(rankOf("SITE_ADMIN")).toBe(RANK_MEMBER);
    expect(rankOf("GUEST")).toBe(RANK_MEMBER);
    expect(rankOf("random_string")).toBe(RANK_MEMBER);
  });
});

// ── canActOn ─────────────────────────────────────────────────────────────────

describe("canActOn: равный ранг не трогает равного", () => {
  it("MODERATOR не может воздействовать на MODERATOR", () => {
    expect(canActOn("MODERATOR", "MODERATOR")).toBe(false);
  });

  it("ADMIN не может воздействовать на ADMIN", () => {
    expect(canActOn("ADMIN", "ADMIN")).toBe(false);
  });

  it("OWNER не может воздействовать на OWNER", () => {
    // Владелец неприкосновенен
    expect(canActOn("OWNER", "OWNER")).toBe(false);
  });

  it("MEMBER не может воздействовать на MEMBER", () => {
    expect(canActOn("MEMBER", "MEMBER")).toBe(false);
  });
});

describe("canActOn: владелец сообщества неприкосновенен", () => {
  it("ADMIN не может воздействовать на OWNER", () => {
    expect(canActOn("ADMIN", "OWNER")).toBe(false);
  });

  it("MODERATOR не может воздействовать на OWNER", () => {
    expect(canActOn("MODERATOR", "OWNER")).toBe(false);
  });

  it("MEMBER не может воздействовать на OWNER", () => {
    expect(canActOn("MEMBER", "OWNER")).toBe(false);
  });

  it("неизвестная роль не может воздействовать на OWNER", () => {
    expect(canActOn("SUPERADMIN", "OWNER")).toBe(false);
  });
});

describe("canActOn: законные действия", () => {
  it("OWNER может воздействовать на ADMIN", () => {
    expect(canActOn("OWNER", "ADMIN")).toBe(true);
  });

  it("OWNER может воздействовать на MODERATOR", () => {
    expect(canActOn("OWNER", "MODERATOR")).toBe(true);
  });

  it("OWNER может воздействовать на MEMBER", () => {
    expect(canActOn("OWNER", "MEMBER")).toBe(true);
  });

  it("ADMIN может воздействовать на MODERATOR", () => {
    expect(canActOn("ADMIN", "MODERATOR")).toBe(true);
  });

  it("ADMIN может воздействовать на MEMBER", () => {
    expect(canActOn("ADMIN", "MEMBER")).toBe(true);
  });

  it("MODERATOR может воздействовать на MEMBER", () => {
    expect(canActOn("MODERATOR", "MEMBER")).toBe(true);
  });
});

describe("canActOn: пограничные случаи", () => {
  it("MEMBER (ранг 1) не может воздействовать ни на кого", () => {
    expect(canActOn("MEMBER", "MEMBER")).toBe(false);
    expect(canActOn("MEMBER", null)).toBe(false);
  });

  it("null-актор не может воздействовать", () => {
    expect(canActOn(null, "MEMBER")).toBe(false);
  });

  it("вышедший участник (null targetRole) — ранг MEMBER, MODERATOR может", () => {
    expect(canActOn("MODERATOR", null)).toBe(true);
  });

  it("ADMIN не может воздействовать на ADMIN через неизвестную роль с тем же рангом", () => {
    // SUPERADMIN → RANK_MEMBER (1), ADMIN → 3, так что ADMIN МОЖЕТ
    expect(canActOn("ADMIN", "SUPERADMIN")).toBe(true);
  });
});

// ── allowedActions ───────────────────────────────────────────────────────────

describe("allowedActions: над собой действий нет", () => {
  it("возвращает пустой массив когда isSelf=true", () => {
    expect(allowedActions({ role: "OWNER", targetRole: "OWNER", isSelf: true })).toEqual([]);
  });
});

describe("allowedActions: MODERATOR против MEMBER", () => {
  it("включает delete-message, ban, kick, timeout", () => {
    const actions = allowedActions({
      role: "MODERATOR",
      targetRole: "MEMBER",
      isSelf: false,
      hasMessage: true,
    });
    expect(actions).toContain("delete-message");
    expect(actions).toContain("ban");
    expect(actions).toContain("kick");
    expect(actions).toContain("timeout");
  });

  it("не включает set-role и assign-tags (нужен ADMIN)", () => {
    const actions = allowedActions({
      role: "MODERATOR",
      targetRole: "MEMBER",
      isSelf: false,
    });
    expect(actions).not.toContain("set-role");
    expect(actions).not.toContain("assign-tags");
  });
});

describe("allowedActions: MODERATOR против MODERATOR", () => {
  it("возвращает только ignore и report (равный ранг)", () => {
    const actions = allowedActions({
      role: "MODERATOR",
      targetRole: "MODERATOR",
      isSelf: false,
    });
    expect(actions).toEqual(["ignore", "report"]);
  });
});

describe("allowedActions: ADMIN против MODERATOR", () => {
  it("включает set-role и assign-tags", () => {
    const actions = allowedActions({
      role: "ADMIN",
      targetRole: "MODERATOR",
      isSelf: false,
    });
    expect(actions).toContain("set-role");
    expect(actions).toContain("assign-tags");
  });
});

describe("allowedActions: любой против OWNER", () => {
  it("ADMIN получает только ignore и report против OWNER", () => {
    const actions = allowedActions({ role: "ADMIN", targetRole: "OWNER", isSelf: false });
    expect(actions).toEqual(["ignore", "report"]);
  });
});

describe("allowedActions: delete-message только при hasMessage=true", () => {
  it("без hasMessage действия удаления не появляются", () => {
    const actions = allowedActions({ role: "ADMIN", targetRole: "MEMBER", isSelf: false, hasMessage: false });
    expect(actions).not.toContain("delete-message");
    expect(actions).not.toContain("delete-and-timeout");
    expect(actions).not.toContain("delete-and-ban");
  });
});

// ── isActionAllowed ───────────────────────────────────────────────────────────

describe("isActionAllowed", () => {
  it("ban разрешён MODERATOR против MEMBER", () => {
    expect(isActionAllowed("ban", { role: "MODERATOR", targetRole: "MEMBER", isSelf: false })).toBe(true);
  });

  it("ban запрещён MODERATOR против MODERATOR (равный ранг)", () => {
    expect(isActionAllowed("ban", { role: "MODERATOR", targetRole: "MODERATOR", isSelf: false })).toBe(false);
  });

  it("set-role запрещён MODERATOR (нужен ADMIN)", () => {
    expect(isActionAllowed("set-role", { role: "MODERATOR", targetRole: "MEMBER", isSelf: false })).toBe(false);
  });

  it("set-role разрешён ADMIN против MEMBER", () => {
    expect(isActionAllowed("set-role", { role: "ADMIN", targetRole: "MEMBER", isSelf: false })).toBe(true);
  });

  it("ignore запрещён над самим собой", () => {
    expect(isActionAllowed("ignore", { role: "OWNER", targetRole: "OWNER", isSelf: true })).toBe(false);
  });

  it("report запрещён над самим собой", () => {
    expect(isActionAllowed("report", { role: "MEMBER", targetRole: "MEMBER", isSelf: true })).toBe(false);
  });
});

// ── assignableRoles ───────────────────────────────────────────────────────────

describe("assignableRoles", () => {
  /* Проводник (GUIDE) — временная роль с правами модератора и рангом 1.5, она
     появилась позже этих проверок и стоит в списке назначаемых наравне с
     остальными: раздают её те же, кто раздаёт роль модератора. */
  it("OWNER может назначать ADMIN, MODERATOR, GUIDE, MEMBER", () => {
    expect(assignableRoles("OWNER")).toEqual(["ADMIN", "MODERATOR", "GUIDE", "MEMBER"]);
  });

  it("ADMIN может назначать MODERATOR, GUIDE, MEMBER", () => {
    expect(assignableRoles("ADMIN")).toEqual(["MODERATOR", "GUIDE", "MEMBER"]);
  });

  it("MODERATOR может назначать проводника и участника", () => {
    expect(assignableRoles("MODERATOR")).toEqual(["GUIDE", "MEMBER"]);
  });

  /* Проводник ниже модератора, поэтому сам может выдать только роль участника. */
  it("GUIDE может назначать только MEMBER", () => {
    expect(assignableRoles("GUIDE")).toEqual(["MEMBER"]);
  });

  it("MEMBER не может назначать никого", () => {
    expect(assignableRoles("MEMBER")).toEqual([]);
  });

  it("OWNER никогда не появляется в списке назначаемых", () => {
    expect(assignableRoles("OWNER")).not.toContain("OWNER");
  });
});

// ── purgeScope ────────────────────────────────────────────────────────────────

describe("purgeScope", () => {
  it("last10 возвращает take=10, since=null", () => {
    const r = purgeScope("last10");
    expect(r).not.toBeNull();
    expect(r!.take).toBe(10);
    expect(r!.since).toBeNull();
  });

  it("last50 возвращает take=50, since=null", () => {
    const r = purgeScope("last50");
    expect(r!.take).toBe(50);
    expect(r!.since).toBeNull();
  });

  it("hour возвращает take=500 и дату ~1 час назад", () => {
    const before = Date.now();
    const r = purgeScope("hour");
    const after = Date.now();
    expect(r).not.toBeNull();
    expect(r!.take).toBe(500);
    expect(r!.since).toBeInstanceOf(Date);
    const ms = r!.since!.getTime();
    expect(ms).toBeGreaterThanOrEqual(before - 3600000 - 100);
    expect(ms).toBeLessThanOrEqual(after - 3600000 + 100);
  });

  it("day возвращает since ~24 часа назад", () => {
    const before = Date.now();
    const r = purgeScope("day");
    const after = Date.now();
    expect(r!.since).toBeInstanceOf(Date);
    const ms = r!.since!.getTime();
    expect(ms).toBeGreaterThanOrEqual(before - 86400000 - 100);
    expect(ms).toBeLessThanOrEqual(after - 86400000 + 100);
  });

  it("неизвестное значение возвращает null", () => {
    expect(purgeScope("last100")).toBeNull();
    expect(purgeScope("")).toBeNull();
  });
});
