import type { HTMLAttributes } from "react";

type Tone = "accent" | "neutral" | "success" | "warning" | "danger";

const toneMap: Record<Tone, string> = {
  accent: "bg-accent/10 text-accent border border-accent/20",
  neutral: "bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-gray-300",
  success: "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/** Small pill label. Defaults to the theme accent. */
export default function Badge({ tone = "accent", className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${toneMap[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
