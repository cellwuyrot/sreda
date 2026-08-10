import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getMainCommunity } from "@/lib/mainCommunity";

// GET — return the main community info
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const main = await getMainCommunity();
    return NextResponse.json(main || { exists: false });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
