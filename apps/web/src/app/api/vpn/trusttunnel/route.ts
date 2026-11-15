import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { loadTrustTunnelSettings } from "@/lib/trustTunnelAccess";
import { getVpnSettings } from "@/lib/vpn";
import { parseVpnProvider } from "@/lib/vpnProvider";
import { ENTITLEMENT_SELECT, endpointStatusFor, isEntitled, trustTunnelEnabled, trustTunnelProviderIsActive } from "@/lib/trustTunnelSync";
import type { TrustTunnelSubscriberAccount } from "@/lib/trustTunnelSubscriberPolicy";

const NO_STORE = { "Cache-Control": "no-store, private" };

/**
 * TRUSTTUNNEL-SUBSCRIBERS: status for the current account. Never returns
 * credentials. `applied` means the endpoint agent confirmed the account's
 * current credentials; it is not a network connectivity test.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    const vpnSettings = await getVpnSettings();
    const activeProvider = parseVpnProvider(vpnSettings.activeProvider);
    const selected = activeProvider === "TRUSTTUNNEL";
    const serviceEnabled = vpnSettings.enabled === true;
    const base = { activeProvider, selected, serviceEnabled, available: false, eligible: false, enabled: false, applied: false, planLabel: "Нет активного доступа" };
    if (!selected || !serviceEnabled || !trustTunnelEnabled() || !(await trustTunnelProviderIsActive())) {
      return NextResponse.json(base, { headers: NO_STORE });
    }
    const settings = loadTrustTunnelSettings();
    const now = new Date();
    const account = await prisma.user.findUnique({ where: { id }, select: ENTITLEMENT_SELECT });
    const eligible = isEntitled(account as TrustTunnelSubscriberAccount | null, now);
    const planLabel = account?.role === "ADMIN" ? "Доступ администратора проекта"
      : account?.isPremium ? "Premium" : eligible ? "Надёжное соединение" : "Нет активной подписки";
    const access = await prisma.trustTunnelAccess.findUnique({ where: { userId: id }, select: { generation: true, disabledAt: true } });
    const enabled = !!access && access.disabledAt === null;
    const endpoint = eligible && enabled ? await endpointStatusFor(settings, id, access.generation)
      : { applied: false, lastSyncAt: null, agentError: false };
    return NextResponse.json({ ...base, available: true, eligible, enabled, planLabel, ...endpoint }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ activeProvider: null, selected: false, serviceEnabled: false, available: false, eligible: false, enabled: false, applied: false, planLabel: "Нет данных о доступе" }, { headers: NO_STORE });
  }
}
