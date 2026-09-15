import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";

/** PROJECT-MAIL: \u0447\u0442\u0435\u043d\u0438\u0435 / \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 / \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0448\u0430\u0431\u043b\u043e\u043d\u0430. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  const tpl = await prisma.mailTemplate.findUnique({ where: { key } });
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template: tpl });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const tpl = await prisma.mailTemplate.update({
    where: { key },
    data: {
      ...(typeof b.name === "string" ? { name: b.name } : {}),
      ...(typeof b.subject === "string" ? { subject: b.subject } : {}),
      ...(b.format ? { format: b.format === "markdown" ? "markdown" : "html" } : {}),
      ...(typeof b.body === "string" ? { body: b.body } : {}),
      updatedById: session.user.id,
    },
  }).catch(() => null);
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, template: tpl });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { key } = await ctx.params;
  await prisma.mailTemplate.delete({ where: { key } }).catch(() => null);
  await logAction({ userId: session.user.id, username: session.user.username || session.user.name || "admin", action: "delete", target: "MailTemplate", targetId: key, details: `\u0428\u0430\u0431\u043b\u043e\u043d ${key} \u0443\u0434\u0430\u043b\u0451\u043d` });
  return NextResponse.json({ ok: true });
}
