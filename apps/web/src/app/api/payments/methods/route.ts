import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readPublicPaymentMethods } from "@/lib/paymentSettings";

/**
 * PREMIUM-PAY: включённые администратором способы оплаты Premium (без секретов).
 * Доступно любому авторизованному пользователю — чтобы показать в настройках
 * профиля, как оформить подписку (СБП / эквайринг).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const methods = await readPublicPaymentMethods();
  return NextResponse.json(methods);
}
