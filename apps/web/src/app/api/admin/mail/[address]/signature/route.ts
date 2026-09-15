import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeSignatureHtml } from "@/lib/mailSanitize";

async function guard() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "ADMIN" ? session : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const localPart = decodeURIComponent(address).split("@")[0];
  const signature = await prisma.mailSignature.findUnique({ where: { localPart } }).catch(() => null);
  return NextResponse.json({ signature });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const localPart = decodeURIComponent(address).split("@")[0];
  const body = await req.json().catch(() => ({} as { html?: string; enabled?: boolean })) as { html?: string; enabled?: boolean };
  const html = sanitizeSignatureHtml(String(body.html || ""));
  const enabled = body.enabled !== false;
  const signature = await prisma.mailSignature.upsert({
    where: { localPart },
    update: { html, enabled },
    create: { localPart, html, enabled },
  });
  return NextResponse.json({ signature });
}
