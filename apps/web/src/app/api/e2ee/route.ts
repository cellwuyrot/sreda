import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, e2eePublicKey: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({
    userId: user.id,
    publicKey: user.e2eePublicKey ? JSON.parse(user.e2eePublicKey) : null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { publicKey } = await req.json();
  if (!publicKey || typeof publicKey !== "object") {
    return NextResponse.json({ error: "Invalid public key" }, { status: 400 });
  }

  if (publicKey.kty !== "EC" || publicKey.crv !== "P-256") {
    return NextResponse.json({ error: "Only ECDH P-256 keys accepted" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { e2eePublicKey: JSON.stringify(publicKey) },
  });

  return NextResponse.json({ ok: true });
}
