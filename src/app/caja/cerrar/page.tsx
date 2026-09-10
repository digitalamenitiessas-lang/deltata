"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  cashNoteThreshold,
  closeCash,
  summarizeSession,
  type CashSummary,
} from "@/lib/ops";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS, formatARSSigned } from "@/lib/money";
import { useSesion } from "@/stores/sesion";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { PAYMENT_LABELS, type PaymentMethod } from "@/types";

// useSearchParams necesita un límite de Suspense para poder prerenderizar
export default function CerrarCajaPage() {
  return (
    <Suspense fallback={<PageHeader title="Cerrar caja" />}>
      <CerrarCaja />
    </Suspense>
  );
}

function CerrarCaja() {
  const router = useRouter();
  const params = useSearchParams();
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");
  const showToast = useUI((s) => s.showToast);
  const setHideNav = useUI((s) => s.setHideNav);

  // Con varias cajas abiertas (una por lugar) hay que cerrar LA que se pidió,
  // no la primera que aparezca. null = no hay; undefined = cargando.
  const idPedido = params.get("id");
  const openSession = useLiveQuery(async () => {
    if (idPedido) {
      const s = await db.cash_sessions.get(idPedido);
      return s && s.status === "abierta" ? s : null;
    }
    return (
      (await db.cash_sessions.where("status").equals("abierta").first()) ?? null
    );
  }, [idPedido]);
  const canal = useLiveQuery(
    async () =>
      openSession?.canal_id
        ? ((await db.canales.get(openSession.canal_id)) ?? null)
        : null,
    [openSession?.canal_id]
  );

  const [step, setStep] = useState<"conteo" | "revision">("conteo");
  const [countedRaw, setCountedRaw] = useState("");
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHideNav(true);
    return () => setHideNav(false);
  }, [setHideNav]);

  if (openSession === undefined) {
    return (
      <>
        <PageHeader title="Cerrar caja" />
        <div className="p-4" aria-busy />
      </>
    );
  }

  if (!openSession) {
    return (
      <>
        <PageHeader title="Cerrar caja" />
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <p className="text-sm text-ink-700">No hay ninguna caja abierta.</p>
          <Button onClick={() => router.replace("/caja")}>Volver a Caja</Button>
        </div>
      </>
    );
  }

  const counted = parseMoney(countedRaw);

  // Paso 1: conteo a ciegas. No se muestra el esperado hasta confirmar.
  if (step === "conteo") {
    return (
      <>
        <PageHeader
          title="Cerrar caja"
          subtitle={`${canal ? `${canal.nombre} · ` : ""}Paso 1 de 2 · Conteo`}
        />
        <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
          <div className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
            <p className="text-sm font-bold text-ink-950">
              Contá el efectivo físico de la caja
              {canal ? ` de ${canal.nombre}` : ""}.
            </p>
            <p className="mt-1 text-sm text-ink-700">
              No te mostraremos el importe esperado hasta que confirmes el
              conteo.
            </p>
          </div>
          <MoneyInput
            label="Efectivo contado"
            value={countedRaw}
            onChange={setCountedRaw}
            autoFocus
          />
          <Button
            size="lg"
            disabled={countedRaw === ""}
            onClick={async () => {
              const s = await summarizeSession(openSession);
              setSummary(s);
              setStep("revision");
            }}
          >
            Confirmar conteo
          </Button>
        </div>
      </>
    );
  }

  // Paso 2: revisión con esperado, diferencia y desglose por medio de pago
  const expected = summary?.expectedCash ?? 0;
  const difference = counted - expected;
  const needsNote =
    Math.abs(difference) >= cashNoteThreshold(expected) && note.trim() === "";

  return (
    <>
      <PageHeader
        title="Cerrar caja"
        subtitle={`${canal ? `${canal.nombre} · ` : ""}Paso 2 de 2 · Revisión`}
      />
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
          <dl className="tnum flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-700">Fondo inicial</dt>
              <dd className="font-bold">{formatARS(openSession.opening_float)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-700">Ventas en efectivo</dt>
              <dd className="font-bold">
                {formatARS(summary?.byMethod.efectivo ?? 0)}
              </dd>
            </div>
            {summary && summary.cashCustomerPayments > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-700">Cobros cta. cte. en efectivo</dt>
                <dd className="font-bold">
                  {formatARS(summary.cashCustomerPayments)}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-ink-700">Gastos en efectivo</dt>
              <dd className="font-bold text-terracotta-500">
                −{formatARS(summary?.cashExpenses ?? 0)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-[var(--border-soft)] pt-2">
              <dt className="font-bold">Efectivo esperado</dt>
              <dd className="font-bold">{formatARS(expected)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="font-bold">Efectivo contado</dt>
              <dd className="font-bold">{formatARS(counted)}</dd>
            </div>
            <div
              className={`flex justify-between rounded-xl px-2 py-1.5 text-base ${
                difference === 0
                  ? "bg-[#e5f2e9] text-success-600"
                  : "bg-[#f8e5e4] text-danger-600"
              }`}
            >
              <dt className="font-bold">Diferencia</dt>
              <dd className="font-bold">{formatARSSigned(difference)}</dd>
            </div>
          </dl>
        </section>

        {summary ? (
          <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              Otros medios del turno
            </h2>
            <dl className="tnum flex flex-col gap-1 text-sm">
              {(
                ["transferencia", "qr", "tarjeta", "cuenta_corriente"] as PaymentMethod[]
              ).map((m) => (
                <div key={m} className="flex justify-between">
                  <dt className="text-ink-700">{PAYMENT_LABELS[m]}</dt>
                  <dd className="font-bold">{formatARS(summary.byMethod[m])}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <div>
          <label
            htmlFor="close-note"
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-700"
          >
            Nota {Math.abs(difference) >= cashNoteThreshold(expected) ? "(obligatoria por la diferencia)" : "(opcional)"}
          </label>
          <textarea
            id="close-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 py-2 text-sm outline-none focus:border-brand-700"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-[#f8e5e4] px-3 py-2 text-sm font-bold text-danger-600">
            {error}
          </p>
        ) : null}

        <p className="text-xs text-ink-500">
          El cierre no podrá editarse. Las correcciones posteriores se registran
          como ajustes.
        </p>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep("conteo")}>
            Volver al conteo
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={busy || needsNote}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await closeCash({
                  counted_cash: counted,
                  closed_by: profileName,
                  session_id: openSession.id,
                  note: note || undefined,
                  // si hubo movimientos entre el conteo y este tap, aborta
                  expected_snapshot: expected,
                });
                notifyOutboxChanged();
                showToast("Caja cerrada");
                router.replace("/caja");
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "No se pudo cerrar la caja."
                );
                // refrescar el resumen para que lo mostrado vuelva a ser verdad
                const fresh = await summarizeSession(openSession);
                setSummary(fresh);
                setBusy(false);
              }
            }}
          >
            {busy ? "Cerrando…" : "Cerrar caja definitivamente"}
          </Button>
        </div>
        {needsNote ? (
          <p className="text-center text-xs font-bold text-warning-600">
            La diferencia supera el umbral: explicá brevemente qué pasó.
          </p>
        ) : null}
      </div>
    </>
  );
}
