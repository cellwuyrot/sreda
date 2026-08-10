"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring } from "framer-motion";
import { timezoneForCity } from "@/lib/cityTimezones";
import { useTheme } from "@/components/Providers";

/* ───────────────────────────────────────────────────────────
 *  ConnectWelcome — мифическая Земля под энергощитом в космосе
 *
 *  • Адаптивный line-art фон (SpaceScene), меняющийся под тему
 *    и уникальный при каждой загрузке (seed от текущего времени):
 *      – город-скайлайн тонкими линиями по низу экрана + лучи-сигналы
 *        к планете (метафора «Соединяй людей — рождай проекты»);
 *      – созвездия-связи (звёзды, соединённые тонкими линиями);
 *      – тёмная тема: открытый космос (звёздное поле, неон);
 *      – светлая тема: вид с орбиты/рассвет (небо голубой→бирюза,
 *        line-art облака, атмосферная дымка у горизонта).
 *  • Центр: вращающаяся «мифическая» планета — главный элемент.
 *  • Часы города пользователя — только если город указан в профиле.
 *  • Девиз + сменяющиеся цитаты. Минимум текста, максимум визуала.
 *
 *  Вся графика — только штрихи (без заливок объектов); гамма проекта
 *  (cyan #22d3ee / teal #5eead4 / violet #a78bfa) через CSS-переменные
 *  --cn-accent / --cn-orbit с фолбэками. Тема берётся из useTheme().
 * ─────────────────────────────────────────────────────────── */

interface ConnectWelcomeProps {
  onCreate: () => void;
  onJoin: () => void;
}

const MOTTO = "CONNECT — всё в одном пространстве.";
const QUOTES = [
  "Задачи, которые легко отследить.",
  "Знания, что не теряются со временем.",
  "Большое начинается с одного сообщения.",
  "Соединяй людей — рождай проекты.",
  "Здесь идеи находят свою орбиту.",
];

/* ════════════ Утилиты ════════════ */

/** Детерминированный ГПСЧ (mulberry32) — один seed на загрузку. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Значение CSS-переменной с фолбэком (гамма проекта). */
function cssVar(el: Element, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/* ════════════ Адаптивный line-art фон ════════════ */
function SpaceScene({
  px,
  py,
  theme,
}: {
  px: { get: () => number };
  py: { get: () => number };
  theme: "dark" | "light";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Seed от текущего времени → уникальная сцена при каждой загрузке.
  const seedRef = useRef<number>(((Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cv = canvas;
    const c2d = ctx;
    const isDark = theme !== "light";

    let raf = 0,
      W = 0,
      H = 0,
      t = 0;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    // Гамма проекта из CSS-переменных (с фолбэками).
    const root = document.documentElement;
    const ACCENT = cssVar(root, "--cn-accent", "#22d3ee");
    const ORBIT = cssVar(root, "--cn-orbit", "#a78bfa");
    const TEAL = "#5eead4";
    const CITY_DARK_ON_LIGHT = "#12303a"; // тёмные линии города на светлом небе
    const cityColor = isDark ? ACCENT : CITY_DARK_ON_LIGHT;

    // Детерминированная генерация (один seed на загрузку).
    const rng = mulberry32(seedRef.current);
    const rand = (a: number, b: number) => a + rng() * (b - a);

    type Star = { x: number; y: number; z: number; pz: number; tw: number; hue: number };
    type Comet = { x: number; y: number; vx: number; vy: number; life: number; max: number };
    type Building = {
      xf: number; // левый край, доля ширины
      wf: number; // ширина, доля ширины
      hf: number; // высота, доля макс. высоты скайлайна
      antenna: number; // высота антенны в px (0 — нет)
      floors: number; // тонкие горизонтальные линии-этажи
      signal: boolean; // испускает ли луч-сигнал к планете
      phase: number; // фаза мигания/пульса
    };
    type CPoint = { xf: number; yf: number; tw: number };
    type Cloud = { xf: number; yf: number; scale: number; speed: number; phase: number };

    let stars: Star[] = [];
    let comets: Comet[] = [];
    let buildings: Building[] = [];
    let constellations: CPoint[][] = [];
    let clouds: Cloud[] = [];

    /* — генерация (порядок фиксирован, чтобы сцена не зависела от темы) — */
    function generate() {
      // Звёздное поле (рисуется в тёмной теме).
      stars = Array.from({ length: 300 }, () => {
        const z = rand(0.05, 1);
        return { x: rand(-1, 1), y: rand(-1, 1), z, pz: z, tw: rand(0, Math.PI * 2), hue: rand(180, 280) };
      });

      // Созвездия-связи.
      const cCount = Math.round(rand(3, 6));
      constellations = Array.from({ length: cCount }, () => {
        const cx = rand(0.08, 0.92);
        const cy = rand(0.06, 0.5);
        const n = Math.round(rand(3, 6));
        const rad = rand(0.05, 0.12);
        return Array.from({ length: n }, () => ({
          xf: Math.min(0.98, Math.max(0.02, cx + rand(-rad, rad))),
          yf: Math.min(0.6, Math.max(0.03, cy + rand(-rad, rad))),
          tw: rand(0, Math.PI * 2),
        }));
      });

      // Город-скайлайн: заполняем ширину зданиями разной высоты/ширины.
      buildings = [];
      let x = 0;
      while (x < 1) {
        const wf = rand(0.02, 0.065);
        const hf = rand(0.16, 1);
        buildings.push({
          xf: x,
          wf,
          hf,
          antenna: hf > 0.62 && rng() < 0.55 ? rand(10, 32) : 0,
          floors: Math.round(rand(2, 6)),
          signal: false,
          phase: rand(0, Math.PI * 2),
        });
        x += wf + rand(0.004, 0.02);
      }
      // Несколько высоких зданий испускают лучи-сигналы к планете.
      const tall = buildings
        .map((b, i) => ({ i, hf: b.hf }))
        .sort((a, b) => b.hf - a.hf)
        .slice(0, Math.max(2, Math.round(buildings.length * 0.16)));
      for (const { i } of tall) buildings[i].signal = true;

      // Line-art облака (рисуются в светлой теме).
      const clCount = Math.round(rand(3, 5));
      clouds = Array.from({ length: clCount }, () => ({
        xf: rand(0, 1),
        yf: rand(0.12, 0.42),
        scale: rand(0.7, 1.5),
        speed: rand(0.0015, 0.005) * (rng() < 0.5 ? -1 : 1),
        phase: rand(0, Math.PI * 2),
      }));
    }

    function resize() {
      const parent = cv.parentElement;
      if (!parent) return;
      W = parent.clientWidth;
      H = parent.clientHeight;
      cv.width = W * DPR;
      cv.height = H * DPR;
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      c2d.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    /* — тёмная тема: звёздное поле с перспективой и трейлами — */
    function drawStars(ox: number, oy: number) {
      const CX = W / 2,
        CY = H / 2;
      const focal = Math.min(W, H) * 0.9;
      for (const s of stars) {
        s.pz = s.z;
        s.z -= 0.0015;
        if (s.z <= 0.04) {
          s.z = 1;
          s.pz = 1;
          s.x = rand(-1, 1);
          s.y = rand(-1, 1);
        }
        const sx = CX + (s.x / s.z) * focal * 0.5 + ox * (1 - s.z);
        const sy = CY + (s.y / s.z) * focal * 0.5 + oy * (1 - s.z);
        if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;
        const r = Math.max(0.3, (1 - s.z) * 2.2);
        const tw = 0.55 + 0.45 * Math.sin(t * 2 + s.tw);
        c2d.beginPath();
        c2d.fillStyle = `hsla(${s.hue}, 90%, 80%, ${(0.22 + (1 - s.z) * 0.7) * tw})`;
        c2d.arc(sx, sy, r, 0, Math.PI * 2);
        c2d.fill();
        if (s.z < 0.3) {
          const psx = CX + (s.x / s.pz) * focal * 0.5 + ox * (1 - s.pz);
          const psy = CY + (s.y / s.pz) * focal * 0.5 + oy * (1 - s.pz);
          c2d.strokeStyle = `hsla(${s.hue}, 90%, 85%, ${(1 - s.z) * 0.45})`;
          c2d.lineWidth = r * 0.8;
          c2d.beginPath();
          c2d.moveTo(psx, psy);
          c2d.lineTo(sx, sy);
          c2d.stroke();
        }
      }
    }

    function drawComets() {
      if (Math.random() < 0.006 && comets.length < 3) {
        const fromLeft = Math.random() < 0.5;
        comets.push({
          x: fromLeft ? -40 : W + 40,
          y: rand(0, H * 0.45),
          vx: (fromLeft ? 1 : -1) * rand(3.5, 6),
          vy: rand(1.2, 2.4),
          life: 0,
          max: rand(70, 120),
        });
      }
      comets = comets.filter((c) => c.life < c.max);
      for (const c of comets) {
        c.life++;
        c.x += c.vx;
        c.y += c.vy;
        const a = 1 - c.life / c.max;
        const tx = c.x - c.vx * 6,
          ty = c.y - c.vy * 6;
        const grad = c2d.createLinearGradient(tx, ty, c.x, c.y);
        grad.addColorStop(0, "rgba(125,211,252,0)");
        grad.addColorStop(1, `rgba(186,230,253,${a})`);
        c2d.strokeStyle = grad;
        c2d.lineWidth = 2;
        c2d.lineCap = "round";
        c2d.beginPath();
        c2d.moveTo(tx, ty);
        c2d.lineTo(c.x, c.y);
        c2d.stroke();
        c2d.beginPath();
        c2d.fillStyle = `rgba(224,242,254,${a})`;
        c2d.arc(c.x, c.y, 2, 0, Math.PI * 2);
        c2d.fill();
      }
    }

    /* — светлая тема: line-art облака (только штрихи) — */
    function drawClouds(ox: number) {
      c2d.save();
      c2d.strokeStyle = "#7aa7bd";
      c2d.lineCap = "round";
      c2d.lineJoin = "round";
      for (const cl of clouds) {
        const span = W + 260;
        const drift = t * cl.speed * W * 60;
        const cx = ((((cl.xf * W + drift) % span) + span) % span) - 130 + ox * 0.3;
        const cy = cl.yf * H;
        const s = cl.scale;
        const bob = Math.sin(t * 0.4 + cl.phase) * 3;
        c2d.globalAlpha = 0.5;
        c2d.lineWidth = 1.1;
        // нижняя линия основания
        c2d.beginPath();
        c2d.moveTo(cx - 46 * s, cy + bob);
        c2d.lineTo(cx + 52 * s, cy + bob);
        c2d.stroke();
        // купола облака (дуги-штрихи)
        c2d.beginPath();
        c2d.moveTo(cx - 46 * s, cy + bob);
        c2d.bezierCurveTo(cx - 52 * s, cy - 16 * s + bob, cx - 22 * s, cy - 24 * s + bob, cx - 12 * s, cy - 14 * s + bob);
        c2d.bezierCurveTo(cx - 4 * s, cy - 30 * s + bob, cx + 22 * s, cy - 30 * s + bob, cx + 22 * s, cy - 12 * s + bob);
        c2d.bezierCurveTo(cx + 40 * s, cy - 22 * s + bob, cx + 58 * s, cy - 8 * s + bob, cx + 52 * s, cy + bob);
        c2d.stroke();
      }
      c2d.restore();
    }

    /* — светлая тема: атмосферная дымка у горизонта (мягкий градиент) — */
    function drawHaze() {
      const horizon = H - H * 0.34;
      const grad = c2d.createLinearGradient(0, horizon - 60, 0, H);
      grad.addColorStop(0, "rgba(214,242,236,0)");
      grad.addColorStop(0.55, "rgba(190,233,245,0.35)");
      grad.addColorStop(1, "rgba(214,242,236,0.6)");
      c2d.fillStyle = grad;
      c2d.fillRect(0, horizon - 60, W, H - (horizon - 60));
    }

    /* — созвездия-связи (обе темы) — */
    function drawConstellations(ox: number, oy: number) {
      const skyH = H * 0.72;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.8);
      c2d.save();
      if (isDark) {
        c2d.shadowColor = ORBIT;
        c2d.shadowBlur = 6;
      }
      for (const pts of constellations) {
        // линии-связи
        c2d.strokeStyle = isDark ? ORBIT : "#4b7d94";
        c2d.lineWidth = isDark ? 0.8 : 0.7;
        c2d.globalAlpha = (isDark ? 0.3 : 0.16) + 0.12 * pulse;
        c2d.beginPath();
        pts.forEach((p, i) => {
          const x = p.xf * W + ox * 0.6;
          const y = p.yf * skyH + oy * 0.6;
          if (i === 0) c2d.moveTo(x, y);
          else c2d.lineTo(x, y);
        });
        c2d.stroke();
        // звёзды-узлы
        for (const p of pts) {
          const x = p.xf * W + ox * 0.6;
          const y = p.yf * skyH + oy * 0.6;
          const tw = 0.55 + 0.45 * Math.sin(t * 1.6 + p.tw);
          c2d.globalAlpha = (isDark ? 0.85 : 0.4) * tw;
          c2d.fillStyle = isDark ? TEAL : "#3f7186";
          c2d.beginPath();
          c2d.arc(x, y, isDark ? 1.5 : 1.2, 0, Math.PI * 2);
          c2d.fill();
        }
      }
      c2d.restore();
    }

    /* — город-скайлайн (line-art) + лучи-сигналы к планете — */
    function drawCity(ox: number) {
      const maxH = H * 0.34;
      const base = H + 1;
      const CX = W / 2,
        CY = H / 2;
      const par = ox * 0.35;

      c2d.save();
      c2d.lineJoin = "round";
      c2d.lineCap = "round";

      // Сначала лучи-сигналы (под контуром города).
      for (const b of buildings) {
        if (!b.signal) continue;
        const bx = b.xf * W + par;
        const bw = b.wf * W;
        const top = base - b.hf * maxH - b.antenna;
        const sx = bx + bw / 2;
        const sy = top;
        c2d.save();
        c2d.globalAlpha = isDark ? 0.28 : 0.2;
        c2d.strokeStyle = isDark ? ACCENT : "#4b7d94";
        c2d.lineWidth = 0.8;
        c2d.setLineDash([2, 6]);
        c2d.beginPath();
        c2d.moveTo(sx, sy);
        c2d.lineTo(CX, CY);
        c2d.stroke();
        c2d.setLineDash([]);
        // бегущий импульс вдоль луча
        const prog = (t * 0.13 + b.phase / (Math.PI * 2)) % 1;
        const dotX = sx + (CX - sx) * prog;
        const dotY = sy + (CY - sy) * prog;
        if (isDark) {
          c2d.shadowColor = TEAL;
          c2d.shadowBlur = 8;
        }
        c2d.globalAlpha = (isDark ? 0.9 : 0.55) * (1 - prog);
        c2d.fillStyle = isDark ? TEAL : "#2f6274";
        c2d.beginPath();
        c2d.arc(dotX, dotY, 1.8, 0, Math.PI * 2);
        c2d.fill();
        c2d.restore();
      }

      // Контуры зданий.
      if (isDark) {
        c2d.shadowColor = ACCENT;
        c2d.shadowBlur = 7;
      }
      c2d.strokeStyle = cityColor;
      for (const b of buildings) {
        const bx = b.xf * W + par;
        const bw = b.wf * W;
        const bh = b.hf * maxH;
        const top = base - bh;

        c2d.globalAlpha = isDark ? 0.55 : 0.72;
        c2d.lineWidth = 1;
        // силуэт (левая стойка, крыша, правая стойка)
        c2d.beginPath();
        c2d.moveTo(bx, base);
        c2d.lineTo(bx, top);
        c2d.lineTo(bx + bw, top);
        c2d.lineTo(bx + bw, base);
        c2d.stroke();

        // тонкие линии-этажи
        c2d.globalAlpha = isDark ? 0.22 : 0.3;
        c2d.lineWidth = 0.6;
        for (let f = 1; f <= b.floors; f++) {
          const fy = top + (bh * f) / (b.floors + 1);
          c2d.beginPath();
          c2d.moveTo(bx + 1.5, fy);
          c2d.lineTo(bx + bw - 1.5, fy);
          c2d.stroke();
        }

        // антенна + мигающий огонёк
        if (b.antenna > 0) {
          const ax = bx + bw / 2;
          c2d.globalAlpha = isDark ? 0.5 : 0.6;
          c2d.lineWidth = 0.9;
          c2d.beginPath();
          c2d.moveTo(ax, top);
          c2d.lineTo(ax, top - b.antenna);
          c2d.stroke();
          const blink = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + b.phase));
          c2d.save();
          if (isDark) {
            c2d.shadowColor = TEAL;
            c2d.shadowBlur = 8;
          }
          c2d.globalAlpha = (isDark ? 0.95 : 0.7) * blink;
          c2d.fillStyle = isDark ? TEAL : "#2f6274";
          c2d.beginPath();
          c2d.arc(ax, top - b.antenna, 1.6, 0, Math.PI * 2);
          c2d.fill();
          c2d.restore();
        }
      }
      c2d.restore();
    }

    function frame() {
      t += 0.016;
      c2d.clearRect(0, 0, W, H);
      const ox = px.get() * 22,
        oy = py.get() * 22;

      if (isDark) {
        drawStars(ox, oy);
        drawComets();
      } else {
        drawClouds(ox);
        drawHaze();
      }
      drawConstellations(ox, oy);
      drawCity(ox);

      raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(resize);
    if (cv.parentElement) ro.observe(cv.parentElement);
    resize();
    generate();
    frame();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [px, py, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

/* ════════════ Планета в стиле line-art (2D, анимированная) ════════════ */
/* Проволочный глобус: контур + широты + вращающиеся меридианы,
 * наклонная орбита со спутником, мягкое свечение атмосферы.
 * Всё выполнено штрихами (без заливок) в цветовой гамме проекта. */

const GLOBE_R = 92; // радиус планеты
const MERIDIANS = 6; // кол-во меридианов
const MERI_STEPS = 32; // сэмплов на один оборот

/** Ключевые кадры rx для одного меридиана с фазовым сдвигом (иллюзия вращения). */
function meridianKeyframes(phase: number): number[] {
  const kf: number[] = [];
  for (let j = 0; j <= MERI_STEPS; j++) {
    const angle = 2 * Math.PI * (j / MERI_STEPS + phase);
    kf.push(+(GLOBE_R * Math.abs(Math.cos(angle))).toFixed(2));
  }
  return kf;
}

/** Горизонтальные линии широт (статичные эллипсы-хорды с перспективой). */
function LatitudeLines({ c }: { c: number }) {
  const lats = [-0.62, -0.32, 0, 0.32, 0.62];
  return (
    <>
      {lats.map((f, i) => {
        const dy = GLOBE_R * f;
        const rx = Math.sqrt(Math.max(GLOBE_R * GLOBE_R - dy * dy, 0));
        const ry = Math.max(rx * 0.2, 1.5);
        return (
          <ellipse
            key={i}
            cx={c}
            cy={c + dy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke="var(--cn-accent,#22d3ee)"
            strokeWidth={0.9}
            opacity={f === 0 ? 0.55 : 0.32}
          />
        );
      })}
    </>
  );
}

function MythicEarth({ px, py }: { px: { get: () => number }; py: { get: () => number } }) {
  // тонкий параллакс самой планеты
  const tx = useSpring(useMotionValue(0));
  const ty = useSpring(useMotionValue(0));
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      tx.set(px.get() * 10);
      ty.set(py.get() * 10);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [px, py, tx, ty]);

  const SZ = 320,
    C = 160,
    R = GLOBE_R;
  const Ro = R + 42,
    Rr = 40; // радиусы орбиты (наклонный эллипс)
  const orbitPath = `M ${C - Ro},${C} a ${Ro},${Rr} 0 1,0 ${2 * Ro},0 a ${Ro},${Rr} 0 1,0 ${-2 * Ro},0`;

  return (
    <motion.svg
      width={SZ}
      height={SZ}
      viewBox={`0 0 ${SZ} ${SZ}`}
      style={{ translateX: tx, translateY: ty, overflow: "visible" }}
    >
      <defs>
        <radialGradient id="atmoGlow" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="rgba(34,211,238,0)" />
          <stop offset="82%" stopColor="rgba(34,211,238,0.22)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
        </radialGradient>
        <radialGradient id="coreFill" cx="42%" cy="36%" r="70%">
          <stop offset="0%" stopColor="rgba(103,232,249,0.12)" />
          <stop offset="70%" stopColor="rgba(124,58,237,0.06)" />
          <stop offset="100%" stopColor="rgba(4,5,10,0)" />
        </radialGradient>
        <clipPath id="globeClip">
          <circle cx={C} cy={C} r={R} />
        </clipPath>
      </defs>

      {/* мягкое свечение атмосферы */}
      <circle cx={C} cy={C} r={R + 18} fill="url(#atmoGlow)" />

      {/* наклонная орбита + спутник (SMIL animateMotion) */}
      <g transform={`rotate(-18 ${C} ${C})`}>
        <path
          id="cn-orbit"
          d={orbitPath}
          fill="none"
          stroke="var(--cn-orbit,#a78bfa)"
          strokeWidth={1}
          strokeDasharray="2 7"
          strokeLinecap="round"
          opacity={0.5}
        />
        <circle r={3.2} fill="none" stroke="#5eead4" strokeWidth={1.4}>
          <animateMotion dur="16s" repeatCount="indefinite" rotate="auto">
            <mpath href="#cn-orbit" />
          </animateMotion>
        </circle>
      </g>

      {/* тело планеты (line-art) */}
      <g clipPath="url(#globeClip)">
        <circle cx={C} cy={C} r={R} fill="url(#coreFill)" />
        <LatitudeLines c={C} />
        {/* вращающиеся меридианы */}
        {Array.from({ length: MERIDIANS }).map((_, i) => (
          <motion.ellipse
            key={i}
            cx={C}
            cy={C}
            ry={R}
            fill="none"
            stroke="var(--cn-accent,#22d3ee)"
            strokeWidth={0.9}
            opacity={0.34}
            initial={{ rx: meridianKeyframes(i / MERIDIANS)[0] }}
            animate={{ rx: meridianKeyframes(i / MERIDIANS) }}
            transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
          />
        ))}
      </g>

      {/* контур планеты + мягкий пульс */}
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--cn-accent,#22d3ee)" strokeWidth={1.6} opacity={0.9} />
      <motion.circle
        cx={C}
        cy={C}
        r={R}
        fill="none"
        stroke="var(--cn-orbit,#a78bfa)"
        strokeWidth={1.2}
        animate={{ opacity: [0.15, 0.45, 0.15], r: [R, R + 4, R] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* лёгкий блик-дуга (полюс освещения) */}
      <path
        d={`M ${C - R * 0.5},${C - R * 0.72} A ${R} ${R} 0 0 1 ${C + R * 0.72},${C - R * 0.5}`}
        fill="none"
        stroke="#5eead4"
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.55}
      />
    </motion.svg>
  );
}

/* ════════════ Часы города пользователя ════════════ */
function CityClock() {
  const [city, setCity] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let ok = true;
    fetch("/api/profile/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ok || !d?.city) return;
        const z = timezoneForCity(d.city);
        if (z) {
          setCity(d.city);
          setTz(z);
        }
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, []);

  useEffect(() => {
    if (!tz) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [tz]);

  if (!tz || !city) return null;
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
  const date = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: tz }).format(now);
  const blink = now.getSeconds() % 2 === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.5, type: "spring", stiffness: 200, damping: 20 }}
      className="absolute"
      style={{
        right: 30,
        top: 30,
        padding: 0,
        textAlign: "right",
        background: "transparent",
        border: "none",
      }}
    >
      <div
        style={{
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: 1,
          lineHeight: 1,
          background: "linear-gradient(90deg,#67e8f9,#a78bfa)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {time.replace(":", blink ? ":" : "\u2009")}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cn-text,#e5e7eb)", marginTop: 4 }}>{city}</div>
      <div style={{ fontSize: 10, color: "var(--cn-muted,#94a3b8)" }}>{date}</div>
    </motion.div>
  );
}

/* ════════════ Главный компонент ════════════ */
export default function ConnectWelcome({ onCreate, onJoin }: ConnectWelcomeProps) {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [qi, setQi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const px = useSpring(mx, { stiffness: 50, damping: 18 });
  const py = useSpring(my, { stiffness: 50, damping: 18 });

  useEffect(() => {
    const id = setInterval(() => setQi((i) => (i + 1) % QUOTES.length), 4600);
    return () => clearInterval(id);
  }, []);

  function onMove(e: React.MouseEvent) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    my.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  }
  function onLeave() {
    mx.set(0);
    my.set(0);
  }

  /* Тёмная тема — прежний открытый космос: город, созвездия, планета.
     Светлая — пустой лист. Вся сцена ниже рисуется только при isDark, поэтому
     в светлой теме на экране остаются девиз, цитата, кнопки и часы города, а
     фон — ровная поверхность контента без единого элемента графики. */
  const bg = isDark
    ? "radial-gradient(120% 120% at 28% 18%, rgba(56,189,248,0.12), transparent 55%)," +
      "radial-gradient(120% 120% at 78% 82%, rgba(167,139,250,0.14), transparent 55%)," +
      "radial-gradient(150% 150% at 50% 50%, var(--cn-main,#070a12), #04050a)"
    : "var(--cn-main,#ffffff)";

  // Premium Monochrome — фоном служит загруженное пользователем зацикленное
  // видео (backgroundvid.mp4). Поверх — монохромная надпись CONNECT по центру,
  // а обе рабочие кнопки вынесены в нижнюю часть экрана. Лёгкое затемнение
  // видео обеспечивает читаемость текста и кнопок.
  if (theme === "mono") {
    return (
      <div
        ref={wrapRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="flex-1 relative overflow-hidden flex items-center justify-center"
        style={{ background: "#08090b" }}
      >
        {/* Зацикленное фоновое видео вместо прежнего line-art космоса. */}
        <video
          className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          src="/uploads/banners/backgroundvid.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />

        {/* Монохромное затемнение — читаемость надписи и кнопок поверх видео. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 42%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.30) 55%, rgba(0,0,0,0.70) 100%)",
          }}
        />

        {/* Надпись CONNECT — стилизована под монохром (серебристый градиент). */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="relative z-10 select-none font-black text-center"
          style={{
            fontSize: "clamp(2.75rem, 11vw, 7rem)",
            letterSpacing: "0.32em",
            paddingLeft: "0.32em", // компенсация трекинга последней буквы
            lineHeight: 1,
            background: "linear-gradient(180deg, #ffffff 0%, #d3d7dd 46%, #85888f 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            filter: "drop-shadow(0 2px 18px rgba(0,0,0,0.55))",
          }}
        >
          CONNECT
        </motion.h1>

        {/* Рабочие действия — вынесены в нижнюю часть экрана. */}
        <div className="absolute bottom-10 left-0 right-0 z-10 flex gap-3 justify-center pointer-events-auto">
          <button
            onClick={onCreate}
            className="mono-chip px-7 py-2.5 rounded-xl font-semibold text-sm"
          >
            Создать пространство
          </button>
          <button
            onClick={onJoin}
            className="px-7 py-2.5 rounded-xl font-semibold text-sm"
            style={{
              background: "rgba(255,255,255,0.03)",
              color: "#e9eaec",
              border: "1px solid rgba(255,255,255,0.20)",
              backdropFilter: "blur(6px)",
            }}
          >
            Присоединиться
          </button>
        </div>
      </div>
    );
  }

  // Monochrome Lite — строгий минимализм: белый фон полностью без графики,
  // только чёрный текст. Никакой космической сцены и градиентов.
  if (theme === "mono-lite") {
    return (
      <div className="flex-1 relative overflow-hidden flex items-center justify-center" style={{ background: "#ffffff" }}>
        <div className="px-6 text-center">
          <h1
            className="select-none font-black"
            style={{
              fontSize: "clamp(2.5rem, 10vw, 6rem)",
              letterSpacing: "0.3em",
              paddingLeft: "0.3em",
              lineHeight: 1,
              color: "#000000",
            }}
          >
            CONNECT
          </h1>
          <p className="mt-6 font-semibold" style={{ fontSize: 20, color: "#000000" }}>
            {MOTTO}
          </p>
          <div style={{ minHeight: 24 }} className="mt-3 mb-8">
            <AnimatePresence mode="wait">
              <motion.p
                key={qi}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="text-sm italic"
                style={{ color: "#5f6167" }}
              >
                «{QUOTES[qi]}»
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onCreate}
              className="px-7 py-2.5 rounded-xl font-semibold text-sm"
              style={{ background: "#f2f2f2", color: "#000000", border: "1px solid rgba(0,0,0,0.20)" }}
            >
              Создать пространство
            </button>
            <button
              onClick={onJoin}
              className="px-7 py-2.5 rounded-xl font-semibold text-sm"
              style={{ background: "transparent", color: "#000000", border: "1px solid rgba(0,0,0,0.20)" }}
            >
              Присоединиться
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="flex-1 relative overflow-hidden flex items-center justify-center"
      style={{ background: bg }}
    >
      {isDark && <SpaceScene px={px} py={py} theme="dark" />}
      <CityClock />

      {/* далёкая туманность — только в тёмной теме (открытый космос) */}
      {isDark && (
        <motion.div
          className="absolute pointer-events-none"
          animate={{ rotate: 360 }}
          transition={{ duration: 240, repeat: Infinity, ease: "linear" }}
          style={{
            width: 640,
            height: 640,
            borderRadius: "50%",
            filter: "blur(110px)",
            opacity: 0.26,
            background:
              "conic-gradient(from 210deg, rgba(34,211,238,0.22), rgba(94,234,212,0.16), rgba(167,139,250,0.24), rgba(34,211,238,0.22))",
          }}
        />
      )}

      {/* гало-свечение позади планеты — источник света */}
      {isDark && (
        <motion.div
          className="absolute pointer-events-none"
          animate={{ opacity: [0.5, 0.75, 0.5], scale: [1, 1.06, 1] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          style={{
            width: 300,
            height: 300,
            borderRadius: "50%",
            filter: "blur(46px)",
            background: "radial-gradient(circle, rgba(34,211,238,0.28), rgba(103,232,249,0.10) 45%, transparent 70%)",
          }}
        />
      )}

      {/* мифическая Земля под щитом — главный элемент композиции */}
      {isDark && <MythicEarth px={px} py={py} />}

      {/* виньетка — глубина космоса */}
      {isDark && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(120% 90% at 50% 45%, transparent 52%, rgba(4,5,10,0.55) 100%)" }}
        />
      )}

      {/* текст */}
      <div className="absolute bottom-10 left-0 right-0 px-6 text-center pointer-events-none">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="font-extrabold tracking-wide mb-2"
          style={{
            fontSize: 30,
            background: "linear-gradient(90deg,#67e8f9,#a78bfa,#5eead4)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {MOTTO}
        </motion.h2>
        <div style={{ minHeight: 24 }} className="mb-5">
          <AnimatePresence mode="wait">
            <motion.p
              key={qi}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5 }}
              className="text-sm italic"
              style={{ color: "var(--cn-muted,#94a3b8)" }}
            >
              «{QUOTES[qi]}»
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex gap-3 justify-center pointer-events-auto">
          <motion.button
            onClick={onCreate}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 16 }}
            className="px-7 py-2.5 rounded-xl font-semibold text-sm shadow-xl"
            style={{ background: "linear-gradient(135deg,#22d3ee,#6d28d9)", color: "#fff", boxShadow: "0 8px 28px rgba(34,211,238,0.35)" }}
          >
            Создать пространство
          </motion.button>
          <motion.button
            onClick={onJoin}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 16 }}
            className="px-7 py-2.5 rounded-xl font-semibold text-sm"
            style={{
              border: "1px solid var(--cn-accent,#22d3ee)",
              color: "var(--cn-text,#e5e7eb)",
              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.5)",
              backdropFilter: "blur(6px)",
            }}
          >
            Присоединиться
          </motion.button>
        </div>
      </div>
    </div>
  );
}
