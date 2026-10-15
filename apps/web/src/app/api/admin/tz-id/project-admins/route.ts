import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { decryptTzData } from "@/lib/tzIdCrypto";
import { HubError } from "@/lib/tzIdHub";
import { projectRoleInput } from "@/lib/tzIdProjectRoles";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId || clientId.length > 100) return NextResponse.json({ error: "Укажите ID приложения" }, { status: 400 });
  const rows = await prisma.tzIdProjectRole.findMany({
    where: { clientId, revokedAt: null }, orderBy: { updatedAt: "desc" },
    select: { userId: true, role: true, updatedAt: true, user: { select: { name: true, username: true } } },
  });
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(req: NextRequest) {
  if (!tzIdSameOrigin(req)) return NextResponse.json({ error: "Неверный источник запроса" }, { status: 403 });
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const input = projectRoleInput(await req.json());
    const client = await prisma.tzIdClient.findUnique({ where: { id: input.clientId } });
    if (!client) throw new HubError("Приложение не найдено", 404);
    const meta = decryptTzData<{ token_endpoint_auth_method: string; scope?: string }>(client.metadata);
    if (input.enabled && (!client.enabled || meta.token_endpoint_auth_method === "none" || !meta.scope?.split(" ").includes("roles:read")))
      throw new HubError("Для назначения включите confidential client и разрешите roles:read");
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, isDeleted: true } });
    if (!user || user.isDeleted) throw new HubError("Пользователь с таким TZ ID не найден", 404);
    await prisma.$transaction(async tx => {
      await tx.tzIdProjectRole.upsert({
        where: { clientId_userId: { clientId: input.clientId, userId: input.userId } },
        create: { clientId: input.clientId, userId: input.userId, role: "ADMIN", revokedAt: input.enabled ? null : new Date() },
        update: { role: "ADMIN", revokedAt: input.enabled ? null : new Date() },
      });
      // Append audit record atomically with the grant; no audit deduplication.
      await tx.auditLog.create({ data: {
        userId: session.user.id, username: session.user.username || session.user.name || "admin",
        action: input.enabled ? "grant" : "revoke", target: "TzIdProjectRole", targetId: input.userId,
        details: `client=${input.clientId}; role=ADMIN`,
      } });
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof HubError ? e.message : "Не удалось изменить права" }, { status: e instanceof HubError ? e.status : 400 });
  }
}
