import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isRateLimited } from "@/lib/rateLimit";
import { buildSubscriberConfig, loadTrustTunnelSettings } from "@/lib/trustTunnelAccess";
import { ENTITLEMENT_SELECT, endpointStatusFor, isEntitled, trustTunnelEnabled } from "@/lib/trustTunnelSync";
import type { TrustTunnelSubscriberAccount } from "@/lib/trustTunnelSubscriberPolicy";

const NO_STORE = { "Cache-Control": "no-store, private", "Pragma": "no-cache" };

/** Credentials are only ever delivered to the configured HTTPS origin. */
function sameOrigin(req: Request): boolean | null {
  const appUrl = process.env.NEXTAUTH_URL;
  if (!appUrl) return null;
  try {
    const trusted = new URL(appUrl);
    return trusted.protocol === "https:" && !trusted.username && !trusted.password && req.headers.get("origin") === trusted.origin;
  } catch { return null; }
}

async function auditLog(userId: string, username: string, action: string) {
  try {
    await prisma.auditLog.create({ data: { userId, username, action, target: "User", targetId: userId, details: "{}" } });
  } catch { /* audit failure must not leak details or block the user */ }
}

/**
 * TRUSTTUNNEL-SUBSCRIBERS: issue (or rotate) the caller's own profile.
 * Entitlement: Premium, active «Надёжное соединение» (VPN plan) or project ADMIN.
 * The body may only contain `{ "rotate": true }`; no account id is accepted.
 */
export async function POST(req: Request) {
  const origin = sameOrigin(req);
  if (origin === null) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  if (!origin) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    if (!trustTunnelEnabled()) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
    if (await isRateLimited("trusttunnel-issue", id, { limit: 20, windowMs: 60 * 60 * 1000 }))
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
    let rotate = false;
    const text = await req.text();
    if (text.length > 200) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
    if (text.trim()) {
      let body: unknown;
      try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE }); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "rotate") ||
          ("rotate" in body && typeof (body as { rotate: unknown }).rotate !== "boolean"))
        return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
      rotate = (body as { rotate?: boolean }).rotate === true;
    }
    const settings = loadTrustTunnelSettings();
    const now = new Date();
    const account = await prisma.user.findUnique({ where: { id }, select: ENTITLEMENT_SELECT });
    if (!isEntitled(account as TrustTunnelSubscriberAccount | null, now))
      return NextResponse.json({ error: "not_entitled" }, { status: 403, headers: NO_STORE });
    const access = await prisma.trustTunnelAccess.upsert({
      where: { userId: id },
      create: { userId: id, generation: 1, lastIssuedAt: now },
      update: { disabledAt: null, lastIssuedAt: now, ...(rotate ? { generation: { increment: 1 } } : {}) },
      select: { generation: true },
    });
    const config = buildSubscriberConfig(settings, id, access.generation);
    const endpoint = await endpointStatusFor(settings, id, access.generation);
    await auditLog(id, session.user.username || session.user.name || "user",
      rotate ? "vpn.trusttunnel.profile.rotated" : "vpn.trusttunnel.profile.issued");
    return NextResponse.json({ config, applied: endpoint.applied }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}

/** Switch TrustTunnel off for the caller; the endpoint drops the login on the next sync. */
export async function DELETE(req: Request) {
  const origin = sameOrigin(req);
  if (origin === null) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  if (!origin) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    await prisma.trustTunnelAccess.updateMany({ where: { userId: id, disabledAt: null }, data: { disabledAt: new Date(), generation: { increment: 1 } } });
    await auditLog(id, session.user.username || session.user.name || "user", "vpn.trusttunnel.disabled");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
