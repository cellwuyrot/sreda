import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (prisma as any).aboutBlock;

// GET /api/about-blocks
// Public: returns visible blocks ordered by position.
// Admin with ?all=1: returns all blocks including hidden.
export async function GET(req: NextRequest) {
  const isAll = new URL(req.url).searchParams.get('all') === '1';

  if (isAll) {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const blocks = await db.findMany({
    where: isAll ? undefined : { visible: true },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks.map((b: any) => ({ ...b, data: JSON.parse(b.data) })),
  );
}

// POST /api/about-blocks — create a new block (admin only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { type, position, data } = body as {
    type: string;
    position?: number;
    data?: Record<string, unknown>;
  };

  if (!type) return NextResponse.json({ error: 'type required' }, { status: 400 });

  // Find max position if not provided
  let pos = position;
  if (pos === undefined) {
    const last = await db.findFirst({ orderBy: { position: 'desc' } });
    pos = (last?.position ?? -1) + 1;
  }

  const block = await db.create({
    data: {
      type,
      position: pos,
      data: JSON.stringify(data ?? {}),
      visible: true,
    },
  });

  return NextResponse.json({ ...block, data: JSON.parse(block.data) }, { status: 201 });
}

// PUT /api/about-blocks — update a block (admin only)
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { id, type, position, data, visible } = body as {
    id: string;
    type?: string;
    position?: number;
    data?: Record<string, unknown>;
    visible?: boolean;
  };

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const block = await db.update({
    where: { id },
    data: {
      ...(type !== undefined ? { type } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(data !== undefined ? { data: JSON.stringify(data) } : {}),
      ...(visible !== undefined ? { visible } : {}),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ...block, data: JSON.parse(block.data) });
}

// DELETE /api/about-blocks — delete a block (admin only)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = (await req.json()) as { id: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await db.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
