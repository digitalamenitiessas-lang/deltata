"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";
type Size = "lg" | "md" | "sm";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-900 text-ink-inverse active:bg-brand-950 disabled:bg-ink-500/30 disabled:text-ink-500",
  secondary:
    "bg-cream-050 text-brand-900 border border-[var(--border-strong)] active:bg-cream-200 disabled:text-ink-500",
  ghost: "bg-transparent text-brand-900 active:bg-brand-050 disabled:text-ink-500",
  danger:
    "bg-danger-600 text-ink-inverse active:brightness-90 disabled:bg-ink-500/30",
  gold: "bg-gold-500 text-ink-950 active:brightness-95 disabled:bg-ink-500/30",
};

// Botón operativo: 52–60 px de alto en tamaño lg, área táctil mínima 44 px.
const sizes: Record<Size, string> = {
  lg: "h-14 px-6 text-base rounded-2xl",
  md: "h-11 px-4 text-sm rounded-xl",
  sm: "h-11 px-3 text-sm rounded-xl",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className = "", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 font-bold transition-colors duration-[var(--motion-fast)] select-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
});
