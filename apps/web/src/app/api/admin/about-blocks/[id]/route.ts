import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (prisma as any).aboutBlock;

/** PUT /api/admin/about-blocks/[id] — update block */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const updateData: Record<string, unknown> = {};
    if (body.type     !== undefined) updateData.type     = body.type;
    if (body.position !== undefined) updateData.position = body.position;
    if (body.visible  !== undefined) updateData.visible  = body.visible;
    if (body.data     !== undefined) updateData.data     = typeof body.data === "string"
      ? body.data
      : JSON.stringify(body.data);
    updateData.updatedAt = new Date();

    const block = await db.update({ where: { id }, data: updateData });
    return NextResponse.json({ ...block, data: JSON.parse(block.data || "{}") });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** DELETE /api/admin/about-blocks/[id] — delete block */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await db.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
