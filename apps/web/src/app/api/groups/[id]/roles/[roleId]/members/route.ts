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

// GET /api/groups/[id]/roles/[roleId]/members — list members with this role
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, roleId } = await params;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const members = await prisma.groupMemberRole.findMany({
    where: { roleId },
    include: {
      member: {
        include: {
          user: { select: { id: true, name: true, username: true, avatar: true } },
        },
      },
    },
  });

  return NextResponse.json(members.map((m) => ({
    memberId: m.memberId,
    user: m.member.user,
  })));
}

// POST /api/groups/[id]/roles/[roleId]/members — assign role to a member
export async function POST(req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, roleId } = await params;
  const isAdmin = await checkGroupAdmin(session.user.id, id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const member = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: id } },
  });
  if (!member) {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 });
  }

  const role = await prisma.groupRole.findFirst({
    where: { id: roleId, groupId: id },
  });
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  const assignment = await prisma.groupMemberRole.upsert({
    where: { memberId_roleId: { memberId: member.id, roleId } },
    update: {},
    create: { memberId: member.id, roleId },
  });

  return NextResponse.json(assignment);
}

// DELETE /api/groups/[id]/roles/[roleId]/members — remove role from a member
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, roleId } = await params;
  const isAdmin = await checkGroupAdmin(session.user.id, id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const member = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: id } },
  });
  if (!member) {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 });
  }

  await prisma.groupMemberRole.deleteMany({
    where: { memberId: member.id, roleId },
  });

  return NextResponse.json({ success: true });
}
