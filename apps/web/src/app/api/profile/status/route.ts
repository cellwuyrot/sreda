import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getIO } from "@/lib/socketEmit";

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const { statusType, customStatus } = await req.json();

  const validTypes = ["online", "away", "dnd", "invisible"];
  if (statusType && !validTypes.includes(statusType)) {
    return NextResponse.json({ error: "Invalid status type" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(statusType !== undefined && { statusType }),
      ...(customStatus !== undefined && { customStatus: customStatus?.slice(0, 80) || null }),
    },
  });

  const io = getIO();
  if (io) {
    io.emit("user-status-changed", { userId, statusType, customStatus });
  }

  return NextResponse.json({ ok: true });
}

/** Profile editor uses PATCH; presence controls continue to use PUT. */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  const data: { customStatus?: string | null; statusEmoji?: string | null } = {};
  for (const [key, limit] of [["customStatus", 100], ["statusEmoji", 10]] as const) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== "string") {
      return NextResponse.json({ error: "Неверный формат статуса" }, { status: 400 });
    }
    data[key] = body[key]?.trim().slice(0, limit) || null;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "Нет данных" }, { status: 400 });
  const updated = await prisma.user.update({
    where: { id: session.user.id }, data,
    select: { customStatus: true, statusEmoji: true },
  });
  getIO()?.emit("user-status-changed", { userId: session.user.id, ...updated });
  return NextResponse.json(updated);
}
