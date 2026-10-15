import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

// TZ ID sub is the existing User.id, not email or a separate numeric identifier.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  const { id } = await params;
  if (!id || id.length > 128) return NextResponse.json({ error: "Invalid identifier" }, { status: 400, headers });
  try {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
    return NextResponse.json({ tzId: user.id }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not retrieve TZ ID" }, { status: 500, headers });
  }
}
