import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/about-blocks          → visible blocks (public)
// GET /api/about-blocks?all=1    → all blocks (admin)
export async function GET(req: NextRequest) {
  const isAll = req.nextUrl.searchParams.get('all') === '1';
  if (isAll) {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = isAll ? undefined : { visible: true };
  const blocks = await prisma.aboutBlock.findMany({
    where,
    orderBy: { position: 'asc' },
  });

  const result = blocks.map((b) => ({
    ...b,
    data: JSON.parse(b.data || '{}'),
  }));

  return NextResponse.json(result);
}

// POST /api/about-blocks  → create (admin)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { type, data } = body as { type: string; data: Record<string, unknown> };

  const maxPos = await prisma.aboutBlock.aggregate({ _max: { position: true } });
  const position = (maxPos._max.position ?? -1) + 1;

  const block = await prisma.aboutBlock.create({
    data: {
      type,
      position,
      data: JSON.stringify(data ?? {}),
    },
  });

  return NextResponse.json({ ...block, data: JSON.parse(block.data || '{}') });
}

// PUT /api/about-blocks  → update (admin)
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { id, data, visible, position } = body as {
    id: string;
    data?: Record<string, unknown>;
    visible?: boolean;
    position?: number;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};
  if (data !== undefined)     updateData.data     = JSON.stringify(data);
  if (visible !== undefined)  updateData.visible  = visible;
  if (position !== undefined) updateData.position = position;

  const block = await prisma.aboutBlock.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ ...block, data: JSON.parse(block.data || '{}') });
}

// DELETE /api/about-blocks  → delete (admin)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json() as { id: string };
  await prisma.aboutBlock.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
