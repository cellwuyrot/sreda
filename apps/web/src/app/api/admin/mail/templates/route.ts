import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

interface TemplateBody { key?: string; name?: string; subject?: string; format?: string; body?: string; }

async function guard() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "ADMIN" ? session : null;
}

export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const templates = await prisma.mailTemplate.findMany({ orderBy: { name: "asc" } }).catch(() => []);
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const session = await guard();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({} as TemplateBody)) as TemplateBody;
  const key = (String(body.key || "").trim() || String(body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).slice(0, 40);
  if (!key || !body.name) return NextResponse.json({ error: "Нужны название и ключ шаблона" }, { status: 400 });
  const data = {
    name: String(body.name),
    subject: String(body.subject || ""),
    format: body.format === "markdown" ? "markdown" : "html",
    body: String(body.body || ""),
    updatedById: session.user.id || null,
  };
  const template = await prisma.mailTemplate.upsert({ where: { key }, update: data, create: { key, ...data } });
  return NextResponse.json({ template });
}
