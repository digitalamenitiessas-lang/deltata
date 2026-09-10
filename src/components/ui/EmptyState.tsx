import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
}

// Estado vacío que explica y propone, nunca un "No hay datos".
export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[var(--border-strong)] bg-surface-card px-6 py-10 text-center">
      <p className="text-base font-bold text-ink-950">{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-700">{description}</p> : null}
      {action}
    </div>
  );
}
