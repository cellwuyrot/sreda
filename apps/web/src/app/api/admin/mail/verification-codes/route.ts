import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");
  const types = new Set(["register", "login", "reset"]);
  const type = typeParam && types.has(typeParam) ? typeParam : null;
  const q = (url.searchParams.get("q") || "").trim();

  const rows = await prisma.verificationCode.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(q ? { email: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      code: true,
      type: true,
      expiresAt: true,
      used: true,
      sendStatus: true,
      sendError: true,
      createdAt: true,
      mailMessage: {
        select: {
          id: true,
          deliveryStatus: true,
          deliveryError: true,
          messageId: true,
          sentAt: true,
        },
      },
    },
  });

  return NextResponse.json({ codes: rows });
}
