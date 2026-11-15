import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
/** Legacy global provider mutation is disabled. Each user chooses locally. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ error: "Тип соединения выбирается пользователем", code: "PROVIDER_SELECTION_RETIRED" }, { status: 410 });
}
