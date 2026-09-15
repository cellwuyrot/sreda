import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const attachment = await prisma.mailAttachment.findUnique({ where: { id } }).catch(() => null);
  if (!attachment) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const buf = Buffer.from(attachment.contentB64, "base64");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": attachment.mime || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(attachment.name)}"`,
      "Content-Length": String(buf.length),
    },
  });
}
