import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

type AnyBlock = {
  id: string;
  type: string;
  position: number;
  data: string;
  visible: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (prisma as any).aboutBlock as {
  findMany: (args: unknown) => Promise<AnyBlock[]>;
  findFirst: (args: unknown) => Promise<AnyBlock | null>;
  create: (args: unknown) => Promise<AnyBlock>;
  update: (args: unknown) => Promise<AnyBlock>;
  delete: (args: unknown) => Promise<AnyBlock>;
};

function serialize(b: AnyBlock) {
  let data: unknown = {};
  try { data = JSON.parse(b.data); } catch { /* keep empty obj */ }
  return { ...b, data };
}

// GET /api/about-blocks
// Public   → visible blocks ordered by position
// Admin + ?all=1 → all blocks including hidden
export async function GET(req: NextRequest) {
  const isAll = new URL(req.url).searchParams.get('all') === '1';

  if (isAll) {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const blocks = await db.findMany({
    where: isAll ? { type: { not: "legal" } } : { visible: true, type: { not: "legal" } },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json(blocks.map(serialize));
}

// POST /api/about-blocks — create block (admin only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as {
    type?: string;
    position?: number;
    data?: Record<string, unknown>;
    visible?: boolean;
  };

  if (!body.type) return NextResponse.json({ error: 'type required' }, { status: 400 });
  if (body.type === "legal") {
    return NextResponse.json({ error: "legal block is no longer supported" }, { status: 400 });
  }

  let pos = body.position;
  if (pos === undefined) {
    const last = await db.findFirst({ orderBy: { position: 'desc' } });
    pos = (last?.position ?? -1) + 1;
  }

  const block = await db.create({
    data: {
      type: body.type,
      position: pos,
      data: JSON.stringify(body.data ?? {}),
      visible: body.visible ?? true,
    },
  });

  return NextResponse.json(serialize(block), { status: 201 });
}

// PUT /api/about-blocks — update block (admin only)
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as {
    id?: string;
    type?: string;
    position?: number;
    data?: Record<string, unknown>;
    visible?: boolean;
  };

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (body.type === "legal") {
    return NextResponse.json({ error: "legal block is no longer supported" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.type     !== undefined) updateData.type     = body.type;
  if (body.position !== undefined) updateData.position = body.position;
  if (body.visible  !== undefined) updateData.visible  = body.visible;
  if (body.data     !== undefined) updateData.data     = JSON.stringify(body.data);

  try {
    const block = await db.update({ where: { id: body.id }, data: updateData });
    return NextResponse.json(serialize(block));
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

// DELETE /api/about-blocks — delete block (admin only)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  try {
    await db.delete({ where: { id: body.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
