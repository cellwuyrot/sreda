import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions);
  if (!s?.user || (s.user as any).role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const a = await (prisma as any).mailAttachment.findUnique({ where: { id } }).catch(() => null);
  if (!a) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const buf = Buffer.from(a.contentB64, "base64");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(buf, { status: 200, headers: { "Content-Type": a.mime || "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(a.name)}"`, "Content-Length": String(buf.length) } });
}
