import { NextResponse } from "next/server";
import { rawCloudWebhook, processPayPayload } from "@/app/api/webhooks/cloudpayments/_utils";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const parsed = await rawCloudWebhook(req);
    if (parsed.error) return parsed.error;
    const result = await processPayPayload(parsed.payload!);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cloudpayments/pay] webhook failed:", error);
    return NextResponse.json({ code: 13 }, { status: 500 });
  }
}
