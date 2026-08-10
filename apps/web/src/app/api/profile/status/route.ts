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
