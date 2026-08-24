"use client";

/* GROUP-SKIN: слой частиц поверх интерфейса сообщества.

   Один canvas на всё окно, без DOM-узлов на каждую частицу: сотня анимированных
   div в чате на тысячи сообщений заметно просаживают прокрутку.

   Слой не перехватывает мышь (pointer-events: none) — иначе красивый снег сделал бы
   переписку некликабельной. Курсор для режима interactive берётся с window.

   Анимация останавливается, когда вкладка скрыта и когда система просит
   prefers-reduced-motion: фоновые частицы не стоят разряда батареи. */

import { useEffect, useRef } from "react";
import type { GroupParticles, ParticleKind } from "@/lib/groupTheme";

interface Props {
	particles: GroupParticles;
	/** Затемнённый превью-режим в редакторе: встраивается в карточку, а не в окно. */
	inline?: boolean;
	className?: string;
}

interface Dot {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	a: number;
	/** Фаза для мерцания и колебаний. */
	p: number;
	/** Угол поворота для лепестков и конфетти. */
	rot: number;
	vr: number;
	glyph: string;
}

/* Предел частиц при density = 100. Подобран по весу отрисовки: каплю дождя рисовать
   дешевле, чем символ кода с текстовой метрикой. */
const MAX_COUNT: Record<ParticleKind, number> = {
	none: 0,
	snow: 220,
	stars: 260,
	embers: 160,
	bubbles: 140,
	fireflies: 90,
	rain: 300,
	petals: 120,
	matrix: 90,
	confetti: 160,
};

const MATRIX_GLYPHS = "01アカサタナハマヤラワ<>[]{}/*+-=";

function rand(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

function spawn(kind: ParticleKind, w: number, h: number, size: number, fresh: boolean): Dot {
	const base: Dot = {
		x: rand(0, w),
		y: fresh ? rand(-h * 0.2, h) : rand(0, h),
		vx: 0,
		vy: 0,
		r: size,
		a: 1,
		p: rand(0, Math.PI * 2),
		rot: rand(0, Math.PI * 2),
		vr: rand(-0.02, 0.02),
		glyph: "",
	};
	switch (kind) {
		case "snow":
			return { ...base, vx: rand(-0.2, 0.2), vy: rand(0.15, 0.5), r: rand(size * 0.4, size) };
		case "stars":
			return { ...base, vx: 0, vy: 0, r: rand(size * 0.3, size * 0.9), a: rand(0.2, 1) };
		case "embers":
			return { ...base, y: rand(h * 0.5, h + 40), vx: rand(-0.15, 0.15), vy: rand(-0.7, -0.25), r: rand(size * 0.3, size * 0.8) };
		case "bubbles":
			return { ...base, y: rand(h * 0.4, h + 40), vx: rand(-0.1, 0.1), vy: rand(-0.5, -0.15), r: rand(size * 0.5, size * 1.4) };
		case "fireflies":
			return { ...base, vx: rand(-0.25, 0.25), vy: rand(-0.25, 0.25), r: rand(size * 0.5, size), a: rand(0.3, 1) };
		case "rain":
			return { ...base, vx: rand(-0.6, -0.2), vy: rand(3, 6), r: rand(size * 0.4, size * 0.8) };
		case "petals":
			return { ...base, vx: rand(-0.4, 0.4), vy: rand(0.3, 0.8), r: rand(size * 0.6, size * 1.2), vr: rand(-0.04, 0.04) };
		case "matrix":
			return {
				...base,
				vy: rand(1, 2.6),
				r: Math.max(8, size),
				glyph: MATRIX_GLYPHS[Math.floor(Math.random() * MATRIX_GLYPHS.length)],
			};
		case "confetti":
			return { ...base, vx: rand(-0.5, 0.5), vy: rand(0.6, 1.6), r: rand(size * 0.6, size * 1.3), vr: rand(-0.08, 0.08) };
		default:
			return base;
	}
}

export default function ParticleField({ particles, inline = false, className = "" }: Props) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const pointer = useRef<{ x: number; y: number; on: boolean }>({ x: 0, y: 0, on: false });

	const { kind, density, speed, size, color, opacity, interactive } = particles;

	useEffect(() => {
		if (kind === "none") return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		let dots: Dot[] = [];
		let w = 0;
		let h = 0;
		let frame = 0;
		let stopped = false;

		const resize = () => {
			const rect = canvas.getBoundingClientRect();
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			w = Math.max(1, Math.round(rect.width));
			h = Math.max(1, Math.round(rect.height));
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			/* Количество считаем от площади: один и тот же пресет не должен выглядеть
			   пустым на 4K и забитым на небольшом окне. */
			const areaFactor = Math.min(1.6, Math.max(0.25, (w * h) / (1440 * 900)));
			const count = Math.round((MAX_COUNT[kind] * density) / 100 * areaFactor * (inline ? 0.35 : 1));
			dots = Array.from({ length: Math.max(0, count) }, () => spawn(kind, w, h, size, false));
		};

		resize();
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
		ro?.observe(canvas);
		window.addEventListener("resize", resize);

		const onMove = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, on: true };
		};
		if (interactive) window.addEventListener("mousemove", onMove, { passive: true });

		const k = speed / 100;
		const alpha = opacity / 100;

		const step = () => {
			if (stopped) return;
			ctx.clearRect(0, 0, w, h);
			ctx.globalAlpha = alpha;
			ctx.fillStyle = color;
			ctx.strokeStyle = color;
			if (kind === "matrix") ctx.font = `${Math.max(8, size)}px ui-monospace, monospace`;

			const ptr = pointer.current;

			for (let i = 0; i < dots.length; i += 1) {
				const d = dots[i];
				d.p += 0.02 * k;

				if (kind === "stars") {
					/* Звёзды не летят, а дышат прозрачностью. */
					d.a = 0.35 + 0.65 * Math.abs(Math.sin(d.p));
				} else {
					d.x += d.vx * k + (kind === "snow" || kind === "petals" ? Math.sin(d.p) * 0.35 * k : 0);
					d.y += d.vy * k;
					d.rot += d.vr * k;
				}

				if (kind === "fireflies") {
					d.a = 0.25 + 0.75 * Math.abs(Math.sin(d.p * 1.7));
					if (d.x < 0 || d.x > w) d.vx *= -1;
					if (d.y < 0 || d.y > h) d.vy *= -1;
				}

				/* Курсор отталкивает частицы в небольшом радиусе. */
				if (interactive && ptr.on) {
					const dx = d.x - ptr.x;
					const dy = d.y - ptr.y;
					const dist2 = dx * dx + dy * dy;
					if (dist2 < 14_400 && dist2 > 0.01) {
						const push = (14_400 - dist2) / 14_400;
						const dist = Math.sqrt(dist2);
						d.x += (dx / dist) * push * 2.2;
						d.y += (dy / dist) * push * 2.2;
					}
				}

				/* Вышедшие за край рождаются заново — поток выглядит бесконечным. */
				const up = kind === "embers" || kind === "bubbles";
				if (d.y > h + 24 || (up && d.y < -24) || d.x < -40 || d.x > w + 40) {
					dots[i] = spawn(kind, w, h, size, false);
					const n = dots[i];
					n.y = up ? h + rand(0, 40) : -rand(0, 40);
					continue;
				}

				ctx.globalAlpha = alpha * d.a;

				if (kind === "rain") {
					ctx.lineWidth = Math.max(1, d.r * 0.5);
					ctx.beginPath();
					ctx.moveTo(d.x, d.y);
					ctx.lineTo(d.x - d.vx * 3, d.y - d.r * 4);
					ctx.stroke();
				} else if (kind === "matrix") {
					ctx.fillText(d.glyph, d.x, d.y);
				} else if (kind === "confetti") {
					ctx.save();
					ctx.translate(d.x, d.y);
					ctx.rotate(d.rot);
					ctx.fillRect(-d.r, -d.r * 0.4, d.r * 2, d.r * 0.8);
					ctx.restore();
				} else if (kind === "petals") {
					ctx.save();
					ctx.translate(d.x, d.y);
					ctx.rotate(d.rot);
					ctx.beginPath();
					ctx.ellipse(0, 0, d.r, d.r * 0.55, 0, 0, Math.PI * 2);
					ctx.fill();
					ctx.restore();
				} else if (kind === "bubbles") {
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
					ctx.stroke();
				} else {
					ctx.beginPath();
					ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
					ctx.fill();
				}
			}

			ctx.globalAlpha = 1;
			if (!reduce) frame = window.requestAnimationFrame(step);
		};

		step();

		/* Скрытая вкладка не должна крутить анимацию. */
		const onVisibility = () => {
			if (document.hidden) {
				window.cancelAnimationFrame(frame);
			} else if (!reduce) {
				window.cancelAnimationFrame(frame);
				frame = window.requestAnimationFrame(step);
			}
		};
		document.addEventListener("visibilitychange", onVisibility);

		return () => {
			stopped = true;
			window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", resize);
			window.removeEventListener("mousemove", onMove);
			document.removeEventListener("visibilitychange", onVisibility);
			ro?.disconnect();
		};
	}, [kind, density, speed, size, color, opacity, interactive, inline]);

	if (kind === "none") return null;

	return (
		<canvas
			ref={canvasRef}
			aria-hidden
			className={`${inline ? "absolute inset-0 h-full w-full" : "fixed inset-0 z-[35]"} pointer-events-none ${className}`}
		/>
	);
}
