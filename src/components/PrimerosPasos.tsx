"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { calcularSetup, confirmarPaso, type EstadoSetup } from "@/lib/setup";
import { useSesion, esAdmin } from "@/stores/sesion";
import { db } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";

/**
 * Qué falta para que el sistema sirva. Cada paso se marca solo cuando el dato
 * existe de verdad, así que no es una lista decorativa: mientras diga que
 * falta algo, es porque falta.
 */
export function PrimerosPasos({ compacto = false }: { compacto?: boolean }) {
  const usuario = useSesion((s) => s.usuario);
  const admin = esAdmin(usuario);
  const [estado, setEstado] = useState<EstadoSetup | null>(null);

  // Recalcular cuando cambia cualquier dato que un paso mira
  const señales = useLiveQuery(
    async () =>
      [
        await db.products.count(),
        await db.stock_counts.count(),
        await db.cash_sessions.count(),
        await db.sales.count(),
      ].join("-"),
    []
  );

  const recalcular = useCallback(() => {
    void calcularSetup().then(setEstado);
  }, []);

  useEffect(() => {
    recalcular();
  }, [recalcular, señales]);

  if (!estado || estado.completo) return null;

  // A quien atiende sólo le mostramos lo que puede resolver
  const visibles = admin
    ? estado.pasos
    : estado.pasos.filter((p) => !p.soloAdmin);
  const pendientes = visibles.filter((p) => !p.hecho);
  if (pendientes.length === 0) return null;

  const proximo = pendientes[0];
  const hechosVisibles = visibles.length - pendientes.length;

  // Versión corta para la pantalla de venta: una línea, sin robar espacio
  if (compacto) {
    return (
      <Link
        href={proximo.href}
        className="flex items-center gap-3 rounded-2xl border border-gold-500/45 bg-[#fdf6e6] px-4 py-3"
      >
        <span className="tnum shrink-0 rounded-full bg-gold-500 px-2 py-0.5 text-xs font-bold text-ink-950">
          {hechosVisibles}/{visibles.length}
        </span>
        <span className="min-w-0 flex-1 text-sm font-bold text-ink-950">
          Siguiente paso: {proximo.titulo.toLowerCase()}
        </span>
        <ArrowRight size={16} className="shrink-0 text-ink-700" aria-hidden />
      </Link>
    );
  }

  return (
    <section className="rounded-3xl border border-gold-500/45 bg-[#fdf6e6] p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-bold text-ink-950">
          Poner en marcha
        </h2>
        <span className="tnum shrink-0 text-sm font-bold text-ink-700">
          {hechosVisibles} de {visibles.length}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-700">
        Mientras falte alguno de estos, el sistema no te puede dar números
        confiables.
      </p>

      {/* barra de avance */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream-200">
        <div
          className="h-full rounded-full bg-brand-700 transition-[width] duration-500"
          style={{ width: `${(hechosVisibles / visibles.length) * 100}%` }}
        />
      </div>

      <ol className="mt-4 flex flex-col gap-2">
        {visibles.map((paso) => (
          <li key={paso.id}>
            <div
              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
                paso.hecho
                  ? "border-transparent bg-transparent opacity-55"
                  : "border-[var(--border-soft)] bg-surface-card"
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  paso.hecho
                    ? "bg-success-600 text-ink-inverse"
                    : "border border-[var(--border-strong)] text-ink-700"
                }`}
                aria-hidden
              >
                {paso.hecho ? <Check size={14} /> : ""}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-bold text-ink-950 ${
                    paso.hecho ? "line-through" : ""
                  }`}
                >
                  {paso.titulo}
                  {paso.pendiente ? (
                    <span className="ml-2 font-normal text-warning-600">
                      {paso.pendiente}
                    </span>
                  ) : null}
                </p>

                {!paso.hecho ? (
                  <>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-700">
                      {paso.porQue}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Link
                        href={paso.href}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-900 px-4 text-xs font-bold text-ink-inverse"
                      >
                        {paso.cta}
                        <ArrowRight size={13} aria-hidden />
                      </Link>
                      {paso.seConfirma ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await confirmarPaso(paso.id);
                            recalcular();
                          }}
                          className="text-xs font-bold text-ink-700 underline"
                        >
                          Ya los revisé
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Link
        href="/guia"
        className="mt-4 inline-block text-xs font-bold text-brand-900 underline"
      >
        ¿Qué hace cada parte del sistema?
      </Link>
    </section>
  );
}
