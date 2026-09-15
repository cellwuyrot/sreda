import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeSignatureHtml } from "@/lib/mailSanitize";

async function guard() { const s = await getServerSession(authOptions); if (!s?.user || (s.user as any).role !== "ADMIN") return null; return s; }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params; const localPart = decodeURIComponent(address).split("@")[0];
  const signature = await (prisma as any).mailSignature.findUnique({ where: { localPart } }).catch(() => null);
  return NextResponse.json({ signature });
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params; const localPart = decodeURIComponent(address).split("@")[0];
  const b = await req.json().catch(() => ({}));
  const html = sanitizeSignatureHtml(String(b.html || "")); const enabled = b.enabled !== false;
  const signature = await (prisma as any).mailSignature.upsert({ where: { localPart }, update: { html, enabled }, create: { localPart, html, enabled } });
  return NextResponse.json({ signature });
}
