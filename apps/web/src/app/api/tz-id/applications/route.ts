import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.tzIdAuthorization.findMany({
    where: {
      userId: session.user.id,
      revokedAt: null,
      session: {
        active: true,
        expiresAt: { gt: new Date() },
      },
    },
    include: { client: { select: { id: true, name: true, enabled: true } } },
    orderBy: { lastUsedAt: "desc" },
  });
  const apps = new Map<
    string,
    {
      id: string;
      name: string;
      enabled: boolean;
      scopes: string[];
      lastUsedAt: Date;
    }
  >();
  for (const row of rows) {
    const current = apps.get(row.clientId);
    if (current)
      current.scopes = [
        ...new Set([...current.scopes, ...row.scopes.split(" ")]),
      ];
    else
      apps.set(row.clientId, {
        ...row.client,
        scopes: row.scopes.split(" "),
        lastUsedAt: row.lastUsedAt,
      });
  }
  return NextResponse.json([...apps.values()], {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function DELETE(req: NextRequest) {
  if (!tzIdSameOrigin(req))
    return NextResponse.json(
      { error: "Неверный источник запроса" },
      { status: 403 },
    );
  const session = await getServerSession(authOptions);
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId)
    return NextResponse.json({ error: "Укажите приложение" }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    const rows = await tx.tzIdAuthorization.findMany({
      where: { userId: session.user.id, clientId },
      select: { id: true },
    });
    await tx.tzIdAuthorization.updateMany({
      where: { userId: session.user.id, clientId },
      data: { revokedAt: new Date() },
    });
    await tx.tzIdArtifact.deleteMany({
      where: { grantId: { in: rows.map((row) => row.id) } },
    });
  });
  return NextResponse.json({ ok: true });
}
