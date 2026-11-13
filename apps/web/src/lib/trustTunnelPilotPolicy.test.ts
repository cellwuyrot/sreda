import { describe, expect, it } from "vitest";
import { isTrustTunnelPilotAllowed, type PilotPolicyInput } from "./trustTunnelPilotPolicy";

const base = (): PilotPolicyInput => ({
  enabled: "true", allowedAdminIds: "admin_1,admin_2", now: new Date("2026-11-14T00:00:00Z"),
  account: { id: "admin_1", role: "ADMIN", isDeleted: false, banned: false, bannedUntil: null },
});

describe("TrustTunnel pilot access policy", () => {
  it("allows an explicitly listed project ADMIN", () => expect(isTrustTunnelPilotAllowed(base())).toBe(true));
  it("fails closed when disabled or allowlist absent or invalid", () => {
    for (const value of [undefined, "false", "TRUE", "1"]) expect(isTrustTunnelPilotAllowed({ ...base(), enabled: value })).toBe(false);
    for (const value of [undefined, "", "admin_1,", "*", "admin_1,not allowed"]) expect(isTrustTunnelPilotAllowed({ ...base(), allowedAdminIds: value })).toBe(false);
  });
  it("rejects unlisted, missing and deleted users", () => {
    expect(isTrustTunnelPilotAllowed({ ...base(), account: null })).toBe(false);
    for (const change of [{ id: "admin_3" }, { isDeleted: true }]) {
      const input = base(); input.account = { ...input.account!, ...change };
      expect(isTrustTunnelPilotAllowed(input)).toBe(false);
    }
  });
  it("rejects group admins and other project roles", () => {
    for (const role of ["USER", "EDITOR", "OWNER", "MODERATOR"]) {
      const input = base(); input.account!.role = role;
      expect(isTrustTunnelPilotAllowed(input)).toBe(false);
    }
  });
  it("rejects permanent, active and invalid bans; permits expired bans", () => {
    for (const until of [null, new Date("2026-12-01T00:00:00Z"), new Date("invalid")]) {
      const input = base(); input.account!.banned = true; input.account!.bannedUntil = until;
      expect(isTrustTunnelPilotAllowed(input)).toBe(false);
    }
    const input = base(); input.account!.banned = true; input.account!.bannedUntil = new Date("2026-01-01T00:00:00Z");
    expect(isTrustTunnelPilotAllowed(input)).toBe(true);
  });
});
