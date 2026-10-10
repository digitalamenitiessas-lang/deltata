"use client";

import { use } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatARS, formatARSSigned } from "@/lib/money";
import { PageHeader } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/Badge";
import { PAYMENT_LABELS, type PaymentMethod } from "@/types";

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

// Cierre inmutable: esta vista es de sólo lectura, siempre.
export default function CajaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const session = useLiveQuery(() => db.cash_sessions.get(id), [id]);
  const sales = useLiveQuery(
    () => db.sales.where("cash_session_id").equals(id).sortBy("sold_at"),
    [id]
  );
  const expenses = useLiveQuery(
    () => db.expenses.where("cash_session_id").equals(id).sortBy("spent_at"),
    [id]
  );

  if (!session) {
    return (
      <>
        <PageHeader title="Cierre de caja" />
        <p className="p-6 text-center text-sm text-ink-700">
          Esta caja no está disponible en este dispositivo.
        </p>
      </>
    );
  }

  const byMethod: Record<PaymentMethod, number> = {
    efectivo: 0,
    transferencia: 0,
    qr: 0,
    tarjeta: 0,
    cuenta_corriente: 0,
  };
  for (const s of sales ?? []) byMethod[s.payment_method] += s.total;
  const total = (sales ?? []).reduce((acc, s) => acc + s.total, 0);

  return (
    <>
      <PageHeader
        title="Cierre de caja"
        subtitle={dateFmt.format(new Date(session.opened_at))}
      />
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-500">
              Arqueo
            </h2>
            {session.difference === 0 ? (
              <Badge tone="ok">Cerró exacto</Badge>
            ) : (
              <Badge tone={Math.abs(session.difference ?? 0) >= 1000 ? "danger" : "warn"}>
                Con diferencia
              </Badge>
            )}
          </div>
          <dl className="tnum flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-700">Fondo inicial</dt>
              <dd className="font-bold">{formatARS(session.opening_float)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-700">Efectivo esperado</dt>
              <dd className="font-bold">
                {session.expected_cash != null ? formatARS(session.expected_cash) : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-700">Efectivo contado</dt>
              <dd className="font-bold">
                {session.counted_cash != null ? formatARS(session.counted_cash) : "—"}
              </dd>
            </div>
            <div className="flex justify-between text-base">
              <dt className="font-bold">Diferencia</dt>
              <dd
                className={`font-bold ${
                  (session.difference ?? 0) === 0 ? "text-success-600" : "text-danger-600"
                }`}
              >
                {session.difference != null ? formatARSSigned(session.difference) : "—"}
              </dd>
            </div>
          </dl>
          {session.note ? (
            <p className="mt-3 rounded-xl bg-cream-100 px-3 py-2 text-sm text-ink-700">
              {session.note}
            </p>
          ) : null}
          {session.sin_arqueo ? (
            <p className="mt-3 rounded-xl bg-[#f7ecd8] px-3 py-2 text-sm font-bold text-warning-600">
              Cerrada sin arqueo: no se contó el efectivo.
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ink-500">
            Abrió {session.opened_by} · Cerró {session.closed_by ?? "—"}
          </p>
        </section>

        {session.conciliacion && Object.keys(session.conciliacion).length > 0 ? (
          <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              QR y posnet contra sus resúmenes
            </h2>
            <dl className="tnum flex flex-col gap-1.5 text-sm">
              {(Object.entries(session.conciliacion) as [PaymentMethod, { sistema: number; informado: number }][]).map(
                ([m, c]) => {
                  const dif = c.informado - c.sistema;
                  return (
                    <div key={m} className="flex items-center justify-between gap-2">
                      <dt className="text-ink-700">{PAYMENT_LABELS[m]}</dt>
                      <dd className="text-right">
                        <span className="font-bold">{formatARS(c.informado)}</span>
                        <span className="text-xs text-ink-500"> informado · sistema {formatARS(c.sistema)}</span>
                        {Math.abs(dif) >= 1 ? (
                          <span className="block text-xs font-bold text-danger-600">
                            diferencia {formatARSSigned(dif)}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  );
                }
              )}
            </dl>
          </section>
        ) : null}

        <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
            Facturación · {formatARS(total)} · {(sales ?? []).length} ventas
          </h2>
          <dl className="tnum flex flex-col gap-1 text-sm">
            {(Object.keys(byMethod) as PaymentMethod[]).map((m) => (
              <div key={m} className="flex justify-between">
                <dt className="text-ink-700">{PAYMENT_LABELS[m]}</dt>
                <dd className="font-bold">{formatARS(byMethod[m])}</dd>
              </div>
            ))}
          </dl>
        </section>

        {(expenses ?? []).length > 0 ? (
          <section className="rounded-3xl border border-[var(--border-soft)] bg-surface-card p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              Gastos del turno
            </h2>
            <ul className="tnum flex flex-col gap-1 text-sm">
              {(expenses ?? []).map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span className="text-ink-700">{e.description}</span>
                  <span className="font-bold">−{formatARS(e.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
