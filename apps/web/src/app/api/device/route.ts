import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClientIp, isIdentityBlocked, recordIdentities } from "@/lib/identity";

/**
 * НОВОЕ: POST /api/device — клиент сообщает свой ID устройства (в десктопе —
 * стабильный ID профиля приложения). Сервер может записать IP для диагностики,
 * но блокировка и авторизация зависят только от ID устройства — смена VPN/IP
 * не должна менять состояние клиентской сессии.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let deviceId: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.deviceId === "string" && body.deviceId.length > 0 && body.deviceId.length <= 128) {
      deviceId = body.deviceId;
    }
  } catch {
    /* тело необязательно */
  }

  const ip = getClientIp(req);
  await recordIdentities(session.user.id, ip, deviceId);
  const blocked = await isIdentityBlocked(ip, deviceId);

  return NextResponse.json({ blocked });
}
