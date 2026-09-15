import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function guard() { const s = await getServerSession(authOptions); if (!s?.user || (s.user as any).role !== "ADMIN") return null; return s; }

export async function GET(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const s = await guard(); if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params; const localPart = decodeURIComponent(address).split("@")[0];
  const authorId = (s.user as any).id || "admin";
  const draft = await (prisma as any).mailDraft.findUnique({ where: { authorId_localPart: { authorId, localPart } } }).catch(() => null);
  return NextResponse.json({ draft });
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const s = await guard(); if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params; const localPart = decodeURIComponent(address).split("@")[0];
  const authorId = (s.user as any).id || "admin"; const b = await req.json().catch(() => ({}));
  const data = { fromName: b.fromName || null, toAddr: b.to || null, ccAddr: b.cc || null, bccAddr: b.bcc || null, subject: b.subject || null, format: b.format || "html", body: b.body || null, attachmentsMeta: b.attachmentsMeta ? JSON.stringify(b.attachmentsMeta) : null, templateKey: b.templateKey || null };
  const draft = await (prisma as any).mailDraft.upsert({ where: { authorId_localPart: { authorId, localPart } }, update: data, create: { authorId, localPart, ...data } });
  return NextResponse.json({ draft });
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const s = await guard(); if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params; const localPart = decodeURIComponent(address).split("@")[0];
  const authorId = (s.user as any).id || "admin";
  await (prisma as any).mailDraft.deleteMany({ where: { authorId, localPart } });
  return NextResponse.json({ ok: true });
}
