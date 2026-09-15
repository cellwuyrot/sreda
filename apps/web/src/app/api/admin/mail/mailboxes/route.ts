import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PROJECT_MAILBOXES, mailboxAddress } from "@/lib/projectMail";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const mailboxes = PROJECT_MAILBOXES.map((mailbox) => ({
    localPart: mailbox.localPart,
    address: mailboxAddress(mailbox.localPart),
    label: mailbox.label,
    purpose: mailbox.purpose,
  }));
  return NextResponse.json({ mailboxes });
}
