import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma.aboutBlock as any;

export async function GET(req: NextRequest) {
  const isAll = req.nextUrl.searchParams.get('all') === '1';
  if (isAll) {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const blocks = await db.findMany({
    where: isAll ? undefined : { visible: true },
    orderBy: { position: 'asc' },
  });

  return NextResponse.json(
    blocks.map((b: { data: string; [k: string]: unknown }) => ({
      ...b,
      data: JSON.parse(b.data || '{}'),
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { type, data } = await req.json() as { type: string; data: Record<string, unknown> };
  const maxPos = await db.aggregate({ _max: { position: true } });
  const position = (maxPos._max.position ?? -1) + 1;

  const block = await db.create({ data: { type, position, data: JSON.stringify(data ?? {}) } });
  return NextResponse.json({ ...block, data: JSON.parse(block.data || '{}') });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, data, visible, position } = await req.json() as {
    id: string; data?: Record<string, unknown>; visible?: boolean; position?: number;
  };

  const upd: Record<string, unknown> = {};
  if (data !== undefined)     upd.data     = JSON.stringify(data);
  if (visible !== undefined)  upd.visible  = visible;
  if (position !== undefined) upd.position = position;

  const block = await db.update({ where: { id }, data: upd });
  return NextResponse.json({ ...block, data: JSON.parse(block.data || '{}') });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json() as { id: string };
  await db.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
