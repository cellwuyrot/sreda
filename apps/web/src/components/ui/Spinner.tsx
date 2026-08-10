type SpinnerSize = "sm" | "md" | "lg" | "xl";
type SpinnerTone = "accent" | "current" | "white" | "danger";

const sizeMap: Record<SpinnerSize, string> = {
  sm: "w-4 h-4 border-2",
  md: "w-6 h-6 border-2",
  lg: "w-8 h-8 border-2",
  xl: "w-10 h-10 border-[3px]",
};

const toneMap: Record<SpinnerTone, string> = {
  accent: "border-accent border-t-transparent",
  current: "border-current border-t-transparent",
  white: "border-white border-t-transparent",
  danger: "border-red-500 border-t-transparent",
};

/** Ring loading spinner. Color follows the active theme accent by default. */
export default function Spinner({
  size = "lg",
  tone = "accent",
  className = "",
}: {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      className={`animate-spin rounded-full ${sizeMap[size]} ${toneMap[tone]} ${className}`}
    />
  );
}
