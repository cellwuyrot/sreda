import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { registerClient, type ClientInput } from "@/lib/tzIdClients";
import { decryptTzData } from "@/lib/tzIdCrypto";
async function admin() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "ADMIN";
}
export async function GET() {
  if (!(await admin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await prisma.tzIdClient.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(
    rows.map((row) => {
      const metadata = decryptTzData<{
        redirect_uris: string[];
        token_endpoint_auth_method: string;
      }>(row.metadata);
      return {
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        createdAt: row.createdAt,
        redirectUris: metadata.redirect_uris,
        publicClient: metadata.token_endpoint_auth_method === "none",
      };
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  if (!tzIdSameOrigin(req))
    return NextResponse.json(
      { error: "Неверный источник запроса" },
      { status: 403 },
    );
  if (!(await admin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(
      await registerClient((await req.json()) as ClientInput),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Проверьте название и точные HTTPS redirect URI; также настройку TZ ID на сервере",
      },
      { status: 400 },
    );
  }
}
export async function PATCH(req: NextRequest) {
  if (!tzIdSameOrigin(req))
    return NextResponse.json(
      { error: "Неверный источник запроса" },
      { status: 403 },
    );
  if (!(await admin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = await req.json();
  if (typeof input.id !== "string" || typeof input.enabled !== "boolean")
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    await tx.tzIdClient.update({
      where: { id: input.id },
      data: { enabled: input.enabled },
    });
    if (!input.enabled)
      await tx.tzIdAuthorization.updateMany({
        where: { clientId: input.id },
        data: { revokedAt: new Date() },
      });
  });
  return NextResponse.json({ ok: true });
}
