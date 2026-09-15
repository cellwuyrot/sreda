import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";

/** PROJECT-MAIL: \u0448\u0430\u0431\u043b\u043e\u043d\u044b \u043f\u0438\u0441\u0435\u043c \u2014 \u0441\u043f\u0438\u0441\u043e\u043a \u0438 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u0435. */
function slugify(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `tpl-${Date.now()}`;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const templates = await prisma.mailTemplate.findMany({ orderBy: { updatedAt: "desc" } }).catch(() => []);
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435" }, { status: 400 });
  const key = typeof b.key === "string" && b.key ? slugify(b.key) : slugify(name);
  const tpl = await prisma.mailTemplate.upsert({
    where: { key },
    update: { name, subject: b.subject || "", format: b.format === "markdown" ? "markdown" : "html", body: b.body || "", updatedById: session.user.id },
    create: { key, name, subject: b.subject || "", format: b.format === "markdown" ? "markdown" : "html", body: b.body || "", updatedById: session.user.id },
  });
  await logAction({ userId: session.user.id, username: session.user.username || session.user.name || "admin", action: "create", target: "MailTemplate", targetId: key, details: `\u0428\u0430\u0431\u043b\u043e\u043d \u043f\u0438\u0441\u044c\u043c\u0430 ${name}` });
  return NextResponse.json({ ok: true, template: tpl });
}
