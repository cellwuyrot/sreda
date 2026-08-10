"use client";

/**
 * Line-art SVG glyphs for each ecosystem pillar on the /about page.
 * Every glyph draws with `currentColor`, so the parent controls the hue via
 * the section's accent colour. Kept intentionally minimal and "cosmic".
 */

interface GlyphProps {
  className?: string;
}

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** TrioZ MMORPG — a runed planet crossed by a blade. */
function TriozGlyph({ className }: GlyphProps) {
  return (
    <Frame className={className}>
      <circle cx="24" cy="24" r="11" />
      <ellipse cx="24" cy="24" rx="18" ry="6.5" transform="rotate(-28 24 24)" strokeOpacity="0.55" />
      <path d="M24 15v18M18 21l12 6M30 21l-12 6" strokeOpacity="0.7" />
      <circle cx="24" cy="24" r="2.4" fill="currentColor" stroke="none" />
    </Frame>
  );
}

/** Перо Измерений — a quill / feather. */
function PeroGlyph({ className }: GlyphProps) {
  return (
    <Frame className={className}>
      <path d="M34 12c-9 1-16 7-19 16-1 3-1 6-1 6s3 0 6-1c9-3 15-10 16-19 .2-1.6-.4-2.2-2-2z" />
      <path d="M14 34l7-7M30 16c-3 .6-6 2.4-8 5M27 22c-2 .5-3.6 1.6-4.8 3.2" strokeOpacity="0.6" />
      <path d="M9 39c1.5-2.5 3-4 5-5" strokeOpacity="0.8" />
    </Frame>
  );
}

/** TZ.Connect — linked communication nodes. */
function ConnectGlyph({ className }: GlyphProps) {
  return (
    <Frame className={className}>
      <circle cx="14" cy="16" r="4" />
      <circle cx="34" cy="14" r="4" />
      <circle cx="30" cy="34" r="4" />
      <circle cx="13" cy="33" r="4" />
      <path d="M17.5 17.6l13-2.2M32 17.5 31 30M27 33l-11 .4M16 20l11 10" strokeOpacity="0.55" />
    </Frame>
  );
}

/** TZ.Library — an open book under a constellation. */
function LibraryGlyph({ className }: GlyphProps) {
  return (
    <Frame className={className}>
      <path d="M24 20c-3-2.2-7-3-11-2.6v16c4-.4 8 .4 11 2.6 3-2.2 7-3 11-2.6v-16c-4-.4-8 .4-11 2.6z" />
      <path d="M24 20v16" strokeOpacity="0.6" />
      <path d="M16 9l1.4 2.8L20 13l-2.6 1.2L16 17l-1.4-2.8L12 13l2.6-1.2z" strokeOpacity="0.8" />
      <circle cx="33" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="29" cy="14" r="0.8" fill="currentColor" stroke="none" />
    </Frame>
  );
}

const GLYPHS: Record<string, (p: GlyphProps) => React.ReactNode> = {
  trioz: TriozGlyph,
  pero: PeroGlyph,
  connect: ConnectGlyph,
  library: LibraryGlyph,
};

export default function ProjectGlyph({ name, className }: { name: string; className?: string }) {
  const Glyph = GLYPHS[name] ?? ConnectGlyph;
  return <>{Glyph({ className })}</>;
}
