import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { configureCloudPaymentNotifications, type CloudPaymentKind } from "@/lib/cloudPayments";

export const dynamic = "force-dynamic";

function isKind(value: unknown): value is CloudPaymentKind {
  return value === "PREMIUM" || value === "VPN";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
  if (!isKind(body?.kind)) {
    return NextResponse.json({ error: "Неизвестная подписка." }, { status: 400 });
  }

  try {
    const configured = await configureCloudPaymentNotifications(
      body.kind,
      process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL || new URL(req.url).origin,
    );
    return NextResponse.json({
      success: true,
      updated: configured.updated,
      checkUrl: `${(process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/+$/, "")}/api/webhooks/cloudpayments/check`,
      payUrl: `${(process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/+$/, "")}/api/webhooks/cloudpayments/pay`,
      failUrl: `${(process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/+$/, "")}/api/webhooks/cloudpayments/fail`,
      recurrentUrl: `${(process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/+$/, "")}/api/webhooks/cloudpayments/recurrent`,
      checkNeedsManualSetup: true,
    });
  } catch (error) {
    console.error("[cloudpayments/admin] configure notifications failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось настроить уведомления CloudPayments." },
      { status: 500 },
    );
  }
}
