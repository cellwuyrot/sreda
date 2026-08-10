import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function checkGroupAdmin(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  return membership && (membership.role === "OWNER" || membership.role === "MODERATOR" || membership.role === "ADMIN");
}

// PUT /api/groups/[id]/roles/[roleId] — update role name/color
export async function PUT(req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, roleId } = await params;
  const isAdmin = await checkGroupAdmin(session.user.id, id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = await prisma.groupRole.findFirst({
    where: { id: roleId, groupId: id },
  });
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  const { name, color } = await req.json();

  const updated = await prisma.groupRole.update({
    where: { id: roleId },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(color !== undefined && { color }),
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/groups/[id]/roles/[roleId] — delete a role
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, roleId } = await params;
  const isAdmin = await checkGroupAdmin(session.user.id, id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = await prisma.groupRole.findFirst({
    where: { id: roleId, groupId: id },
  });
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  await prisma.groupRole.delete({ where: { id: roleId } });

  return NextResponse.json({ success: true });
}
