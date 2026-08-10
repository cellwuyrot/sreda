import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * POST /api/welcome/decline
 * Called when user rejects the ToS / privacy consent.
 * Permanently deletes the account so no personal data is stored.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  // Hard-delete the account — no personal data should remain
  await prisma.user.delete({ where: { id: userId } });

  return NextResponse.json({ deleted: true });
}
