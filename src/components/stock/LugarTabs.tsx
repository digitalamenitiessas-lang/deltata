"use client";

import type { Ubicacion } from "@/types";

/** Elegir de qué lugar se habla: el local y el foodtruck tienen su stock. */
export function LugarTabs({
  ubicaciones,
  valor,
  onChange,
  conTotal = false,
}: {
  ubicaciones: Ubicacion[];
  /** null = el total de todos los lugares */
  valor: string | null;
  onChange: (id: string | null) => void;
  conTotal?: boolean;
}) {
  const opciones: { id: string | null; nombre: string }[] = [
    ...ubicaciones.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre })),
    ...(conTotal ? [{ id: null, nombre: "Total" }] : []),
  ];
  if (opciones.length <= 1) return null;
  return (
    <div
      className="grid gap-1 rounded-2xl bg-cream-200 p-1"
      style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-label="Lugar"
    >
      {opciones.map((o) => (
        <button
          key={o.id ?? "total"}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          onClick={() => onChange(o.id)}
          className={`h-11 rounded-xl text-sm font-bold transition-colors duration-[var(--motion-fast)] ${
            valor === o.id ? "bg-brand-900 text-ink-inverse" : "text-ink-700"
          }`}
        >
          {o.nombre}
        </button>
      ))}
    </div>
  );
}
