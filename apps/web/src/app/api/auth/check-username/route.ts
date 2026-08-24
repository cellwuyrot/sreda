/* REG-VALIDATE: проверка занятости логина и почты до отправки кода.

   Без этого человек узнавал о занятом логине только после письма с кодом —
   лишнее письмо и потерянный шаг регистрации.

   Ответ нарочно бедный (только `available`) и с жёстким ограничением частоты:
   такой маршрут — готовый способ перебрать базу пользователей, если оставить его
   открытым. По почте ответ тоже только да/нет, без имён и идентификаторов. */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { checkUsername, checkEmail } from "@/lib/registerValidation";

export async function GET(req: NextRequest) {
	const limited = rateLimit(req, "auth-check-username", { limit: 90, windowMs: 60 * 60 * 1000 });
	if (limited) return limited;

	const url = new URL(req.url);
	const username = (url.searchParams.get("username") || "").trim();
	const email = (url.searchParams.get("email") || "").trim().toLowerCase();

	if (username) {
		/* Невалидные логины в базу не ходят вовсе. */
		if (!checkUsername(username).valid) {
			return NextResponse.json({ available: false, reason: "invalid" });
		}
		const existing = await prisma.user.findFirst({
			where: { username: { equals: username, mode: "insensitive" } },
			select: { id: true },
		});
		return NextResponse.json({ available: !existing });
	}

	if (email) {
		if (!checkEmail(email).valid) {
			return NextResponse.json({ available: false, reason: "invalid" });
		}
		const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
		return NextResponse.json({ available: !existing });
	}

	return NextResponse.json({ error: "Нужен параметр username или email" }, { status: 400 });
}
