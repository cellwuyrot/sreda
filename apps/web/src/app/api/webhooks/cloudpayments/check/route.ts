import { NextResponse } from "next/server";
import { rawCloudWebhook } from "@/app/api/webhooks/cloudpayments/_utils";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const parsed = await rawCloudWebhook(req);
    if (parsed.error) return parsed.error;
    const payload = parsed.payload!;
    const order = parsed.order!;

    const invoiceId = typeof payload.InvoiceId === "string" ? payload.InvoiceId : "";
    const accountId = typeof payload.AccountId === "string" ? payload.AccountId : "";
    const amount = typeof payload.Amount === "number" ? payload.Amount : Number(payload.Amount);
    const currency = typeof payload.Currency === "string" ? payload.Currency : "";

    if (invoiceId !== order.invoiceId) return NextResponse.json({ code: 10 });
    if (accountId !== order.userId) return NextResponse.json({ code: 11 });
    if (!Number.isFinite(amount) || Math.abs(amount - order.amount) > 0.01) return NextResponse.json({ code: 12 });
    if (currency.toUpperCase() !== order.currency.toUpperCase()) return NextResponse.json({ code: 12 });

    return NextResponse.json({ code: 0 });
  } catch (error) {
    console.error("[cloudpayments/check] webhook failed:", error);
    return NextResponse.json({ code: 13 }, { status: 500 });
  }
}
