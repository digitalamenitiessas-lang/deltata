"use client";

import { use, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { recordCustomerPayment } from "@/lib/ops";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS, formatARSSigned } from "@/lib/money";
import { useSesion } from "@/stores/sesion";
import { useEquipo } from "@/stores/equipo";
import { ubicacionDeCanal } from "@/lib/lugar";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { SueleLlevar } from "@/components/sale/SueleLlevar";
import { PAYMENT_LABELS, type PaymentMethod } from "@/types";

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const TYPE_LABELS = { venta: "Venta", pago: "Pago", ajuste: "Ajuste" } as const;

export default function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const profileName = useSesion((s) => s.usuario?.nombre ?? "");
  const showToast = useUI((s) => s.showToast);

  const customer = useLiveQuery(() => db.customers.get(id), [id]);
  const movements = useLiveQuery(
    () => db.account_movements.where("customer_id").equals(id).sortBy("moved_at"),
    [id]
  );

  const [paying, setPaying] = useState(false);
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cajaElegida, setCajaElegida] = useState<string | null>(null);
  const ubicacionEquipo = useEquipo((s) => s.ubicacionId);
  const cajas = useLiveQuery(
    () => db.cash_sessions.where("status").equals("abierta").toArray(),
    []
  );
  const canales = useLiveQuery(() => db.canales.toArray(), []);
  const nombreCanal = (cid: string | null) =>
    (canales ?? []).find((c) => c.id === cid)?.nombre ?? "Caja";
  // La plata en efectivo entra al cajón de UN lugar: con varias cajas abiertas
  // hay que decir cuál (antes caía en la más reciente, de cualquier lugar)
  const cajaDelEquipo = (cajas ?? []).find(
    (c) =>
      ubicacionEquipo != null &&
      ubicacionDeCanal((canales ?? []).find((x) => x.id === c.canal_id)) === ubicacionEquipo
  );
  const caja = cajaElegida ?? cajaDelEquipo?.id ?? (cajas ?? [])[0]?.id ?? null;

  if (!customer) {
    return (
      <>
        <PageHeader title="Cliente" />
        <p className="p-6 text-center text-sm text-ink-700">
          Este cliente no está disponible en este dispositivo.
        </p>
      </>
    );
  }

  const balance = (movements ?? []).reduce((acc, m) => acc + m.amount, 0);
  const amount = parseMoney(amountRaw);
  const timeline = [...(movements ?? [])].reverse();

  return (
    <>
      <PageHeader title={customer.name} subtitle={customer.phone ?? undefined} />
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <section className="rounded-3xl bg-brand-900 p-5 text-ink-inverse">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-100">
            Saldo actual
          </p>
          <p className="tnum text-4xl font-bold">{formatARS(balance)}</p>
          <p className="mt-1 text-sm text-brand-100">
            {customer.credit_limit != null
              ? `Límite: ${formatARS(customer.credit_limit)}`
              : "Sin límite definido"}
          </p>
        </section>

        {/* Para poder recomendarle sin depender de la memoria de quien atiende */}
        <SueleLlevar customerId={customer.id} />

        <Button size="lg" onClick={() => setPaying(true)} disabled={balance <= 0}>
          Registrar pago
        </Button>

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
            Historial
          </h2>
          {timeline.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-surface-card p-4 text-center text-sm text-ink-700">
              Sin movimientos todavía.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {timeline.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-bold text-ink-950">
                      {TYPE_LABELS[m.type]}
                      {m.payment_method
                        ? ` · ${PAYMENT_LABELS[m.payment_method]}`
                        : ""}
                    </p>
                    <p className="text-xs text-ink-500">
                      {dateFmt.format(new Date(m.moved_at))}
                      {m.note ? ` · ${m.note}` : ""}
                    </p>
                  </div>
                  <div className="tnum text-right">
                    <p
                      className={`text-sm font-bold ${
                        m.amount > 0 ? "text-terracotta-500" : "text-success-600"
                      }`}
                    >
                      {formatARSSigned(m.amount)}
                    </p>
                    <p className="text-xs text-ink-500">
                      saldo {formatARS(m.balance_after)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Sheet open={paying} onOpenChange={setPaying} title="Registrar pago">
        <div className="flex flex-col gap-3">
          <MoneyInput label="Monto" value={amountRaw} onChange={setAmountRaw} autoFocus />
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Medio de pago">
            {(["efectivo", "transferencia", "qr", "tarjeta"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={`h-11 rounded-xl text-sm font-bold ${
                  method === m
                    ? "bg-brand-900 text-ink-inverse"
                    : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                }`}
              >
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          {method === "efectivo" && (cajas ?? []).length > 1 ? (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-700">
                ¿En qué caja entra la plata?
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Caja">
                {(cajas ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={caja === c.id}
                    onClick={() => setCajaElegida(c.id)}
                    className={`h-11 rounded-xl px-4 text-sm font-bold ${
                      caja === c.id
                        ? "bg-brand-900 text-ink-inverse"
                        : "border border-[var(--border-soft)] bg-surface-card text-ink-700"
                    }`}
                  >
                    {nombreCanal(c.canal_id)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota (opcional)"
            aria-label="Nota"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          {amount > 0 ? (
            <p className="tnum text-center text-sm text-ink-700">
              Nuevo saldo:{" "}
              <span className="font-bold text-ink-950">
                {formatARS(balance - amount)}
              </span>
            </p>
          ) : null}
          <Button
            size="lg"
            disabled={amount <= 0 || busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await recordCustomerPayment({
                  customer_id: id,
                  amount,
                  payment_method: method,
                  note: note || undefined,
                  created_by: profileName,
                  cash_session_id: method === "efectivo" ? caja : null,
                });
                notifyOutboxChanged();
                showToast(`Pago registrado · ${formatARS(amount)}`);
                setAmountRaw("");
                setNote("");
                setPaying(false);
              } catch (err) {
                showToast(
                  err instanceof Error && err.message
                    ? `No se registró el pago: ${err.message}`
                    : "No se registró el pago. Reintentá."
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Registrando…" : `Registrar pago · ${formatARS(amount)}`}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
