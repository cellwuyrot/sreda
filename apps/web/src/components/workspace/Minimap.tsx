"use client";

import { AnyCard, CARD_WIDTH, cardWidth, nodeAccent } from "./types";

type CSS = React.CSSProperties;

const MM_W = 190;
const MM_H = 130;
const PAD = 8;
/** Nominal node height used only for the minimap silhouette. */
const NODE_H = 150;

interface View {
  x: number;
  y: number;
  scale: number;
}

export default function Minimap({
  cards,
  view,
  viewportW,
  viewportH,
  onJump,
}: {
  cards: AnyCard[];
  view: View;
  viewportW: number;
  viewportH: number;
  onJump: (world: { x: number; y: number }) => void;
}) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cards) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + cardWidth(c));
    maxY = Math.max(maxY, c.y + (c.height ?? NODE_H));
  }

  const vpX = -view.x / view.scale;
  const vpY = -view.y / view.scale;
  const vpW = viewportW / view.scale;
  const vpH = viewportH / view.scale;
  minX = Math.min(minX, vpX);
  minY = Math.min(minY, vpY);
  maxX = Math.max(maxX, vpX + vpW);
  maxY = Math.max(maxY, vpY + vpH);

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = CARD_WIDTH;
    maxY = NODE_H;
  }

  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min((MM_W - 2 * PAD) / bw, (MM_H - 2 * PAD) / bh);
  const offX = PAD + ((MM_W - 2 * PAD) - bw * scale) / 2;
  const offY = PAD + ((MM_H - 2 * PAD) - bh * scale) / 2;
  const mx = (wx: number) => offX + (wx - minX) * scale;
  const my = (wy: number) => offY + (wy - minY) * scale;

  const jump = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    onJump({ x: minX + (cx - offX) / scale, y: minY + (cy - offY) / scale });
  };

  const wrap: CSS = { width: MM_W, height: MM_H };
  const vpStyle: CSS = {
    left: mx(vpX),
    top: my(vpY),
    width: Math.max(6, vpW * scale),
    height: Math.max(6, vpH * scale),
  };

  return (
    <div
      /* MOBILE-FIX: на телефоне миникарта перекрывала холст — скрыта */
      className="absolute right-3 top-3 max-md:hidden cursor-pointer overflow-hidden rounded-xl border border-neutral-200 bg-white/85 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/85"
      style={wrap}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={jump}
      title="Мини-карта · нажмите, чтобы перейти"
    >
      {cards.map((c) => {
        const s: CSS = {
          left: mx(c.x),
          top: my(c.y),
          width: Math.max(3, cardWidth(c) * scale),
          height: Math.max(3, (c.height ?? NODE_H) * scale),
          background: nodeAccent(c),
        };
        return <div key={c.id} className="absolute rounded-[2px] opacity-80" style={s} />;
      })}
      <div
        className="absolute rounded-[3px] border-2 border-neutral-900/70 bg-neutral-900/5 dark:border-white/70 dark:bg-white/10"
        style={vpStyle}
      />
    </div>
  );
}
