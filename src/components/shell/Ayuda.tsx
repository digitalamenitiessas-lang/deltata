"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, Lightbulb, Lock, BookOpen } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useSesion } from "@/stores/sesion";
import { ayudaPara, paraRol, recorridoPara, type EtapaId } from "@/lib/ayuda";

/**
 * El "?" de cada pantalla: qué es, qué hacer paso a paso, qué tener en cuenta
 * y en qué parte del día estás.
 */
export function BotonAyuda() {
  const [abierta, setAbierta] = useState(false);
  const pathname = usePathname();
  const ayuda = ayudaPara(pathname);
  if (!ayuda) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-label={`Ayuda: ${ayuda.titulo}`}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-surface-card text-brand-900 active:bg-cream-100"
      >
        <CircleHelp size={20} aria-hidden />
      </button>
      {abierta ? (
        <PanelAyuda pathname={pathname} onClose={() => setAbierta(false)} />
      ) : null}
    </>
  );
}

function PanelAyuda({
  pathname,
  onClose,
}: {
  pathname: string;
  onClose: () => void;
}) {
  const rol = useSesion((s) => s.usuario?.rol);
  const ayuda = ayudaPara(pathname);
  if (!ayuda) return null;

  const dueno = rol === "admin";
  const pasos = paraRol(ayuda.pasos, rol);
  const ojo = paraRol(ayuda.ojo, rol);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`¿Cómo funciona ${ayuda.titulo}?`}>
      <div className="flex flex-col gap-5">
        {ayuda.esDelDueno && !dueno ? (
          <p className="flex items-start gap-2 rounded-2xl bg-cream-200 p-3 text-sm text-ink-950">
            <Lock size={16} className="mt-0.5 shrink-0 text-ink-700" aria-hidden />
            Esta sección la maneja el dueño. Te contamos qué hace para que sepas
            a quién pedírselo.
          </p>
        ) : null}

        <p className="text-sm leading-relaxed text-ink-950">{ayuda.queEs}</p>

        {pasos.length > 0 && (dueno || !ayuda.esDelDueno) ? (
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              Paso a paso
            </h3>
            <ol className="flex flex-col gap-3">
              {pasos.map((p, i) => (
                <li key={p.t} className="flex gap-3">
                  <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-900 text-xs font-bold text-ink-inverse">
                    {i + 1}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-bold text-ink-950">{p.t}</p>
                    {p.d ? (
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-700">{p.d}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {ojo.length > 0 ? (
          <section className="rounded-2xl border border-[var(--border-soft)] bg-cream-100 p-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-700">
              <Lightbulb size={14} className="text-gold-500" aria-hidden />
              Tené en cuenta
            </h3>
            <ul className="flex flex-col gap-2">
              {ojo.map((o) => (
                <li key={o.t} className="text-sm leading-relaxed text-ink-950">
                  {o.t}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Recorrido actual={ayuda.etapa} onNavigate={onClose} />

        {ayuda.ver && ayuda.ver.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {ayuda.ver.map((v) => (
              <Link
                key={v.href}
                href={v.href}
                onClick={onClose}
                className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-bold text-brand-900"
              >
                {v.label} →
              </Link>
            ))}
          </div>
        ) : null}

        <Link
          href="/guia"
          onClick={onClose}
          className="flex items-center justify-center gap-2 text-sm font-bold text-brand-900 underline"
        >
          <BookOpen size={16} aria-hidden />
          Ver la guía completa
        </Link>
      </div>
    </Sheet>
  );
}

/** El día en la app, de punta a punta, con la etapa actual marcada. */
function Recorrido({
  actual,
  onNavigate,
}: {
  actual?: EtapaId;
  onNavigate: () => void;
}) {
  const rol = useSesion((s) => s.usuario?.rol);
  const etapas = recorridoPara(rol);

  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
        Tu recorrido en la app
      </h3>
      <ol className="relative flex flex-col">
        {etapas.map((e, i) => {
          const esActual = e.id === actual;
          const ultima = i === etapas.length - 1;
          return (
            <li key={e.id} className="relative flex gap-3 pb-3">
              {!ultima ? (
                <span
                  aria-hidden
                  className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5 bg-[var(--border-strong)]"
                />
              ) : null}
              <span
                className={`tnum relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  esActual
                    ? "bg-gold-500 text-ink-950 ring-4 ring-[#d7a23b33]"
                    : "border border-[var(--border-strong)] bg-surface-card text-ink-700"
                }`}
              >
                {i + 1}
              </span>
              <Link
                href={e.href}
                onClick={onNavigate}
                aria-current={esActual ? "step" : undefined}
                className="min-w-0 pt-0.5"
              >
                <p
                  className={`text-sm font-bold ${
                    esActual ? "text-brand-900" : "text-ink-950"
                  }`}
                >
                  {e.titulo}
                  {esActual ? (
                    <span className="ml-2 rounded-full bg-brand-900 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-ink-inverse">
                      Estás acá
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-ink-500">{e.cuando}</p>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
