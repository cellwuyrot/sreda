"use client";

/* GROUP-SKIN: применяет оформление выбранного сообщества и рисует частицы.

   Компонент без разметки: вся работа идёт через CSS-переменные на <html>, поэтому
   его можно повесить в любое место страницы и не думать о вёрстке.

   При смене сообщества и при размонтировании оформление обязательно снимается:
   иначе фон одной группы остался бы висеть в личных сообщениях и в других
   сообществах — самый заметный вид ошибки в таких слоях. */

import { useEffect, useMemo } from "react";
import { applyGroupTheme, clearGroupTheme, parseGroupTheme } from "@/lib/groupTheme";
import ParticleField from "./ParticleField";

interface Props {
	/** Сырое значение `Group.theme`. null — вне сообщества или оформление не задано. */
	theme: string | null | undefined;
	/** Выключает слой целиком (например, в личных сообщениях). */
	disabled?: boolean;
}

export default function GroupThemeLayer({ theme, disabled = false }: Props) {
	const parsed = useMemo(() => parseGroupTheme(theme ?? null), [theme]);
	const active = !disabled && parsed.enabled;

	useEffect(() => {
		if (!active) {
			clearGroupTheme();
			return;
		}
		applyGroupTheme(parsed);
		return () => clearGroupTheme();
	}, [active, parsed]);

	if (!active || parsed.particles.kind === "none") return null;
	return <ParticleField particles={parsed.particles} />;
}
