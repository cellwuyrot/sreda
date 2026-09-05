import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

type AnyBlock = { id: string; type: string; position: number; data: string; visible: boolean; createdAt: Date; updatedAt: Date };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (prisma as any).aboutBlock as { findMany:(a:unknown)=>Promise<AnyBlock[]>; findFirst:(a:unknown)=>Promise<AnyBlock|null>; create:(a:unknown)=>Promise<AnyBlock>; update:(a:unknown)=>Promise<AnyBlock> };
const ser = (b: AnyBlock) => ({ ...b, data: (() => { try { return JSON.parse(b.data); } catch { return {}; } })() });

export async function GET() {
  const blocks = await db.findMany({ orderBy: { position: "asc" } });
  return NextResponse.json(blocks.map(ser));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json()) as { type?: string; data?: Record<string,unknown>; visible?: boolean };
  const last = await db.findFirst({ orderBy: { position: "desc" } });
  const block = await db.create({ data: { type: body.type ?? "hero", position: (last?.position ?? -1) + 1, data: JSON.stringify(body.data ?? {}), visible: body.visible ?? true } });
  return NextResponse.json(ser(block), { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const items = (await req.json()) as Array<{ id: string; position: number }>;
  await Promise.all(items.map((item) => db.update({ where: { id: item.id }, data: { position: item.position } })));
  return NextResponse.json({ ok: true });
}
