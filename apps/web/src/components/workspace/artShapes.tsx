"use client";

import {
  boundsOf,
  normalizeBox,
  pointsToPath,
  safeColor,
  type ArtShape,
} from "@/lib/tzart";

/**
 * Отрисовка объектов TZartstation.
 *
 * Один и тот же код рисует и предпросмотр в карточке, и полотно в редакторе.
 * Иначе рисунок на доске «почти совпадал» бы с тем, что видно при правке, — а
 * это худший вид расхождения: заметить его можно только сравнив два экрана.
 *
 * Цвета и адреса картинок уже проверены разбором сцены (см. lib/tzart), но
 * подстраховываемся и здесь: в атрибут SVG не должно попасть ничего, кроме
 * настоящего цвета.
 */

/** Наконечник стрелки. Идентификатор разный у карточки и редактора: на странице
 *  они живут одновременно, а ссылка вида `url(#…)` берёт первый совпавший. */
export function ArtDefs({ markerId }: { markerId: string }) {
  return (
    <marker
      id={markerId}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="5"
      markerHeight="5"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
    </marker>
  );
}

export function ArtShapeView({
  shape,
  opacity,
  markerId,
}: {
  shape: ArtShape;
  opacity: number;
  markerId: string;
}) {
  const stroke = safeColor(shape.stroke, "#111827");
  const fill = shape.fill ? safeColor(shape.fill, "none") : "none";
  const width = shape.strokeWidth ?? 2;
  const box = normalizeBox(shape);
  const bounds = boundsOf(shape);
  const transform = shape.rotation
    ? `rotate(${shape.rotation} ${bounds.x + bounds.w / 2} ${bounds.y + bounds.h / 2})`
    : undefined;
  const common = { opacity, transform };

  if (shape.kind === "image") {
    return (
      <image
        {...common}
        href={shape.src}
        x={box.x}
        y={box.y}
        width={Math.max(1, box.w)}
        height={Math.max(1, box.h)}
        preserveAspectRatio="none"
      />
    );
  }

  if (shape.kind === "path") {
    return (
      <path
        {...common}
        d={pointsToPath(shape.points)}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  if (shape.kind === "rect") {
    return (
      <rect
        {...common}
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        fill={fill}
        stroke={stroke}
        strokeWidth={width}
        rx={4}
      />
    );
  }

  if (shape.kind === "ellipse") {
    return (
      <ellipse
        {...common}
        cx={box.x + box.w / 2}
        cy={box.y + box.h / 2}
        rx={Math.max(1, box.w / 2)}
        ry={Math.max(1, box.h / 2)}
        fill={fill}
        stroke={stroke}
        strokeWidth={width}
      />
    );
  }

  if (shape.kind === "line" || shape.kind === "arrow") {
    return (
      <line
        {...common}
        x1={shape.x}
        y1={shape.y}
        x2={shape.x + shape.w}
        y2={shape.y + shape.h}
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        color={stroke}
        markerEnd={shape.kind === "arrow" ? `url(#${markerId})` : undefined}
      />
    );
  }

  return (
    <text
      {...common}
      x={shape.x}
      y={shape.y + (shape.fontSize ?? 18)}
      fill={stroke}
      fontSize={shape.fontSize ?? 18}
      fontWeight={shape.bold ? 700 : 400}
      fontStyle={shape.italic ? "italic" : undefined}
    >
      {shape.text ?? ""}
    </text>
  );
}
