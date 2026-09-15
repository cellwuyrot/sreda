import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/** PROJECT-MAIL: \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u0435 / \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440 \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u044f. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const att = await prisma.mailAttachment.findUnique({ where: { id } }).catch(() => null);
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = Buffer.from(att.contentB64, "base64");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const dispositionName = encodeURIComponent(att.name);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": att.mime || "application/octet-stream",
      "Content-Length": String(buf.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${dispositionName}`,
    },
  });
}
