import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";

async function checkGroupAdmin(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  return membership && (membership.role === "OWNER" || membership.role === "MODERATOR" || membership.role === "ADMIN");
}

// GET /api/groups/[id]/roles — list all custom roles for a group
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const roles = await prisma.groupRole.findMany({
    where: { groupId: id },
    include: {
      _count: { select: { members: true, channels: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(roles);
}

// POST /api/groups/[id]/roles — create a new custom role
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать создавать роли в группах.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const isAdmin = await checkGroupAdmin(session.user.id, id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, color } = await req.json();
  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (name.length > 32) {
    return NextResponse.json({ error: "Name too long (max 32)" }, { status: 400 });
  }

  const existing = await prisma.groupRole.findUnique({
    where: { groupId_name: { groupId: id, name: name.trim() } },
  });
  if (existing) {
    return NextResponse.json({ error: "Role with this name already exists" }, { status: 409 });
  }

  const role = await prisma.groupRole.create({
    data: {
      name: name.trim(),
      color: color || "#808080",
      groupId: id,
    },
  });

  return NextResponse.json(role);
}
