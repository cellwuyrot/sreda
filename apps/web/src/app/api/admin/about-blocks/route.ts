import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (prisma as any).aboutBlock;

/** GET /api/admin/about-blocks */
export async function GET() {
  const blocks = await db.findMany({ orderBy: { position: "asc" } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json(blocks.map((b: any) => ({ ...b, data: JSON.parse(b.data || "{}") })));
}

/** POST /api/admin/about-blocks */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const last = await db.findFirst({ orderBy: { position: "desc" } });
  const position = (last?.position ?? -1) + 1;

  const block = await db.create({
    data: {
      type:     body.type     ?? "hero",
      position,
      data:     JSON.stringify(body.data ?? {}),
      visible:  body.visible  ?? true,
    },
  });

  return NextResponse.json({ ...block, data: JSON.parse(block.data || "{}") }, { status: 201 });
}

/** PATCH /api/admin/about-blocks — bulk reorder: [{ id, position }] */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const items: Array<{ id: string; position: number }> = await req.json();

  await Promise.all(
    items.map((item) => db.update({ where: { id: item.id }, data: { position: item.position } }))
  );

  return NextResponse.json({ ok: true });
}
