import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// PUT /api/groups/reorder — update the sort order of groups for the current user
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupIds } = await req.json();
    if (!Array.isArray(groupIds)) {
      return NextResponse.json({ error: "groupIds array required" }, { status: 400 });
    }

    // Update sortOrder for each group membership
    const updates = groupIds.map((groupId: string, index: number) =>
      prisma.groupMember.updateMany({
        where: { userId: session.user.id, groupId },
        data: { sortOrder: index },
      })
    );

    await prisma.$transaction(updates);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
  }
}
