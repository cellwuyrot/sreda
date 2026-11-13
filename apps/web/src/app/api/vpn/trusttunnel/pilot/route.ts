import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isTrustTunnelPilotAllowed } from "@/lib/trustTunnelPilotPolicy";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Read-only eligibility check. Does not provision credentials, enable a VPN,
 * change provider state, check the network, or imply a usable connection.
 * Every future sensitive pilot operation must repeat the fresh DB check.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  try {
    const account = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isDeleted: true, banned: true, bannedUntil: true },
    });
    if (!isTrustTunnelPilotAllowed({
      enabled: process.env.TRIOZ_TT_PILOT_ENABLED,
      allowedAdminIds: process.env.TRIOZ_TT_PILOT_ADMIN_IDS,
      account,
      now: new Date(),
    })) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({
      eligible: true,
      connectionReady: false,
      message: "Пилот TrustTunnel ещё не подключён: конфигурация и VPN-клиенты не готовы.",
    }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
}
