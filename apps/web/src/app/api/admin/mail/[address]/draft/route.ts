import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { findMailbox } from "@/lib/projectMail";

/** PROJECT-MAIL: \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u043a\u043e\u043c\u043f\u043e\u0437\u0435\u0440\u0430 (\u043e\u0434\u0438\u043d \u043d\u0430 \u0430\u0432\u0442\u043e\u0440\u0430+\u044f\u0449\u0438\u043a). */
async function guard() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  const draft = await prisma.mailDraft.findUnique({ where: { authorId_localPart: { authorId: session.user.id, localPart: def.localPart } } }).catch(() => null);
  return NextResponse.json({ draft: draft || null });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const data = {
    fromName: typeof b.fromName === "string" ? b.fromName : null,
    toAddr: typeof b.toAddr === "string" ? b.toAddr : null,
    ccAddr: typeof b.ccAddr === "string" ? b.ccAddr : null,
    bccAddr: typeof b.bccAddr === "string" ? b.bccAddr : null,
    subject: typeof b.subject === "string" ? b.subject.slice(0, 500) : null,
    format: b.format === "markdown" ? "markdown" : "html",
    body: typeof b.body === "string" ? b.body : null,
    templateKey: typeof b.templateKey === "string" ? b.templateKey : null,
  };
  const draft = await prisma.mailDraft.upsert({
    where: { authorId_localPart: { authorId: session.user.id, localPart: def.localPart } },
    update: data,
    create: { authorId: session.user.id, localPart: def.localPart, ...data },
  });
  return NextResponse.json({ ok: true, draft });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  await prisma.mailDraft.deleteMany({ where: { authorId: session.user.id, localPart: def.localPart } });
  return NextResponse.json({ ok: true });
}
