import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hubSnapshot, updateHub, HubError } from "@/lib/tzIdHub";
import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { rateLimit } from "@/lib/rateLimit";
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await hubSnapshot(session.user.id), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(req: NextRequest) {
  if (!tzIdSameOrigin(req))
    return NextResponse.json(
      { error: "Неверный источник запроса" },
      { status: 403 },
    );
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await rateLimit(req, "tz-id-hub", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;
  if (Number(req.headers.get("content-length")) > 8192)
    return NextResponse.json(
      { error: "Запрос слишком большой" },
      { status: 413 },
    );
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HubError("Некорректные данные");
    await updateHub(session.user.id, body);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof HubError ? e.message : "Не удалось сохранить данные",
      },
      { status: e instanceof HubError ? e.status : 400 },
    );
  }
}
