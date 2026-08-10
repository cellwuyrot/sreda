// Minimal inline icon set for the Workspace canvas.
// All icons stroke/fill with `currentColor` so they inherit the monochrome palette.

import type { Status } from "./types";

type IconProps = { className?: string; size?: number; strokeWidth?: number };

function base(size?: number) {
  return { width: size ?? 16, height: size ?? 16, viewBox: "0 0 24 24" };
}

const stroke = (sw?: number) => ({
  fill: "none",
  stroke: "currentColor",
  strokeWidth: sw ?? 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const SearchIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3-3" />
  </svg>
);

export const PlusIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const CloseIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const TrashIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const GripIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <circle cx="9" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="18" r="1" />
  </svg>
);

export const ClockIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const PlayIcon = ({ className, size }: IconProps) => (
  <svg {...base(size)} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M7 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 7 5.5Z" />
  </svg>
);

export const PauseIcon = ({ className, size }: IconProps) => (
  <svg {...base(size)} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export const ResetIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const CalendarIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v3M16 3v3" />
  </svg>
);

export const TaskIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>
);

export const NoteIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M5 3h9l5 5v13a0 0 0 0 1 0 0H5a0 0 0 0 1 0 0V3Z" />
    <path d="M14 3v5h5M8 13h8M8 17h5" />
  </svg>
);

export const LinkIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
  </svg>
);

export const ImageIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m4 17 5-5 4 4 3-3 4 4" />
  </svg>
);

export const DocumentIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M6 2.5h7l5 5V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21V3a.5.5 0 0 1 .5-.5Z" />
    <path d="M13 2.5V8h5M9 12h6M9 15.5h6M9 19h4" />
  </svg>
);

export const LayersIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
    <path d="m3 12 9 4.5L21 12M3 16.5 12 21l9-4.5" />
  </svg>
);

export const TableIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9.5h18M3 14.5h18M9 4.5v15M15 4.5v15" />
  </svg>
);

export const UploadIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M12 15V4m0 0 4 4m-4-4-4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const DownloadIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const ExpandIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M15 20h4a1 1 0 0 0 1-1v-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </svg>
);

export const ChevronDownIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ArrowLeftIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M15 19l-7-7 7-7" />
  </svg>
);

export const SortIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />
  </svg>
);

export const FilterIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M3 5h18M6 12h12M10 19h4" />
  </svg>
);

export const InboxIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M3 13h4l2 3h6l2-3h4" />
    <path d="M5 6h14l2 7v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Z" />
  </svg>
);

export const ExternalIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </svg>
);

export const UndoIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);

export const RedoIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </svg>
);

export const CopyIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16V6a2 2 0 0 1 2-2h10" />
  </svg>
);

export const GridIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);

export const FrameIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
  </svg>
);

export const KeyboardIcon = ({ className, size, strokeWidth }: IconProps) => (
  <svg {...base(size)} {...stroke(strokeWidth)} className={className}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M8.5 14h7" />
  </svg>
);

/** Status glyphs: empty ring → half ring → filled check. Monochrome. */
export const StatusGlyph = ({
  status,
  className,
  size,
}: {
  status: Status;
  className?: string;
  size?: number;
}) => {
  const s = size ?? 16;
  if (status === "done") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" className={className}>
        <circle cx="12" cy="12" r="9" fill="currentColor" />
        <path
          d="m8.5 12 2.5 2.5 4.5-5"
          fill="none"
          stroke="var(--tzw-glyph-check, #fff)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === "doing") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" className={className}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
};
