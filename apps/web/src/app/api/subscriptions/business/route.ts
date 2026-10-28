import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { businessSubscriptionOffers } from "@/lib/businessSubscriptionCatalog";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401, headers });
  if (await checkBan(session.user.id)) return NextResponse.json({ error: "Доступ ограничен" }, { status: 403, headers });
  try { return NextResponse.json({ offers: await businessSubscriptionOffers() }, { headers }); }
  catch { return NextResponse.json({ error: "Не удалось загрузить подписки. Попробуйте ещё раз." }, { status: 503, headers }); }
}
