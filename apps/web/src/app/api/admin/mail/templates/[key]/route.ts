import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

interface TemplateUpdateBody { name?: string; subject?: string; format?: string; body?: string; }

async function guard() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "ADMIN" ? session : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  const template = await prisma.mailTemplate.findUnique({ where: { key } }).catch(() => null);
  if (!template) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  const body = await req.json().catch(() => ({} as TemplateUpdateBody)) as TemplateUpdateBody;
  const template = await prisma.mailTemplate.update({
    where: { key },
    data: {
      name: String(body.name || ""),
      subject: String(body.subject || ""),
      format: body.format === "markdown" ? "markdown" : "html",
      body: String(body.body || ""),
      updatedById: session.user.id || null,
    },
  }).catch(() => null);
  if (!template) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ template });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  await prisma.mailTemplate.deleteMany({ where: { key } });
  return NextResponse.json({ ok: true });
}
