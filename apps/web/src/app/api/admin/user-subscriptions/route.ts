import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { positiveInteger } from "@/lib/adminPagination";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Read the same central connections written by Business fulfillment, not a second payment ledger.
 * Reading never issues rights, charges a card or marks a payment successful. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "EDITOR") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") || "").trim().slice(0, 200);
  const where = { isDeleted: false, ...(q ? { OR: [
    { name: { contains: q, mode: "insensitive" as const } },
    { username: { contains: q, mode: "insensitive" as const } },
    ...(role === "ADMIN" ? [{ email: { contains: q, mode: "insensitive" as const } }] : []),
  ] } : {}) };
  try {
    const perPage = positiveInteger(params.get("perPage"), 15, 50);
    const total = await prisma.user.count({ where });
    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(positiveInteger(params.get("page"), 1), pages);
    const users = await prisma.user.findMany({ where, skip: (page - 1) * perPage, take: perPage,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, name: true, username: true, role: true, isPremium: true, vpnAccess: true, vpnAccessUntil: true,
        ...(role === "ADMIN" ? { email: true } : {}) },
    });
    const userIds = users.map(u => u.id);
    const connections = userIds.length ? await prisma.tzManagedConnection.findMany({
      where: { userId: { in: userIds } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1001,
      select: { id: true, userId: true, title: true, accessKind: true, status: true, paidUntil: true, manualState: true, updatedAt: true },
    }) : [];
    const now = new Date();
    return NextResponse.json({ users: users.map(user => ({ ...user,
      connections: connections.slice(0, 1000).filter(c => c.userId === user.id).map(c => ({
        ...c, status: c.paidUntil <= now && ["ACTIVE", "PENDING"].includes(c.status) ? "EXPIRED" : c.status,
      })),
    })), total, page, pages, truncated: connections.length > 1000, refreshedAt: now.toISOString() }, { headers });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить подписки. Повторите обновление." }, { status: 503, headers });
  }
}
