import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

type AnyBlock = { id: string; type: string; position: number; data: string; visible: boolean; createdAt: Date; updatedAt: Date };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (prisma as any).aboutBlock as { update:(a:unknown)=>Promise<AnyBlock>; delete:(a:unknown)=>Promise<void> };
const ser = (b: AnyBlock) => ({ ...b, data: (() => { try { return JSON.parse(b.data); } catch { return {}; } })() });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as { type?: string; position?: number; visible?: boolean; data?: Record<string,unknown> };
  const upd: Record<string, unknown> = { updatedAt: new Date() };
  if (body.type     !== undefined) upd.type     = body.type;
  if (body.position !== undefined) upd.position = body.position;
  if (body.visible  !== undefined) upd.visible  = body.visible;
  if (body.data     !== undefined) upd.data     = JSON.stringify(body.data);
  try {
    const block = await db.update({ where: { id }, data: upd });
    return NextResponse.json(ser(block));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    await db.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
