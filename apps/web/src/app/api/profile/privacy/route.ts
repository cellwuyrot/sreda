import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { privacyOnline: true, privacyFriends: true, privacyEmail: true },
  });

  return NextResponse.json(user);
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  const validOptions = ["everyone", "friends", "nobody"];

  if (body.privacyOnline !== undefined) {
    if (!validOptions.includes(body.privacyOnline)) {
      return NextResponse.json({ error: "Invalid privacy option" }, { status: 400 });
    }
    data.privacyOnline = body.privacyOnline;
  }

  if (body.privacyFriends !== undefined) {
    if (!validOptions.includes(body.privacyFriends)) {
      return NextResponse.json({ error: "Invalid privacy option" }, { status: 400 });
    }
    data.privacyFriends = body.privacyFriends;
  }

  if (typeof body.privacyEmail === "boolean") {
    data.privacyEmail = body.privacyEmail;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No data to update" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { privacyOnline: true, privacyFriends: true, privacyEmail: true },
  });

  return NextResponse.json(updated);
}
