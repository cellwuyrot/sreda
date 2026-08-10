import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

/** Glass surface primitive. Set `hover` for the interactive variant. */
export default function Card({ hover = false, className = "", children, ...rest }: CardProps) {
  return (
    <div className={`${hover ? "glass-card-hover" : "glass-card"} ${className}`} {...rest}>
      {children}
    </div>
  );
}
