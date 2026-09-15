import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { findMailbox } from "@/lib/projectMail";
import { sanitizeSignatureHtml } from "@/lib/mailSanitize";
import { logAction } from "@/lib/audit";

/** PROJECT-MAIL: \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u044f\u0449\u0438\u043a\u0430 (HTML). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  const sig = await prisma.mailSignature.findUnique({ where: { localPart: def.localPart } }).catch(() => null);
  return NextResponse.json({ html: sig?.html || "", enabled: sig?.enabled ?? true });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const html = sanitizeSignatureHtml(typeof b.html === "string" ? b.html : "");
  const enabled = b.enabled !== false;
  const sig = await prisma.mailSignature.upsert({
    where: { localPart: def.localPart },
    update: { html, enabled },
    create: { localPart: def.localPart, html, enabled },
  });
  await logAction({ userId: session.user.id, username: session.user.username || session.user.name || "admin", action: "update", target: "MailSignature", targetId: def.localPart, details: `\u041f\u043e\u0434\u043f\u0438\u0441\u044c \u044f\u0449\u0438\u043a\u0430 ${def.localPart} \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430` });
  return NextResponse.json({ ok: true, html: sig.html, enabled: sig.enabled });
}
