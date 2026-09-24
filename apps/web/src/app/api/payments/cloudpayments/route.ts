import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  applyCloudPayment,
  createOrReuseCloudPaymentOrder,
  findCloudPaymentStatus,
  readCloudPaymentPublicConfig,
  type CloudPaymentKind,
} from "@/lib/cloudPayments";

export const dynamic = "force-dynamic";

function isKind(value: unknown): value is CloudPaymentKind {
  return value === "PREMIUM" || value === "VPN";
}

async function currentUser() {
  const session = await getServerSession(authOptions);
  return session?.user || null;
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kind = req.nextUrl.searchParams.get("kind");
  if (!isKind(kind)) return NextResponse.json({ error: "Неизвестная подписка." }, { status: 400 });

  try {
    const config = await readCloudPaymentPublicConfig(kind);
    return NextResponse.json({ kind, ...config });
  } catch (error) {
    console.error("[cloudpayments] public config failed:", error);
    return NextResponse.json({ error: "Не удалось загрузить настройки оплаты." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; kind?: unknown; invoiceId?: unknown } | null;
  const action = body?.action;
  const kind = body?.kind;

  if (!isKind(kind)) return NextResponse.json({ error: "Неизвестная подписка." }, { status: 400 });

  try {
    if (action === "create") {
      const email = typeof user.email === "string" ? user.email : "";
      if (!email) return NextResponse.json({ error: "У аккаунта не указан email." }, { status: 400 });

      const order = await createOrReuseCloudPaymentOrder({
        userId: user.id,
        email,
        kind,
      });

      return NextResponse.json({
        order,
        redirectUrl: order.paymentUrl,
      });
    }

    if (action === "status") {
      const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId.trim() : "";
      if (!invoiceId) return NextResponse.json({ error: "Не указан номер заказа." }, { status: 400 });

      const result = await findCloudPaymentStatus({
        invoiceId,
        userId: user.id,
      });

      return NextResponse.json(result);
    }

    if (action === "reconcile") {
      const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId.trim() : "";
      if (!invoiceId) return NextResponse.json({ error: "Не указан номер заказа." }, { status: 400 });

      const result = await findCloudPaymentStatus({
        invoiceId,
        userId: user.id,
      });

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Неизвестное действие." }, { status: 400 });
  } catch (error) {
    console.error("[cloudpayments] payment action failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось выполнить операцию CloudPayments." },
      { status: 500 },
    );
  }
}
