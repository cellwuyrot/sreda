import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { parseVpnProvider, providerControlView, trustTunnelReadiness, type VpnProviderId } from "@/lib/vpnProvider";

const NO_STORE = { "Cache-Control": "no-store" };

function isSerializationConflict(error: unknown): boolean {
  return !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2034";
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

/**
 * VPN-PROVIDER: one global provider, changed only by an administrator.
 * TrustTunnel remains fail-closed until the server-side readiness implementation
 * has actual evidence for every required capability.
 */
export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  if (!tzIdSameOrigin(req)) {
    return NextResponse.json({ error: "Неверный источник запроса" }, { status: 403, headers: NO_STORE });
  }

  const body = (await req.json().catch(() => null)) as
    | { provider?: unknown; confirmed?: unknown; expectedCurrentProvider?: unknown }
    | null;
  const target = body?.provider;
  const expectedCurrentProvider = body?.expectedCurrentProvider;
  if (
    (target !== "AMNEZIAWG" && target !== "TRUSTTUNNEL") ||
    body?.confirmed !== true ||
    (expectedCurrentProvider !== null &&
      expectedCurrentProvider !== "AMNEZIAWG" &&
      expectedCurrentProvider !== "TRUSTTUNNEL")
  ) {
    return NextResponse.json(
      { error: "Укажите поддерживаемого провайдера и подтвердите переключение" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const settings = await tx.vpnSettings.upsert({
        where: { id: "default" },
        create: { id: "default" },
        update: {},
      });
      const currentRaw = typeof settings.activeProvider === "string" ? settings.activeProvider : "AMNEZIAWG";
      const current = parseVpnProvider(currentRaw);
      if (current !== expectedCurrentProvider) {
        return { kind: "stale" as const, currentRaw };
      }

      if (target === "TRUSTTUNNEL") {
        const readiness = trustTunnelReadiness();
        if (!readiness.ready || current !== "AMNEZIAWG") {
          const blockers = readiness.checks.filter((check) => check.status !== "READY");
          await tx.auditLog.create({
            data: {
              userId: actor.id,
              username: actor.username || actor.name || "admin",
              action: "vpn.provider.switch.blocked",
              target: "VpnSettings",
              targetId: "default",
              details: JSON.stringify({
                from: currentRaw,
                to: target,
                blockers: blockers.map((check) => check.id),
                invalidCurrentProvider: current === null,
              }),
            },
          });
          return { kind: "blocked" as const, currentRaw, readiness };
        }
      }

      if (currentRaw === target) return { kind: "unchanged" as const, currentRaw };

      // Compare-and-set plus Serializable transaction prevents two admins from
      // winning concurrent provider changes. Rolling back to AmneziaWG is always
      // permitted, even if TrustTunnel health has degraded.
      const changed = await tx.vpnSettings.updateMany({
        where: { id: "default", activeProvider: currentRaw },
        data: { activeProvider: target },
      });
      if (changed.count !== 1) return { kind: "conflict" as const, currentRaw };

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          username: actor.username || actor.name || "admin",
          action: "vpn.provider.switch",
          target: "VpnSettings",
          targetId: "default",
          details: JSON.stringify({ from: currentRaw, to: target }),
        },
      });
      return { kind: "changed" as const, currentRaw };
    }, { isolationLevel: "Serializable" });

    if (result.kind === "blocked") {
      return NextResponse.json(
        {
          error: "TrustTunnel пока не готов: переключение заблокировано",
          providerControl: providerControlView(result.currentRaw),
          blockers: result.readiness.checks.filter((check) => check.status !== "READY"),
        },
        { status: 409, headers: NO_STORE },
      );
    }
    if (result.kind === "conflict") {
      return NextResponse.json(
        { error: "Провайдер изменился параллельно. Обновите страницу и повторите действие." },
        { status: 409, headers: NO_STORE },
      );
    }
    if (result.kind === "stale") {
      return NextResponse.json(
        {
          error: "Активный провайдер изменился после подтверждения. Проверьте состояние и подтвердите ещё раз.",
          providerControl: providerControlView(result.currentRaw),
        },
        { status: 409, headers: NO_STORE },
      );
    }

    const activeProvider = target as VpnProviderId;
    return NextResponse.json(
      {
        ok: true,
        changed: result.kind === "changed",
        providerControl: providerControlView(activeProvider),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (isSerializationConflict(error)) {
      return NextResponse.json(
        { error: "Параллельное переключение обнаружено. Обновите страницу и проверьте активного провайдера." },
        { status: 409, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "Не удалось безопасно изменить провайдера. Текущая настройка не подтверждена." },
      { status: 500, headers: NO_STORE },
    );
  }
}
