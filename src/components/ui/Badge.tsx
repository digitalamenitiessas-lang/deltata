import type { ReactNode } from "react";

export type BadgeTone = "ok" | "warn" | "danger" | "info" | "muted" | "brand";

const tones: Record<BadgeTone, string> = {
  ok: "bg-[#e5f2e9] text-success-600",
  warn: "bg-[#f7ecd8] text-warning-600",
  danger: "bg-[#f8e5e4] text-danger-600",
  info: "bg-[#e3edf4] text-info-600",
  muted: "bg-cream-200 text-ink-700",
  brand: "bg-brand-050 text-brand-900",
};

// La información nunca depende sólo del color: el texto siempre dice el estado.
export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
