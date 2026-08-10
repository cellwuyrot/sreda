import type { SVGProps } from "react";

// TZ.Connect — дополнительные фирменные иконки в едином стиле ConnectIcons:
// контурные SVG 24×24, stroke 1.9, currentColor, размер по умолчанию 20px.
// Заменяют цветные эмодзи ОС (📁 📂 📚 🖼 📎 🗑 ✏ ➕ 🔗 ✉ 📅 📊 📽 📕 🗜).
// Файл самодостаточен и не меняет существующий ConnectIcons.tsx.

type IconTone = "active" | "inactive" | "muted" | "danger";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  tone?: IconTone;
}

function toneClass(tone: IconTone = "inactive") {
  switch (tone) {
    case "active":
      return "text-cyan-400";
    case "muted":
      return "text-gray-400";
    case "danger":
      return "text-red-400";
    default:
      return "text-neutral-400";
  }
}

function IconBase({ size = 20, tone = "inactive", className = "", children, ...props }: IconProps) {
  return (
    <span className={`relative inline-flex items-center justify-center ${toneClass(tone)} ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {children}
      </svg>
    </span>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </IconBase>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 19V7a2 2 0 012-2h4l2 2h7a2 2 0 012 2v1" />
      <path d="M3 19l2.5-7H22l-2.6 7H3z" />
    </IconBase>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 5a2 2 0 012-2h14v16H6a2 2 0 00-2 2V5z" />
      <path d="M4 19a2 2 0 012-2h14" />
    </IconBase>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4 18l5-5 3 3 4-4 4 4" />
    </IconBase>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 12.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8L13 5a3.7 3.7 0 015.2 5.2l-8.2 8.2a1.8 1.8 0 01-2.6-2.6L15 8.3" />
    </IconBase>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <path d="M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </IconBase>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17l-1 3z" />
      <path d="M13.5 6.5l3 3" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 14a5 5 0 007.07 0l2.12-2.12a5 5 0 00-7.07-7.07L11 5.93" />
      <path d="M14 10a5 5 0 00-7.07 0l-2.12 2.12a5 5 0 007.07 7.07L13 18.07" />
    </IconBase>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </IconBase>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
    </IconBase>
  );
}

export function SheetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 17h7" />
      <path d="M12 11v8" />
    </IconBase>
  );
}

export function PresentationIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4" />
      <path d="M8 20h8" />
    </IconBase>
  );
}

export function PdfIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16h5" />
    </IconBase>
  );
}

export function ArchiveIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
      <path d="M10 12h4" />
    </IconBase>
  );
}
