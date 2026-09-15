import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function guard() { const s = await getServerSession(authOptions); if (!s?.user || (s.user as any).role !== "ADMIN") return null; return s; }

export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const templates = await (prisma as any).mailTemplate.findMany({ orderBy: { name: "asc" } }).catch(() => []);
  return NextResponse.json({ templates });
}
export async function POST(req: NextRequest) {
  const s = await guard(); if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const key = (String(b.key || "").trim() || String(b.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).slice(0, 40);
  if (!key || !b.name) return NextResponse.json({ error: "Нужны название и ключ шаблона" }, { status: 400 });
  const data = { name: String(b.name), subject: String(b.subject || ""), format: b.format === "markdown" ? "markdown" : "html", body: String(b.body || ""), updatedById: (s.user as any).id || null };
  const template = await (prisma as any).mailTemplate.upsert({ where: { key }, update: data, create: { key, ...data } });
  return NextResponse.json({ template });
}
