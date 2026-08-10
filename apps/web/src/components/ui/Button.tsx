"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import Spinner from "@/components/ui/Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all " +
  "disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none";

const variantMap: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-violet-600 to-indigo-600 dark:from-cyan-500 dark:to-cyan-400 " +
    "text-white dark:text-neutral-900 hover:shadow-lg hover:shadow-violet-500/20 dark:hover:shadow-cyan-500/20",
  secondary:
    "border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-gray-200 " +
    "hover:bg-neutral-100 dark:hover:bg-white/5",
  danger:
    "bg-red-500 text-white hover:bg-red-600 hover:shadow-lg hover:shadow-red-500/20",
  ghost:
    "text-neutral-600 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-white/5",
};

const sizeMap: Record<Size, string> = {
  sm: "px-3 py-2 text-sm",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

/** Themed button primitive. Colors come from `variant`, padding from `size`. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, fullWidth = false, className = "", disabled, children, ...rest },
  ref,
) {
  const spinnerTone = variant === "primary" ? "white" : "current";
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${base} ${variantMap[variant]} ${sizeMap[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" tone={spinnerTone} />}
      {children}
    </button>
  );
});

export default Button;
