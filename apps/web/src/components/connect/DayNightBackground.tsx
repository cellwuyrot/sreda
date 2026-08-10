"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTheme } from "@/components/Providers";

/* ───────────────────────────────────────────────────────────
 *  DayNightBackground — «Low-poly Horizon»
 *
 *  Векторный (SVG) фон смены дня и ночи. Цвета неба, солнца/луны,
 *  слоёв холмов и звёзд плавно интерполируются по реальному
 *  локальному времени. Стилистически дружит с frosted-glass UI.
 *
 *  Публичный API сохранён:
 *    <DayNightBackground opacity={0..1} />
 *    <DayNightMiniPreview opacity={0..100 | 0..1} />
 * ─────────────────────────────────────────────────────────── */

/* ─── палитра ключевых фаз суток ──────────────────────────── */
type Phase = {
  t: number;          // позиция на сутках 0..1 (час/24)
  skyTop: string;
  skyBottom: string;
  sun: string;        // цвет светила
  glow: string;       // ореол светила
  hills: [string, string, string, string]; // дальние → ближние
  star: number;       // прозрачность звёзд 0..1
};

const PHASES: Phase[] = [
  // ночь
  { t: 0.00, skyTop: "#0a0e23", skyBottom: "#1a2348", sun: "#cdd6ff", glow: "#5b6bb0", hills: ["#171f3f", "#141b38", "#0f1530", "#0a0f25"], star: 1 },
  // предрассвет ~4:48
  { t: 0.20, skyTop: "#13183a", skyBottom: "#3a3566", sun: "#cdd6ff", glow: "#5b6bb0", hills: ["#26244f", "#1e1d44", "#161634", "#0e0e26"], star: 0.7 },
  // рассвет ~6:30
  { t: 0.27, skyTop: "#48507f", skyBottom: "#ffb38a", sun: "#ffd9a0", glow: "#ff9e6b", hills: ["#6a6a9a", "#4f5586", "#343a66", "#1f2347"], star: 0.15 },
  // утро ~8:24
  { t: 0.35, skyTop: "#6fa6e6", skyBottom: "#cfe6ff", sun: "#fff3c4", glow: "#ffe39a", hills: ["#9ec4e8", "#7ba6d6", "#5b85b8", "#3d6294"], star: 0 },
  // полдень
  { t: 0.50, skyTop: "#4f9bea", skyBottom: "#bfe2ff", sun: "#fff7d6", glow: "#fff0a8", hills: ["#a9cdec", "#84afda", "#618cbe", "#406a9c"], star: 0 },
  // золотой час ~16:48
  { t: 0.70, skyTop: "#6f8fd0", skyBottom: "#ffd9a0", sun: "#ffd27a", glow: "#ff9e5a", hills: ["#9a9fc0", "#7c7fa8", "#5a5d88", "#3a3d63"], star: 0 },
  // закат ~18:30
  { t: 0.77, skyTop: "#3a3f78", skyBottom: "#ff8a6b", sun: "#ff9e5a", glow: "#ff6a4a", hills: ["#534f86", "#403c6e", "#2c2a54", "#1a1838"], star: 0.2 },
  // сумерки ~20:24
  { t: 0.85, skyTop: "#1a1f48", skyBottom: "#5a3f70", sun: "#cdd6ff", glow: "#7a5ba0", hills: ["#2c2c5c", "#22224c", "#181838", "#0e0e26"], star: 0.7 },
  // ночь
  { t: 1.00, skyTop: "#0a0e23", skyBottom: "#1a2348", sun: "#cdd6ff", glow: "#5b6bb0", hills: ["#171f3f", "#141b38", "#0f1530", "#0a0f25"], star: 1 },
];

/* ─── интерполяция ────────────────────────────────────────── */
function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function mixHex(a: string, b: string, k: number) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
}
function lerp(a: number, b: number, k: number) { return a + (b - a) * k; }

function phaseAt(t: number): Omit<Phase, "t"> {
  // найти соседние ключевые фазы
  let i = 0;
  for (; i < PHASES.length - 1; i++) {
    if (t >= PHASES[i].t && t <= PHASES[i + 1].t) break;
  }
  const p0 = PHASES[i], p1 = PHASES[Math.min(i + 1, PHASES.length - 1)];
  const span = p1.t - p0.t || 1;
  let k = (t - p0.t) / span;
  k = Math.max(0, Math.min(1, k));
  // сглаживание (smoothstep)
  k = k * k * (3 - 2 * k);
  return {
    skyTop: mixHex(p0.skyTop, p1.skyTop, k),
    skyBottom: mixHex(p0.skyBottom, p1.skyBottom, k),
    sun: mixHex(p0.sun, p1.sun, k),
    glow: mixHex(p0.glow, p1.glow, k),
    hills: [
      mixHex(p0.hills[0], p1.hills[0], k),
      mixHex(p0.hills[1], p1.hills[1], k),
      mixHex(p0.hills[2], p1.hills[2], k),
      mixHex(p0.hills[3], p1.hills[3], k),
    ] as [string, string, string, string],
    star: lerp(p0.star, p1.star, k),
  };
}

/* положение светила по дуге. day: 6→18 солнце; иначе луна */
function celestial(hour: number) {
  const isDay = hour >= 6 && hour < 18;
  const p = isDay ? (hour - 6) / 12 : ((hour < 6 ? hour + 6 : hour - 18) / 12);
  const x = 80 + p * 840;                       // viewBox шириной 1000
  const y = 470 - Math.sin(p * Math.PI) * 360;  // дуга над горизонтом ~110
  return { x, y, isDay };
}

/* детерминированные звёзды */
function makeStars(count: number, w = 1000, h = 600) {
  let s = 1337;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: count }, () => ({
    x: rnd() * w,
    y: rnd() * (h * 0.55),
    r: 0.6 + rnd() * 1.4,
    tw: rnd(),
  }));
}

/* low-poly силуэты холмов (4 гряды) */
const HILL_PATHS = [
  "M0,360 L120,300 L260,350 L400,290 L560,345 L720,295 L860,340 L1000,310 L1000,600 L0,600 Z",
  "M0,420 L160,370 L300,420 L470,360 L640,425 L820,370 L1000,415 L1000,600 L0,600 Z",
  "M0,480 L180,440 L360,490 L540,435 L720,495 L900,445 L1000,480 L1000,600 L0,600 Z",
  "M0,540 L220,505 L440,555 L660,505 L880,555 L1000,525 L1000,600 L0,600 Z",
];

function useTimeFraction(updateMs = 60_000) {
  const [hour, setHour] = useState(() => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setHour(d.getHours() + d.getMinutes() / 60);
    }, updateMs);
    return () => clearInterval(id);
  }, [updateMs]);
  return hour;
}

/* ─── собственно SVG-сцена ────────────────────────────────── */
function Scene({ hour, uid }: { hour: number; uid: string }) {
  const pal = useMemo(() => phaseAt(hour / 24), [hour]);
  const cel = useMemo(() => celestial(hour), [hour]);
  const stars = useMemo(() => makeStars(70), []);

  return (
    <svg
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      style={{ display: "block", transition: "none" }}
    >
      <defs>
        <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.skyTop} />
          <stop offset="100%" stopColor={pal.skyBottom} />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={pal.glow} stopOpacity="0.9" />
          <stop offset="40%" stopColor={pal.glow} stopOpacity="0.35" />
          <stop offset="100%" stopColor={pal.glow} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* небо */}
      <rect x="0" y="0" width="1000" height="600" fill={`url(#sky-${uid})`} />

      {/* звёзды */}
      {pal.star > 0.02 && (
        <g opacity={pal.star}>
          {stars.map((st, i) => (
            <circle key={i} cx={st.x} cy={st.y} r={st.r} fill="#ffffff"
              opacity={0.5 + 0.5 * st.tw} />
          ))}
        </g>
      )}

      {/* ореол + светило */}
      <circle cx={cel.x} cy={cel.y} r="130" fill={`url(#glow-${uid})`} />
      <circle cx={cel.x} cy={cel.y} r="34" fill={pal.sun} />
      {!cel.isDay && (
        // лёгкий «полумесяц» — затемняющий круг со смещением
        <circle cx={cel.x + 13} cy={cel.y - 8} r="30" fill={pal.skyTop} opacity="0.85" />
      )}

      {/* low-poly холмы */}
      {HILL_PATHS.map((d, i) => (
        <path key={i} d={d} fill={pal.hills[i]} />
      ))}
    </svg>
  );
}

function LightThemeScene({ uid }: { uid: string }) {
  return (
    <svg
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      style={{ display: "block", transition: "none" }}
    >
      <defs>
        <linearGradient id={`light-sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8f2e8" />
          <stop offset="36%" stopColor="#f1e5d6" />
          <stop offset="72%" stopColor="#e4d4bf" />
          <stop offset="100%" stopColor="#d6c0a5" />
        </linearGradient>
        <linearGradient id={`light-haze-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff7ea" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#fff7ea" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`light-ground-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d9c0a0" />
          <stop offset="100%" stopColor="#bea07f" />
        </linearGradient>
        <linearGradient id={`terrace-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ead8c0" />
          <stop offset="100%" stopColor="#d0b08f" />
        </linearGradient>
        <linearGradient id={`mountain-far-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d4ccc2" />
          <stop offset="100%" stopColor="#bbb1a4" />
        </linearGradient>
        <linearGradient id={`mountain-mid-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#c1aa92" />
          <stop offset="100%" stopColor="#a0826b" />
        </linearGradient>
        <linearGradient id={`mountain-near-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9e7b63" />
          <stop offset="100%" stopColor="#7f5c46" />
        </linearGradient>
        <linearGradient id={`stone-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5ebdc" />
          <stop offset="55%" stopColor="#e6d4be" />
          <stop offset="100%" stopColor="#cfb396" />
        </linearGradient>
        <linearGradient id={`stone-shadow-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d4b99e" />
          <stop offset="100%" stopColor="#b48f70" />
        </linearGradient>
        <linearGradient id={`leaf-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a1b488" />
          <stop offset="100%" stopColor="#65794f" />
        </linearGradient>
        <radialGradient id={`sun-glow-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f6d8a4" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#f6d8a4" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="1000" height="600" fill={`url(#light-sky-${uid})`} />
      <rect x="0" y="0" width="1000" height="250" fill={`url(#light-haze-${uid})`} />
      <circle cx="798" cy="118" r="132" fill={`url(#sun-glow-${uid})`} />
      <circle cx="798" cy="118" r="42" fill="#f5d7a2" opacity="0.96" />

      <g opacity="0.55" stroke="#e8d7bf" strokeWidth="2.2" fill="none" strokeLinecap="round">
        <path d="M82,108 C104,96 126,96 148,108" />
        <path d="M172,84 C196,70 222,70 246,84" />
        <path d="M268,116 C292,100 320,102 344,116" />
      </g>

      <g fill="#7a6657" opacity="0.8">
        <g transform="translate(156 120)">
          <path d="M0,0 C10,-12 22,-12 32,0 C22,-4 10,-4 0,0 Z">
            <animateTransform attributeName="transform" type="translate" values="156 120;188 108;220 122;252 112;284 124" dur="28s" repeatCount="indefinite" />
          </path>
          <path d="M16,2 C24,-8 34,-8 42,2 C34,-1 24,-1 16,2 Z">
            <animateTransform attributeName="transform" type="translate" values="156 120;188 108;220 122;252 112;284 124" dur="28s" repeatCount="indefinite" />
          </path>
        </g>
        <g transform="translate(314 154) scale(0.78)">
          <path d="M0,0 C10,-12 22,-12 32,0 C22,-4 10,-4 0,0 Z">
            <animateTransform attributeName="transform" type="translate" values="314 154;354 138;394 150;434 140;474 154" dur="24s" repeatCount="indefinite" />
          </path>
          <path d="M16,2 C24,-8 34,-8 42,2 C34,-1 24,-1 16,2 Z">
            <animateTransform attributeName="transform" type="translate" values="314 154;354 138;394 150;434 140;474 154" dur="24s" repeatCount="indefinite" />
          </path>
        </g>
        <g transform="translate(520 104) scale(0.64)">
          <path d="M0,0 C10,-12 22,-12 32,0 C22,-4 10,-4 0,0 Z">
            <animateTransform attributeName="transform" type="translate" values="520 104;566 92;612 102;658 96;704 108" dur="20s" repeatCount="indefinite" />
          </path>
          <path d="M16,2 C24,-8 34,-8 42,2 C34,-1 24,-1 16,2 Z">
            <animateTransform attributeName="transform" type="translate" values="520 104;566 92;612 102;658 96;704 108" dur="20s" repeatCount="indefinite" />
          </path>
        </g>
      </g>

      <path d="M0,336 L88,286 L164,304 L246,246 L320,288 L388,228 L472,286 L558,232 L648,292 L736,244 L820,286 L908,250 L1000,300 L1000,600 L0,600 Z" fill={`url(#mountain-far-${uid})`} opacity="0.86" />
      <path d="M0,392 L104,334 L206,378 L304,294 L404,370 L514,286 L622,386 L732,308 L834,382 L930,320 L1000,356 L1000,600 L0,600 Z" fill={`url(#mountain-mid-${uid})`} opacity="0.92" />
      <path d="M0,458 L96,414 L194,448 L308,380 L430,452 L554,386 L676,458 L802,392 L906,446 L1000,416 L1000,600 L0,600 Z" fill={`url(#mountain-near-${uid})`} opacity="0.95" />

      <g opacity="0.26" fill="#fff6ec">
        <path d="M0,286 C122,258 194,298 284,274 C378,248 466,292 548,266 C652,234 746,294 1000,258 L1000,310 L0,310 Z" />
        <path d="M0,392 C106,376 182,404 268,384 C364,360 434,398 512,382 C618,360 702,406 1000,372 L1000,416 L0,416 Z" />
      </g>

      <rect x="0" y="506" width="1000" height="94" fill={`url(#light-ground-${uid})`} />
      <path d="M0,490 C132,466 228,502 340,482 C456,462 560,502 674,478 C802,452 888,496 1000,474 L1000,600 L0,600 Z" fill={`url(#terrace-${uid})`} opacity="0.58" />
      <path d="M0,528 C128,510 218,542 328,524 C432,506 556,548 678,524 C792,502 886,536 1000,520 L1000,600 L0,600 Z" fill="#d3b08d" opacity="0.42" />

      <g opacity="0.95">
        <path d="M74,516 L74,360 Q74,292 132,292 L296,292 Q350,292 350,352 L350,516 L320,516 L320,366 Q320,328 286,328 L164,328 Q126,328 126,366 L126,516 Z" fill={`url(#stone-${uid})`} />
        <path d="M116,516 L116,386 Q116,336 160,336 L206,336 L206,516 Z" fill={`url(#stone-shadow-${uid})`} opacity="0.44" />
        <path d="M226,516 L226,336 L272,336 Q308,336 308,378 L308,516 Z" fill={`url(#stone-shadow-${uid})`} opacity="0.3" />
        <path d="M92,294 L92,274 L332,274 L332,294" fill="#eadbc8" />
        <path d="M100,272 L214,242 L324,272" fill="#e2c9ab" opacity="0.96" />
        <rect x="98" y="300" width="228" height="10" rx="5" fill="#dcc1a4" />
        <path d="M104,312 H320" stroke="#cba789" strokeWidth="3" opacity="0.35" />
        <path d="M112,320 H312" stroke="#cba789" strokeWidth="2" opacity="0.25" />
        <path d="M148,278 h16 M186,278 h16 M224,278 h16 M262,278 h16" stroke="#caa280" strokeWidth="4" strokeLinecap="round" opacity="0.55" />
      </g>

      <g opacity="0.96">
        <rect x="348" y="324" width="26" height="202" rx="11" fill={`url(#stone-${uid})`} />
        <rect x="382" y="304" width="26" height="222" rx="11" fill={`url(#stone-${uid})`} />
        <rect x="416" y="318" width="26" height="208" rx="11" fill={`url(#stone-${uid})`} />
        <rect x="450" y="300" width="26" height="226" rx="11" fill={`url(#stone-${uid})`} />
        <rect x="340" y="286" width="146" height="16" rx="8" fill="#efdfcd" />
        <rect x="344" y="294" width="138" height="8" rx="4" fill="#d8b89a" opacity="0.7" />
        <rect x="344" y="526" width="136" height="16" rx="8" fill="#c8a587" opacity="0.88" />
        <path d="M362,324 Q356,358 364,396 Q370,434 362,470" stroke="#c7a284" strokeWidth="3.5" fill="none" opacity="0.42" />
        <path d="M396,304 Q390,346 398,390 Q404,436 396,486" stroke="#c7a284" strokeWidth="3.5" fill="none" opacity="0.42" />
        <path d="M430,318 Q424,356 432,402 Q438,446 430,484" stroke="#c7a284" strokeWidth="3.5" fill="none" opacity="0.42" />
        <path d="M464,300 Q458,340 466,392 Q472,438 464,488" stroke="#c7a284" strokeWidth="3.5" fill="none" opacity="0.42" />
      </g>

      <g opacity="0.94">
        <path d="M540,518 L540,382 Q540,354 564,354 L584,354 L584,518 Z" fill={`url(#stone-shadow-${uid})`} opacity="0.45" />
        <path d="M584,518 L584,340 Q584,316 612,316 L662,316 Q690,316 690,340 L690,518 Z" fill={`url(#stone-${uid})`} />
        <path d="M690,518 L690,382 Q690,354 714,354 L736,354 L736,518 Z" fill={`url(#stone-shadow-${uid})`} opacity="0.32" />
        <path d="M556,350 Q636,244 716,350 L688,350 Q636,292 584,350 Z" fill="#eedfcd" />
        <path d="M582,350 Q636,286 690,350" stroke="#cfa986" strokeWidth="7" fill="none" strokeLinecap="round" />
        <rect x="548" y="518" width="180" height="16" rx="8" fill="#c9a789" opacity="0.88" />
        <path d="M590,336 h18 M618,332 h18 M646,332 h18 M674,336 h18" stroke="#d3af90" strokeWidth="4" strokeLinecap="round" opacity="0.58" />
      </g>

      <g opacity="0.88">
        <path d="M720,516 L720,430 L806,400 L884,430 L884,516 Z" fill="#e4d0ba" />
        <path d="M742,516 L742,438 L804,418 L862,438 L862,516 Z" fill="#d2b395" opacity="0.48" />
        <path d="M738,430 L802,388 L868,430" fill="#ead7c3" />
        <path d="M760,448 L760,496 M790,438 L790,500 M820,444 L820,500 M850,450 L850,498" stroke="#c69e7d" strokeWidth="3" opacity="0.42" />
      </g>

      <g opacity="0.82">
        <path d="M804,518 C790,474 788,434 798,378 C820,396 834,420 842,450 C850,482 848,504 840,522 Z" fill={`url(#leaf-${uid})`} />
        <path d="M846,518 C834,484 836,446 848,398 C864,416 874,440 880,470 C886,494 882,512 874,524 Z" fill={`url(#leaf-${uid})`} opacity="0.9" />
        <path d="M886,520 C874,490 876,452 888,406 C902,424 910,450 914,478 C918,500 914,516 906,526 Z" fill={`url(#leaf-${uid})`} opacity="0.82" />
        <path d="M814,518 C814,474 814,432 818,374" stroke="#765f49" strokeWidth="7" strokeLinecap="round" />
        <path d="M856,520 C854,480 854,444 858,398" stroke="#765f49" strokeWidth="6" strokeLinecap="round" />
        <path d="M896,522 C894,486 894,452 898,408" stroke="#765f49" strokeWidth="5" strokeLinecap="round" />
      </g>

      <g opacity="0.62">
        <path d="M18,520 C26,470 30,430 26,384 C42,396 52,420 56,452 C60,482 56,506 46,524 Z" fill={`url(#leaf-${uid})`} />
        <path d="M56,520 C62,472 68,426 66,364 C82,382 92,410 96,446 C100,480 96,506 86,526 Z" fill={`url(#leaf-${uid})`} opacity="0.9" />
        <path d="M36,520 C38,474 40,432 42,388" stroke="#765f49" strokeWidth="5" strokeLinecap="round" />
        <path d="M76,520 C76,474 78,428 80,370" stroke="#765f49" strokeWidth="5" strokeLinecap="round" />
      </g>

      <g opacity="0.34">
        <path d="M0,514 C114,492 190,530 284,512 C388,492 476,534 572,514 C684,490 768,534 1000,500 L1000,600 L0,600 Z" fill="#fff7ef" />
      </g>
    </svg>
  );
}

/* ─── основной фон ────────────────────────────────────────── */
interface DayNightBackgroundProps {
  opacity?: number;
}

export default function DayNightBackground({ opacity = 0.15 }: DayNightBackgroundProps) {
  const hour = useTimeFraction();
  const uid = useId().replace(/:/g, "");
  const { theme } = useTheme();
  /* Монохром раньше выключал сцену целиком: цветной закат ломал его строгую
     чёрно-белую палитру. Но выключать движение ради палитры не обязательно —
     сцена рисуется и здесь, только обесцвеченной. Так фон дня и ночи доступен
     во всех темах, а монохром остаётся монохромом: ни одного цвета фильтр
     grayscale не пропускает.
     Светлые темы получают дневную сцену, тёмные — суточный горизонт. */
  const isMono = theme === "mono" || theme === "mono-lite";
  const isLight = theme === "light" || theme === "mono-lite";
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity,
        transition: "opacity 0.4s ease",
        overflow: "hidden",
        filter: isMono ? "grayscale(1)" : undefined,
      }}
    >
      {isLight ? <LightThemeScene uid={uid} /> : <Scene hour={hour} uid={uid} />}
    </div>
  );
}

/* ─── мини-превью для настроек ────────────────────────────── */
export function DayNightMiniPreview({ opacity }: { opacity: number }) {
  // принимаем и проценты (0..100), и доли (0..1)
  const a = opacity > 1 ? opacity / 100 : opacity;
  const hour = useTimeFraction(30_000);
  const uid = useId().replace(/:/g, "");
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 7",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--cn-border, rgba(255,255,255,0.1))",
      }}
    >
      <div style={{ position: "absolute", inset: 0 }}>
        <Scene hour={hour} uid={uid} />
      </div>
      {/* имитация прозрачности поверх «чата» */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(20,20,28,${1 - Math.min(0.6, a)})`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
