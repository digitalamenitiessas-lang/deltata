"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { openCash } from "@/lib/ops";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS } from "@/lib/money";
import { useCart } from "@/stores/cart";
import { useEquipo } from "@/stores/equipo";
import { canalDelLugar } from "@/lib/lugar";
import { useSesion } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";

// useSearchParams necesita un límite de Suspense para poder prerenderizar
export default function AbrirCajaPage() {
  return (
    <Suspense fallback={<PageHeader title="Abrir caja" />}>
      <AbrirCaja />
    </Suspense>
  );
}

function AbrirCaja() {
  const router = useRouter();
  const params = useSearchParams();
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");
  const showToast = useUI((s) => s.showToast);
  const setHideNav = useUI((s) => s.setHideNav);

  const [floatRaw, setFloatRaw] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada lugar abre su propia caja. Viene por la URL desde la pantalla de
  // Caja; si no, se elige acá.
  const canales = useLiveQuery(
    () => db.canales.orderBy("sort_order").toArray(),
    []
  );
  const activos = useMemo(
    () => (canales ?? []).filter((c) => c.activo),
    [canales]
  );
  const [canalElegido, setCanalElegido] = useState<string | null>(null);
  const ubicacionEquipo = useEquipo((s) => s.ubicacionId);
  const canalId =
    canalElegido ??
    params.get("canal") ??
    canalDelLugar(activos, ubicacionEquipo)?.id ??
    null;
  const canal = activos.find((c) => c.id === canalId);

  // Flujo crítico: la navegación desaparece mientras se completa
  useEffect(() => {
    setHideNav(true);
    return () => setHideNav(false);
  }, [setHideNav]);

  const amount = parseMoney(floatRaw);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await openCash({
        opening_float: amount,
        opened_by: profileName,
        canal_id: canalId,
        note: note || undefined,
      });
      notifyOutboxChanged();
      showToast(
        canal
          ? `Caja de ${canal.nombre} abierta con ${formatARS(amount)}`
          : `Caja abierta con ${formatARS(amount)}`
      );
      // Vender arranca en el canal de la caja recién abierta (antes volvía
      // con el canal anterior y decía "no hay caja abierta")
      useCart.getState().setCanalId(canalId);
      router.replace("/vender");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la caja.");
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Abrir caja"
        subtitle={
          canal
            ? `${canal.nombre} · ${profileName}`
            : `Responsable: ${profileName}`
        }
      />
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
        {activos.length > 1 ? (
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
              ¿De qué lugar es esta caja?
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Lugar">
              {activos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={canalId === c.id}
                  onClick={() => setCanalElegido(c.id)}
                  className={`h-11 rounded-xl px-4 text-sm font-bold ${
                    canalId === c.id
                      ? "bg-brand-900 text-ink-inverse"
                      : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                  }`}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-500">
              Cada lugar cierra su propio arqueo. Así el descuadre de uno no
              tapa el del otro.
            </p>
          </div>
        ) : null}

        <MoneyInput
          label="Fondo inicial"
          value={floatRaw}
          onChange={setFloatRaw}
          autoFocus
          hint="El cambio con el que arranca el turno."
        />
        <div>
          <label
            htmlFor="open-note"
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700"
          >
            Nota (opcional)
          </label>
          <input
            id="open-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
        </div>
        {error ? (
          <p role="alert" className="rounded-xl bg-[#f8e5e4] px-3 py-2 text-sm font-bold text-danger-600">
            {error}
          </p>
        ) : null}
        <Button size="lg" disabled={busy} onClick={() => void submit()}>
          {busy ? "Abriendo…" : `Abrir caja con ${formatARS(amount)}`}
        </Button>
      </div>
    </>
  );
}
