import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function guard() { const s = await getServerSession(authOptions); if (!s?.user || (s.user as any).role !== "ADMIN") return null; return s; }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  const template = await (prisma as any).mailTemplate.findUnique({ where: { key } }).catch(() => null);
  if (!template) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ template });
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const s = await guard(); if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params; const b = await req.json().catch(() => ({}));
  const template = await (prisma as any).mailTemplate.update({ where: { key }, data: { name: b.name, subject: b.subject, format: b.format, body: b.body, updatedById: (s.user as any).id || null } }).catch(() => null);
  if (!template) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ template });
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  await (prisma as any).mailTemplate.deleteMany({ where: { key } });
  return NextResponse.json({ ok: true });
}
