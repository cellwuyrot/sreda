import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PROJECT_MAILBOXES, mailboxAddress } from "@/lib/projectMail";

export async function GET() {
  const s = await getServerSession(authOptions);
  if (!s?.user || (s.user as any).role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const mailboxes = PROJECT_MAILBOXES.map((m) => ({
    localPart: m.localPart,
    address: mailboxAddress(m.localPart),
    label: m.label,
    purpose: m.purpose,
  }));
  return NextResponse.json({ mailboxes });
}
