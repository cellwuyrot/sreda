import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

interface DraftBody {
  fromName?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  format?: string;
  body?: string;
  attachmentsMeta?: unknown;
  templateKey?: string;
}

async function guard() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "ADMIN" ? session : null;
}

function authorIdOf(session: NonNullable<Awaited<ReturnType<typeof guard>>>): string {
  return session.user.id || "admin";
}

function localPartOf(address: string): string {
  return decodeURIComponent(address).split("@")[0];
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const localPart = localPartOf(address);
  const authorId = authorIdOf(session);
  const draft = await prisma.mailDraft.findUnique({ where: { authorId_localPart: { authorId, localPart } } }).catch(() => null);
  return NextResponse.json({ draft });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const localPart = localPartOf(address);
  const authorId = authorIdOf(session);
  const body = await req.json().catch(() => ({} as DraftBody)) as DraftBody;
  const data = {
    fromName: body.fromName || null,
    toAddr: body.to || null,
    ccAddr: body.cc || null,
    bccAddr: body.bcc || null,
    subject: body.subject || null,
    format: body.format || "html",
    body: body.body || null,
    attachmentsMeta: body.attachmentsMeta ? JSON.stringify(body.attachmentsMeta) : null,
    templateKey: body.templateKey || null,
  };
  const draft = await prisma.mailDraft.upsert({
    where: { authorId_localPart: { authorId, localPart } },
    update: data,
    create: { authorId, localPart, ...data },
  });
  return NextResponse.json({ draft });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  await prisma.mailDraft.deleteMany({ where: { authorId: authorIdOf(session), localPart: localPartOf(address) } });
  return NextResponse.json({ ok: true });
}
