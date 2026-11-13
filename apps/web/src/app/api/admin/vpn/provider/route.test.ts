import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { POST } from "./route";

const ORIGIN = "https://trioz.test";

function request(body: unknown, origin: string | null = ORIGIN) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request(`${ORIGIN}/api/admin/vpn/provider`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function call(body: unknown, origin: string | null = ORIGIN) {
  const response = await POST(request(body, origin));
  return { status: response.status, body: await response.json() };
}

function mockTransaction() {
  prismaMock.$transaction.mockImplementation(
    row(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)),
  );
}

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", ORIGIN);
  vi.mocked(getServerSession).mockResolvedValue(
    row({ user: { id: "admin-1", username: "owner", role: "ADMIN" } }),
  );
  mockTransaction();
  prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "AMNEZIAWG" }));
  prismaMock.vpnSettings.updateMany.mockResolvedValue(row({ count: 1 }));
  prismaMock.auditLog.create.mockResolvedValue(row({ id: "audit-1" }));
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/vpn/provider", () => {
  it.each([null, "USER", "EDITOR", "CONSULTANT"])("только ADMIN может переключать провайдера (%s)", async (role) => {
    vi.mocked(getServerSession).mockResolvedValue(
      role ? row({ user: { id: "u1", role } }) : null,
    );
    expect((await call({ provider: "TRUSTTUNNEL", confirmed: true, expectedCurrentProvider: "AMNEZIAWG" })).status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("отклоняет cross-origin запрос до транзакции", async () => {
    expect((await call({ provider: "TRUSTTUNNEL", confirmed: true, expectedCurrentProvider: "AMNEZIAWG" }, "https://attacker.invalid")).status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("отклоняет запрос без Origin", async () => {
    expect((await call({ provider: "TRUSTTUNNEL", confirmed: true, expectedCurrentProvider: "AMNEZIAWG" }, null)).status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("требует явное подтверждение и известный провайдер", async () => {
    expect((await call({ provider: "TRUSTTUNNEL" })).status).toBe(400);
    expect((await call({ provider: "OTHER", confirmed: true, expectedCurrentProvider: "AMNEZIAWG" })).status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("fail-closed: блокирует TrustTunnel и пишет аудит без изменения активного провайдера", async () => {
    const result = await call({ provider: "TRUSTTUNNEL", confirmed: true, expectedCurrentProvider: "AMNEZIAWG" });
    expect(result.status).toBe(409);
    expect(result.body.providerControl.activeProvider).toBe("AMNEZIAWG");
    expect(result.body.providerControl.trustTunnel.ready).toBe(false);
    expect(result.body.blockers).toHaveLength(6);
    expect(prismaMock.vpnSettings.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "admin-1",
        action: "vpn.provider.switch.blocked",
        target: "VpnSettings",
        targetId: "default",
        details: expect.stringContaining('"to":"TRUSTTUNNEL"'),
      }),
    });
  });

  it("поля readiness в запросе не могут обойти серверную проверку", async () => {
    const result = await call({
      provider: "TRUSTTUNNEL",
      confirmed: true,
      expectedCurrentProvider: "AMNEZIAWG",
      readiness: { endpoint: true, credentials: true, accounting: true, android: true, windows: true, gateway: true },
    });
    expect(result.status).toBe(409);
    expect(prismaMock.vpnSettings.updateMany).not.toHaveBeenCalled();
  });

  it("повторный выбор активного AmneziaWG безопасно идемпотентен", async () => {
    const result = await call({ provider: "AMNEZIAWG", confirmed: true, expectedCurrentProvider: "AMNEZIAWG" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, changed: false });
    expect(prismaMock.vpnSettings.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("откат к AmneziaWG разрешён и аудируется даже если сейчас активен TrustTunnel", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL" }));
    const result = await call({ provider: "AMNEZIAWG", confirmed: true, expectedCurrentProvider: "TRUSTTUNNEL" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, changed: true, providerControl: { activeProvider: "AMNEZIAWG" } });
    expect(prismaMock.vpnSettings.updateMany).toHaveBeenCalledWith({
      where: { id: "default", activeProvider: "TRUSTTUNNEL" },
      data: { activeProvider: "AMNEZIAWG" },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "vpn.provider.switch",
        details: JSON.stringify({ from: "TRUSTTUNNEL", to: "AMNEZIAWG" }),
      }),
    });
  });

  it("отказывает при гонке двух переключений", async () => {
    prismaMock.vpnSettings.updateMany.mockResolvedValue(row({ count: 0 }));
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL" }));
    const result = await call({ provider: "AMNEZIAWG", confirmed: true, expectedCurrentProvider: "TRUSTTUNNEL" });
    expect(result.status).toBe(409);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("отклоняет подтверждение устаревшего активного провайдера", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL" }));
    const result = await call({ provider: "AMNEZIAWG", confirmed: true, expectedCurrentProvider: "AMNEZIAWG" });
    expect(result.status).toBe(409);
    expect(result.body.providerControl.activeProvider).toBe("TRUSTTUNNEL");
    expect(prismaMock.vpnSettings.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
