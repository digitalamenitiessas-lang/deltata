"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Banknote,
  Landmark,
  QrCode,
  CreditCard,
  NotebookPen,
  UserPlus,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { db } from "@/lib/db";
import { upsertCustomer } from "@/lib/ops";
import { SueleLlevar } from "./SueleLlevar";
import { formatARS } from "@/lib/money";
import { useUI } from "@/stores/ui";
import { PAYMENT_LABELS, type PaymentMethod } from "@/types";

const METHODS: { id: PaymentMethod; icon: typeof Banknote }[] = [
  { id: "efectivo", icon: Banknote },
  { id: "transferencia", icon: Landmark },
  { id: "qr", icon: QrCode },
  { id: "tarjeta", icon: CreditCard },
  { id: "cuenta_corriente", icon: NotebookPen },
];

/**
 * Billetes con los que suele pagar alguien, por encima del total: tocar uno
 * es más rápido que tipear el monto y el vuelto sale solo.
 */
export function montosRapidos(total: number): number[] {
  if (total <= 0) return [];
  const pasos = [1000, 2000, 5000, 10000, 20000];
  const vistos = new Set<number>();
  for (const paso of pasos) {
    const m = Math.ceil(total / paso) * paso;
    if (m > total) vistos.add(m);
  }
  return [...vistos].sort((a, b) => a - b).slice(0, 3);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  /** título del sheet (por ejemplo, "Cobrar pedido de Juan") */
  titulo?: string;
  /** cliente que ya se eligió al armar el pedido */
  clientePreelegido?: string | null;
  onConfirm: (input: {
    payment_method: PaymentMethod;
    cash_received?: number;
    customer_id?: string;
  }) => Promise<void>;
}

export function PaymentSheet({
  open,
  onOpenChange,
  total,
  clientePreelegido = null,
  onConfirm,
  titulo = "Cobrar",
}: Props) {
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [receivedRaw, setReceivedRaw] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const showToast = useUI((s) => s.showToast);

  // Cada cobro arranca limpio: el método de la venta anterior no queda pegado
  useEffect(() => {
    if (open) {
      setMethod("efectivo");
      setReceivedRaw("");
      // Si ya lo eligieron al armar el pedido, no se vuelve a preguntar
      setCustomerId(clientePreelegido);
      setCustomerSearch("");
      setCreatingCustomer(false);
    }
  }, [open, clientePreelegido]);

  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const movements = useLiveQuery(
    () => db.account_movements.orderBy("moved_at").toArray(),
    []
  );

  const balances = useMemo(() => {
    // El saldo es la suma: un pago que llegó tarde no lo deja corrido
    const map = new Map<string, number>();
    for (const m of movements ?? []) {
      map.set(m.customer_id, (map.get(m.customer_id) ?? 0) + m.amount);
    }
    return map;
  }, [movements]);

  const received = parseMoney(receivedRaw);
  const change = received - total;
  const selectedCustomer = customers?.find((c) => c.id === customerId);
  const projectedBalance =
    selectedCustomer != null
      ? (balances.get(selectedCustomer.id) ?? 0) + total
      : null;
  const overLimit =
    selectedCustomer?.credit_limit != null &&
    projectedBalance != null &&
    projectedBalance > selectedCustomer.credit_limit;

  const filteredCustomers = (customers ?? [])
    .filter((c) => c.is_active)
    .filter((c) =>
      c.name.toLowerCase().includes(customerSearch.trim().toLowerCase())
    )
    .slice(0, 6);

  // Con el monto cargado, tiene que alcanzar: si no, la venta quedaría como
  // cobrada completa con plata de menos en el cajón.
  const faltaEfectivo = method === "efectivo" && received > 0 && received < total;
  const canConfirm =
    total > 0 &&
    !busy &&
    !faltaEfectivo &&
    (method !== "cuenta_corriente" || customerId != null);

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm({
        payment_method: method,
        cash_received:
          method === "efectivo" && received > 0 ? received : undefined,
        customer_id: method === "cuenta_corriente" ? customerId! : undefined,
      });
      setReceivedRaw("");
      setCustomerId(null);
      setCustomerSearch("");
    } catch (err) {
      // el sheet queda abierto con el pedido intacto: se puede reintentar
      showToast(
        err instanceof Error && err.message
          ? `No se registró la venta: ${err.message}`
          : "No se registró la venta. Verificá y reintentá."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={titulo}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Medio de pago">
          {METHODS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={method === id}
              onClick={() => setMethod(id)}
              className={`flex h-14 items-center justify-center gap-2 rounded-2xl border text-sm font-bold transition-colors duration-[var(--motion-fast)] ${
                method === id
                  ? "border-brand-900 bg-brand-900 text-ink-inverse"
                  : "border-[var(--border-strong)] bg-surface-card text-ink-700"
              } ${id === "cuenta_corriente" ? "col-span-2" : ""}`}
            >
              <Icon size={18} aria-hidden />
              {PAYMENT_LABELS[id]}
            </button>
          ))}
        </div>

        {method === "efectivo" ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setReceivedRaw(String(total))}
                className="h-12 rounded-xl border border-[var(--border-strong)] bg-surface-card text-sm font-bold text-ink-950 active:bg-cream-100"
              >
                Justo
              </button>
              {montosRapidos(total).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setReceivedRaw(String(m))}
                  className="tnum h-12 rounded-xl border border-[var(--border-strong)] bg-surface-card text-sm font-bold text-ink-950 active:bg-cream-100"
                >
                  {formatARS(m)}
                </button>
              ))}
            </div>
            <MoneyInput
              label="Monto recibido (opcional)"
              value={receivedRaw}
              onChange={setReceivedRaw}
              placeholder={String(total)}
            />
            {received > 0 ? (
              <p
                className={`tnum text-center text-lg font-bold ${
                  change < 0 ? "text-danger-600" : "text-success-600"
                }`}
                aria-live="polite"
              >
                {change < 0
                  ? `Faltan ${formatARS(-change)}`
                  : `Vuelto: ${formatARS(change)}`}
              </p>
            ) : null}
          </div>
        ) : null}

        {method === "qr" ? (
          <p className="rounded-2xl bg-cream-100 px-3 py-2 text-xs leading-relaxed text-ink-700">
            Mostrá el QR de Mercado Pago y confirmá recién cuando veas el pago
            acreditado. Al cerrar la caja se compara con el resumen de Mercado Pago.
          </p>
        ) : null}
        {method === "tarjeta" ? (
          <p className="rounded-2xl bg-cream-100 px-3 py-2 text-xs leading-relaxed text-ink-700">
            Pasá la tarjeta por el posnet y confirmá con el ticket aprobado. Al
            cerrar la caja se compara con el cierre del posnet.
          </p>
        ) : null}

        {method === "cuenta_corriente" ? (
          <div className="flex flex-col gap-2">
            {selectedCustomer ? (
              <div className="rounded-2xl border border-brand-700 bg-brand-050 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-ink-950">{selectedCustomer.name}</p>
                  <button
                    type="button"
                    className="text-xs font-bold text-brand-900 underline"
                    onClick={() => setCustomerId(null)}
                  >
                    Cambiar
                  </button>
                </div>
                <dl className="tnum mt-1 grid grid-cols-2 gap-1 text-xs text-ink-700">
                  <div>
                    <dt>Saldo actual</dt>
                    <dd className="font-bold text-ink-950">
                      {formatARS(balances.get(selectedCustomer.id) ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>Saldo proyectado</dt>
                    <dd className="font-bold text-ink-950">
                      {formatARS(projectedBalance ?? 0)}
                    </dd>
                  </div>
                </dl>
                {overLimit ? (
                  <p className="mt-2 rounded-xl bg-[#f7ecd8] px-3 py-2 text-xs font-bold text-warning-600">
                    Supera el límite de {formatARS(selectedCustomer.credit_limit!)}.
                    Podés continuar igual.
                  </p>
                ) : null}
                <div className="mt-2">
                  <SueleLlevar customerId={selectedCustomer.id} compacto />
                </div>
              </div>
            ) : creatingCustomer ? (
              <NewCustomerInline
                initialName={customerSearch}
                onCreated={(id) => {
                  setCustomerId(id);
                  setCreatingCustomer(false);
                }}
                onCancel={() => setCreatingCustomer(false)}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Buscar cliente…"
                  aria-label="Buscar cliente"
                  className="h-12 rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
                />
                <ul className="flex flex-col gap-1">
                  {filteredCustomers.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setCustomerId(c.id)}
                        className="flex h-12 w-full items-center justify-between rounded-xl border border-[var(--border-soft)] bg-surface-card px-3 text-sm font-bold text-ink-950 active:bg-cream-100"
                      >
                        {c.name}
                        <span className="tnum text-xs text-ink-700">
                          {formatARS(balances.get(c.id) ?? 0)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setCreatingCustomer(true)}
                >
                  <UserPlus size={16} /> Nuevo cliente
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <Button size="lg" disabled={!canConfirm} onClick={() => void confirm()}>
          {busy ? "Registrando…" : `Confirmar · ${formatARS(total)}`}
        </Button>
      </div>
    </Sheet>
  );
}

function NewCustomerInline({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [limitRaw, setLimitRaw] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border-strong)] bg-surface-card p-3">
      <p className="text-sm font-bold text-ink-950">Nuevo cliente</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre"
        aria-label="Nombre del cliente"
        autoFocus
        className="h-12 rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Teléfono (opcional)"
        aria-label="Teléfono"
        inputMode="tel"
        className="h-12 rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
      />
      <MoneyInput
        label="Límite de crédito (opcional)"
        value={limitRaw}
        onChange={setLimitRaw}
      />
      <div className="flex gap-2">
        <Button variant="ghost" size="md" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          size="md"
          className="flex-1"
          disabled={!name.trim() || saving}
          onClick={async () => {
            if (saving) return;
            setSaving(true);
            try {
              const customer = await upsertCustomer({
                name: name.trim(),
                phone: phone.trim() || undefined,
                credit_limit: limitRaw ? parseMoney(limitRaw) : null,
              });
              onCreated(customer.id);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Guardando…" : "Guardar cliente"}
        </Button>
      </div>
    </div>
  );
}
