import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isRateLimited } from "@/lib/rateLimit";
import { isTrustTunnelPilotAllowed } from "@/lib/trustTunnelPilotPolicy";
import { profileForPilotAccount } from "@/lib/trustTunnelPilotBundle";
import { loadPilotSecret } from "@/lib/trustTunnelPilotSecret";

const NO_STORE = { "Cache-Control": "no-store, private", "Pragma": "no-cache" };
/** Pilot only: disabled by default, never changes the global provider. */
export async function POST(req: Request) {
  try {
    // Do not trust an incoming Host header as the origin for credential delivery.
    // A configured HTTPS origin is mandatory, including in the pilot.
    const appUrl = process.env.NEXTAUTH_URL;
    if (!appUrl) return NextResponse.json({ error: "Pilot unavailable" }, { status: 503, headers: NO_STORE });
    const trusted = new URL(appUrl);
    if (trusted.protocol !== "https:" || trusted.username || trusted.password || req.headers.get("origin") !== trusted.origin)
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
    const session = await getServerSession(authOptions);
    const id = session?.user?.id;
    if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (await isRateLimited("trusttunnel-pilot-issue", id, { limit: 20, windowMs: 60 * 60 * 1000 }))
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE });
    const account = await prisma.user.findUnique({ where: { id },
      select: { id: true, role: true, isDeleted: true, banned: true, bannedUntil: true } });
    if (!isTrustTunnelPilotAllowed({ enabled: process.env.TRIOZ_TT_PILOT_ENABLED,
      allowedAdminIds: process.env.TRIOZ_TT_PILOT_ADMIN_IDS, account, now: new Date() }))
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    // A human operator may only turn this on once the authenticated pilot engine
    // and endpoint provisioning exist. This gate is not production readiness.
    if (process.env.TRIOZ_TT_PILOT_ISSUE_ENABLED !== "true")
      return NextResponse.json({ error: "Pilot unavailable" }, { status: 503, headers: NO_STORE });
    const { key, bundle } = loadPilotSecret();
    const config = profileForPilotAccount(id, key, bundle);
    if (!config) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    await prisma.auditLog.create({ data: { userId: id, username: session.user.username || session.user.name || "admin",
      action: "vpn.trusttunnel.pilot.profile.issued", target: "User", targetId: id, details: "{}" } });
    return NextResponse.json({ config }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Pilot unavailable" }, { status: 503, headers: NO_STORE });
  }
}
