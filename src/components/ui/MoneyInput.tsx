"use client";

import { useId } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: string;
}

/** Entrada monetaria: teclado numérico, cifra grande y tabular. */
export function MoneyInput({ label, value, onChange, placeholder, autoFocus, hint }: Props) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-surface-elevated px-4 py-3 focus-within:border-brand-700">
        <span className="text-xl font-bold text-ink-500">$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder ?? "0"}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
          className="tnum w-full bg-transparent text-2xl font-bold text-ink-950 outline-none placeholder:text-ink-500/50"
        />
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function parseMoney(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
