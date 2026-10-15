import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { registerClient, type ClientInput } from "@/lib/tzIdClients";
import { encryptTzData, decryptTzData } from "@/lib/tzIdCrypto";
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
        apiScopes: (metadata as { scope?: string }).scope?.split(" ").filter(s => s.includes(":")) || [],
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
  let input: { id?: unknown; enabled?: unknown; projectRoles?: unknown };
  try { input = await req.json(); } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }
  if (typeof input.id !== "string" || input.id.length > 100 || (typeof input.enabled !== "boolean" && typeof input.projectRoles !== "boolean"))
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const clientId = input.id;
  try {
    await prisma.$transaction(async tx => {
      const current = await tx.tzIdClient.findUniqueOrThrow({ where: { id: clientId } });
      let metadata = current.metadata;
      if (typeof input.projectRoles === "boolean") {
        const meta = decryptTzData<{ scope?: string; token_endpoint_auth_method: string }>(metadata);
        if (input.projectRoles && meta.token_endpoint_auth_method === "none") throw new Error("Confidential client required");
        const scopes = new Set((meta.scope || "openid profile email").split(" "));
        if (input.projectRoles) scopes.add("roles:read"); else scopes.delete("roles:read");
        metadata = encryptTzData({ ...meta, scope: [...scopes].join(" ") });
      }
      await tx.tzIdClient.update({ where: { id: clientId }, data: { metadata, ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}) } });
      if (input.enabled === false)
        await tx.tzIdAuthorization.updateMany({ where: { clientId }, data: { revokedAt: new Date() } });
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Проверьте приложение и тип клиента" }, { status: 400 }); }
}
